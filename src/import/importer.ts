import fs from 'node:fs';
import { parse } from 'csv-parse';
import type { WorkOS } from '@workos-inc/node';
import type {
  CSVRow,
  CreateUserPayload,
  ErrorRecord,
  ImportSummary,
  ChunkMetadata,
  ChunkSummary,
} from '../shared/types.js';
import { RateLimiter } from '../shared/rate-limiter.js';
import { OrgCache } from './org-cache.js';
import { CheckpointManager } from './checkpoint.js';
import { ErrorWriter } from './error-writer.js';
import { formatDuration, printImportSummary } from '../shared/progress.js';
import * as logger from '../shared/logger.js';

// ---------------------------------------------------------------------------
// Semaphore for concurrency control
// ---------------------------------------------------------------------------

class Semaphore {
  private count = 0;
  private queue: Array<() => void> = [];
  constructor(private max: number) {
    this.max = Math.max(1, max);
  }
  async acquire(): Promise<void> {
    if (this.count < this.max) {
      this.count += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.count += 1;
        resolve();
      });
    });
  }
  release(): void {
    this.count -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// Known CSV columns
// ---------------------------------------------------------------------------

export const KNOWN_COLUMNS = new Set([
  'email',
  'password',
  'password_hash',
  'password_hash_type',
  'first_name',
  'last_name',
  'email_verified',
  'external_id',
  'metadata',
  'org_id',
  'org_external_id',
  'org_name',
  'role_slugs',
]);

// ---------------------------------------------------------------------------
// Row parsing helpers
// ---------------------------------------------------------------------------

function parseBooleanLike(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const lower = String(value).toLowerCase().trim();
  if (lower === 'true' || lower === 'yes' || lower === '1') return true;
  if (lower === 'false' || lower === 'no' || lower === '0') return false;
  return undefined;
}

function isBlank(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

function parseRoleSlugsFromCsv(raw: string | undefined): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed))
        return parsed.map((s: unknown) => String(s).trim()).filter(Boolean);
    } catch {
      // fall through
    }
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

interface OrgInfo {
  orgId?: string;
  orgExternalId?: string;
  orgName?: string;
}

function buildUserAndOrgFromRow(row: CSVRow): {
  userPayload?: CreateUserPayload;
  orgInfo?: OrgInfo;
  roleSlugs?: string[];
  error?: string;
} {
  const email = typeof row.email === 'string' ? row.email.trim() : '';
  if (!email) return { error: 'Missing required email' };

  const password = typeof row.password === 'string' ? row.password : undefined;
  const passwordHash = typeof row.password_hash === 'string' ? row.password_hash : undefined;
  const passwordHashType =
    typeof row.password_hash_type === 'string' ? row.password_hash_type : undefined;
  const firstName = typeof row.first_name === 'string' ? row.first_name : undefined;
  const lastName = typeof row.last_name === 'string' ? row.last_name : undefined;
  const emailVerifiedParsed = parseBooleanLike(row.email_verified);
  const externalId = typeof row.external_id === 'string' ? row.external_id : undefined;

  let metadata: Record<string, unknown> | undefined;
  if (typeof row.metadata === 'string') {
    const trimmed = (row.metadata as string).trim();
    if (trimmed.length > 0) {
      try {
        const parsed = JSON.parse(trimmed);
        metadata = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
            metadata[key] = JSON.stringify(value);
          } else {
            metadata[key] = value;
          }
        }
      } catch {
        return { error: 'Invalid metadata JSON' };
      }
    }
  }

  const orgId =
    typeof row.org_id === 'string' && row.org_id.trim() !== '' ? row.org_id.trim() : undefined;
  const orgExternalId =
    typeof row.org_external_id === 'string' && row.org_external_id.trim() !== ''
      ? row.org_external_id.trim()
      : undefined;
  const orgName =
    typeof row.org_name === 'string' && row.org_name.trim() !== ''
      ? row.org_name.trim()
      : undefined;

  if (orgId && orgExternalId) {
    return { error: 'Row cannot specify both org_id and org_external_id' };
  }

  const payload: CreateUserPayload = { email };
  if (!isBlank(passwordHash) && !isBlank(passwordHashType)) {
    payload.passwordHash = passwordHash as string;
    payload.passwordHashType = passwordHashType as string;
  } else if (!isBlank(password)) {
    payload.password = password as string;
  }
  if (!isBlank(firstName)) payload.firstName = firstName as string;
  if (!isBlank(lastName)) payload.lastName = lastName as string;
  if (emailVerifiedParsed !== undefined) payload.emailVerified = emailVerifiedParsed;
  if (!isBlank(externalId)) payload.externalId = externalId as string;
  if (metadata !== undefined) payload.metadata = metadata;

  const orgInfo = orgId || orgExternalId || orgName ? { orgId, orgExternalId, orgName } : undefined;
  const roleSlugs = parseRoleSlugsFromCsv(row.role_slugs as string | undefined);

  return {
    userPayload: payload,
    orgInfo,
    roleSlugs: roleSlugs.length > 0 ? roleSlugs : undefined,
  };
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

interface RateLimiterLike {
  acquire(): Promise<void>;
}

async function retryCreateUser(
  workos: WorkOS,
  payload: CreateUserPayload,
  limiter: RateLimiterLike,
  maxRetries = 3,
  baseDelayMs = 500,
): Promise<string> {
  let attempt = 0;
  for (;;) {
    try {
      await limiter.acquire();
      const user = await workos.userManagement.createUser(payload as any);
      return (user as any)?.id as string;
    } catch (err: any) {
      const status: number | undefined = err?.status ?? err?.httpStatus ?? err?.response?.status;
      const message: string = err?.message || 'Unknown error';
      const isRateLimited = status === 429 || /rate.?limit/i.test(message);
      attempt += 1;
      if (isRateLimited && attempt <= maxRetries) {
        let delay = baseDelayMs * Math.pow(2, attempt - 1);
        const retryAfter =
          err?.response?.headers?.['retry-after'] ?? err?.response?.headers?.['Retry-After'];
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!isNaN(seconds)) delay = seconds * 1000;
        }
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

interface MembershipResult {
  rolesAssigned: number;
  warning?: string;
}

async function retryCreateMembership(
  workos: WorkOS,
  userId: string,
  organizationId: string,
  limiter: RateLimiterLike,
  roleSlugs?: string[],
  maxRetries = 3,
  baseDelayMs = 500,
): Promise<MembershipResult> {
  const roleParams =
    roleSlugs?.length === 1
      ? { roleSlug: roleSlugs[0] }
      : roleSlugs && roleSlugs.length > 1
        ? { roleSlugs }
        : {};

  let attempt = 0;
  for (;;) {
    try {
      await limiter.acquire();
      await workos.userManagement.createOrganizationMembership({
        userId,
        organizationId,
        ...roleParams,
      } as any);
      return { rolesAssigned: roleSlugs?.length ?? 0 };
    } catch (err: any) {
      const status: number | undefined = err?.status ?? err?.httpStatus ?? err?.response?.status;
      const message: string = err?.message || 'Unknown error';
      const errorCode: string = err?.code || '';
      const isRateLimited = status === 429 || /rate.?limit/i.test(message);

      // Fall back to single role if multiple roles not enabled
      if (
        status === 422 &&
        (errorCode === 'multiple_roles_not_enabled' ||
          /multiple.?roles.?not.?enabled/i.test(message))
      ) {
        if (roleSlugs && roleSlugs.length > 1) {
          let retryAttempt = 0;
          for (;;) {
            try {
              await limiter.acquire();
              await workos.userManagement.createOrganizationMembership({
                userId,
                organizationId,
                roleSlug: roleSlugs[0],
              } as any);
              return {
                rolesAssigned: 1,
                warning: `Multiple roles not enabled — assigned "${roleSlugs[0]}" only, skipped: ${roleSlugs.slice(1).join(', ')}`,
              };
            } catch (retryErr: any) {
              const retryStatus =
                retryErr?.status ?? retryErr?.httpStatus ?? retryErr?.response?.status;
              const retryMsg = retryErr?.message || '';
              const retryIsRateLimited = retryStatus === 429 || /rate.?limit/i.test(retryMsg);
              retryAttempt += 1;
              if (retryIsRateLimited && retryAttempt <= maxRetries) {
                await new Promise((r) =>
                  setTimeout(r, baseDelayMs * Math.pow(2, retryAttempt - 1)),
                );
                continue;
              }
              throw retryErr;
            }
          }
        }
        throw err;
      }

      attempt += 1;
      if (isRateLimited && attempt <= maxRetries) {
        let delay = baseDelayMs * Math.pow(2, attempt - 1);
        const retryAfter =
          err?.response?.headers?.['retry-after'] ?? err?.response?.headers?.['Retry-After'];
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!isNaN(seconds)) delay = seconds * 1000;
        }
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Import modes
// ---------------------------------------------------------------------------

export interface ImporterOptions {
  workos: WorkOS;
  csvPath: string;
  concurrency: number;
  rateLimit: number;
  orgId?: string | null;
  createOrgIfMissing: boolean;
  dryRun: boolean;
  dedupe: boolean;
  errorsPath: string;
  quiet: boolean;
  checkpointManager?: CheckpointManager;
  numWorkers?: number;
}

export async function runImport(options: ImporterOptions): Promise<ImportSummary> {
  // Route to worker pool mode
  if (options.checkpointManager && options.numWorkers && options.numWorkers > 1) {
    return runWorkerMode(options);
  }

  // Route to chunked mode
  if (options.checkpointManager) {
    return runChunkedMode(options);
  }

  // Streaming mode (default)
  return runStreamingMode(options);
}

// ---------------------------------------------------------------------------
// Streaming mode
// ---------------------------------------------------------------------------

async function runStreamingMode(options: ImporterOptions): Promise<ImportSummary> {
  const { workos, csvPath, concurrency, orgId = null, dryRun, dedupe, errorsPath, quiet } = options;
  const limiter = new RateLimiter(options.rateLimit);
  const errorWriter = new ErrorWriter(errorsPath);
  const startedAt = Date.now();
  const warnings: string[] = [];

  let orgCache: OrgCache | null = null;
  const multiOrgMode = !orgId;
  if (multiOrgMode) {
    orgCache = new OrgCache(dryRun ? null : workos, { dryRun });
  }

  const summary: ImportSummary = {
    totalRows: 0,
    usersCreated: 0,
    membershipsCreated: 0,
    duplicateUsers: 0,
    duplicateMemberships: 0,
    errors: 0,
    rolesAssigned: 0,
    roleAssignmentFailures: 0,
    warnings,
    duration: 0,
  };

  const createdUsers = new Map<string, string>();
  const createdMemberships = new Set<string>();

  const semaphore = new Semaphore(concurrency);
  const inFlight: Promise<void>[] = [];
  let recordNumber = 0;
  let headerHandled = false;
  let warnedUnknown = false;

  await new Promise<void>((resolve, reject) => {
    const input = fs.createReadStream(csvPath);
    const parser = parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
    });

    parser.on('error', reject);
    parser.on('end', () => resolve());

    parser.on('readable', () => {
      let row: CSVRow | null;
      while ((row = parser.read()) !== null) {
        const rowData = row as CSVRow;

        if (!headerHandled) {
          headerHandled = true;
          const headers = Object.keys(rowData as Record<string, unknown>);
          if (!headers.includes('email')) {
            reject(new Error("CSV must include required 'email' column."));
            return;
          }
          const hasOrgColumns = headers.some(
            (h) => h === 'org_id' || h === 'org_external_id' || h === 'org_name',
          );
          if (hasOrgColumns && orgId) {
            warnings.push(
              'CSV contains org columns but --org-id provided. Using single-org mode (CLI flags take precedence).',
            );
          }
          const unknown = headers.filter((h) => !KNOWN_COLUMNS.has(h));
          if (unknown.length > 0 && !warnedUnknown) {
            warnings.push(`Ignoring unknown columns: ${unknown.join(', ')}`);
            warnedUnknown = true;
          }
        }

        recordNumber += 1;
        const currentRecord = recordNumber;
        summary.totalRows += 1;
        const email = typeof rowData.email === 'string' ? rowData.email : undefined;

        const task = (async () => {
          const built = buildUserAndOrgFromRow(rowData);
          if (built.error) {
            errorWriter.write({
              recordNumber: currentRecord,
              email,
              errorType: 'user_create',
              errorMessage: built.error,
              timestamp: new Date().toISOString(),
            });
            summary.errors += 1;
            return;
          }

          // Resolve org
          let resolvedOrgId: string | null = orgId ?? null;
          if (!orgId && built.orgInfo && orgCache) {
            try {
              resolvedOrgId = await orgCache.resolve({
                orgId: built.orgInfo.orgId,
                orgExternalId: built.orgInfo.orgExternalId,
                createIfMissing: options.createOrgIfMissing || Boolean(built.orgInfo.orgName),
                orgName: built.orgInfo.orgName,
              });
              if (!resolvedOrgId && (built.orgInfo.orgId || built.orgInfo.orgExternalId)) {
                throw new Error(
                  `Organization not found: ${built.orgInfo.orgId || built.orgInfo.orgExternalId}`,
                );
              }
            } catch (err: any) {
              errorWriter.write({
                recordNumber: currentRecord,
                email,
                errorType: 'org_resolution',
                errorMessage: err?.message || 'Organization resolution failed',
                timestamp: new Date().toISOString(),
                orgId: built.orgInfo.orgId,
                orgExternalId: built.orgInfo.orgExternalId,
              });
              summary.errors += 1;
              return;
            }
          }

          // Create user
          let createdUserId: string | undefined;
          const userEmail = built.userPayload!.email.toLowerCase();

          if (dedupe && createdUsers.has(userEmail)) {
            createdUserId = createdUsers.get(userEmail)!;
            summary.duplicateUsers += 1;
          } else {
            try {
              if (!dryRun) {
                createdUserId = await retryCreateUser(workos, built.userPayload!, limiter);
              } else {
                createdUserId = `dry-run-user-${userEmail}`;
              }
              createdUsers.set(userEmail, createdUserId!);
              summary.usersCreated += 1;
            } catch (err: any) {
              const status = err?.status ?? err?.httpStatus ?? err?.response?.status;
              errorWriter.write({
                recordNumber: currentRecord,
                email,
                errorType: 'user_create',
                errorMessage: err?.message || 'Unknown error',
                timestamp: new Date().toISOString(),
                httpStatus: status,
                workosCode: err?.code,
                workosRequestId: err?.requestId,
                workosErrors: err?.errors,
              });
              summary.errors += 1;
              return;
            }
          }

          // Create membership
          const roleSlugs = built.roleSlugs || [];
          if (resolvedOrgId && createdUserId) {
            const membershipKey = `${createdUserId}:${resolvedOrgId}`;
            if (createdMemberships.has(membershipKey)) {
              summary.duplicateMemberships += 1;
            } else {
              try {
                let result: MembershipResult = { rolesAssigned: roleSlugs.length };
                if (!dryRun) {
                  result = await retryCreateMembership(
                    workos,
                    createdUserId,
                    resolvedOrgId,
                    limiter,
                    roleSlugs.length > 0 ? roleSlugs : undefined,
                  );
                }
                createdMemberships.add(membershipKey);
                summary.membershipsCreated += 1;
                summary.rolesAssigned += result.rolesAssigned;
                if (result.warning) {
                  warnings.push(`Row ${currentRecord}: ${result.warning}`);
                }
              } catch (err: any) {
                const status = err?.status ?? err?.httpStatus ?? err?.response?.status;
                if (status === 409) {
                  summary.duplicateMemberships += 1;
                  createdMemberships.add(membershipKey);
                } else {
                  errorWriter.write({
                    recordNumber: currentRecord,
                    email,
                    userId: createdUserId,
                    errorType: 'membership_create',
                    errorMessage: err?.message || 'Unknown error',
                    timestamp: new Date().toISOString(),
                    httpStatus: status,
                    workosCode: err?.code,
                    workosRequestId: err?.requestId,
                  });
                  summary.errors += 1;
                  return;
                }
              }
            }
          }
        })();

        const run = (async () => {
          await semaphore.acquire();
          try {
            await task;
          } finally {
            semaphore.release();
          }
        })();
        inFlight.push(run);
      }
    });

    input.pipe(parser);
  });

  await Promise.all(inFlight);
  await errorWriter.close();

  summary.duration = Date.now() - startedAt;

  if (orgCache) {
    const cacheStats = orgCache.getStats();
    summary.cacheStats = {
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: `${(cacheStats.hitRate * 100).toFixed(1)}%`,
    };
  }

  if (!quiet) {
    printImportSummary(summary);
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Chunked mode
// ---------------------------------------------------------------------------

async function runChunkedMode(options: ImporterOptions): Promise<ImportSummary> {
  const { checkpointManager, dryRun, workos, quiet } = options;
  if (!checkpointManager) throw new Error('Checkpoint manager required for chunked mode');

  const state = checkpointManager.getState();

  let orgCache: OrgCache | null = null;
  if (state.mode === 'multi-org') {
    orgCache = checkpointManager.restoreCache(dryRun ? null : workos, dryRun);
    if (!orgCache) {
      orgCache = new OrgCache(dryRun ? null : workos, { dryRun });
    }
  }

  for (;;) {
    const chunk = checkpointManager.getNextPendingChunk();
    if (!chunk) break;

    if (!quiet) {
      logger.info(
        `Processing chunk ${chunk.chunkId + 1}/${state.chunks.length} (rows ${chunk.startRow}-${chunk.endRow})`,
      );
    }

    checkpointManager.markChunkStarted(chunk.chunkId);

    try {
      const chunkSummary = await processChunk(chunk, options, orgCache);
      checkpointManager.markChunkCompleted(chunk.chunkId, chunkSummary);
    } catch (err: any) {
      checkpointManager.markChunkFailed(chunk.chunkId);
      logger.error(`Chunk ${chunk.chunkId} failed: ${err.message}`);
      throw err;
    }

    if (orgCache) {
      checkpointManager.serializeCache(orgCache);
    }
    await checkpointManager.saveCheckpoint();

    if (!quiet) {
      const progress = checkpointManager.getProgress();
      const eta = progress.estimatedTimeRemainingMs
        ? formatDuration(progress.estimatedTimeRemainingMs)
        : 'calculating...';
      logger.info(
        `Progress: ${progress.completedChunks}/${progress.totalChunks} chunks (${progress.percentComplete}%) - ETA: ${eta}`,
      );
    }
  }

  const summary = checkpointManager.getFinalSummary();
  if (!quiet) {
    printImportSummary(summary);
  }
  return summary;
}

async function processChunk(
  chunk: ChunkMetadata,
  options: ImporterOptions,
  orgCache: OrgCache | null,
): Promise<ChunkSummary> {
  const { workos, csvPath, concurrency, orgId = null, dryRun, checkpointManager } = options;
  const limiter = new RateLimiter(options.rateLimit);
  const sem = new Semaphore(concurrency);

  const chunkStartTime = Date.now();
  let successes = 0;
  let failures = 0;
  let membershipsCreated = 0;
  let usersCreated = 0;
  let duplicateUsers = 0;
  let duplicateMemberships = 0;
  let rolesAssigned = 0;
  const chunkWarnings: string[] = [];

  const createdUsers = new Map<string, string>();
  const createdMemberships = new Set<string>();

  let errorStream: fs.WriteStream | null = null;
  if (checkpointManager) {
    const errorPath = `${checkpointManager.getCheckpointDir()}/errors.jsonl`;
    errorStream = fs.createWriteStream(errorPath, { flags: 'a', encoding: 'utf8' });
  }

  const recordError = (errRec: ErrorRecord) => {
    if (errorStream) errorStream.write(JSON.stringify(errRec) + '\n');
  };

  const input = fs.createReadStream(csvPath);
  const parser = parse({ columns: true, bom: true, skip_empty_lines: true, trim: true });

  let recordNumber = 0;
  const inFlight: Promise<void>[] = [];

  await new Promise<void>((resolve, reject) => {
    parser.on('readable', () => {
      let row: CSVRow | null;
      while ((row = parser.read()) !== null) {
        recordNumber++;
        if (recordNumber < chunk.startRow || recordNumber > chunk.endRow) continue;

        const currentRow = row;
        const currentRecordNumber = recordNumber;

        const run = (async () => {
          await sem.acquire();
          try {
            const built = buildUserAndOrgFromRow(currentRow);
            if (built.error) {
              failures += 1;
              recordError({
                recordNumber: currentRecordNumber,
                email: String(currentRow.email ?? ''),
                errorType: 'user_create',
                errorMessage: built.error,
                timestamp: new Date().toISOString(),
              });
              return;
            }
            if (!built.userPayload) return;

            const payload = built.userPayload;

            let resolvedOrgId = orgId;
            if (!orgId && built.orgInfo && orgCache) {
              try {
                resolvedOrgId = await orgCache.resolve({
                  orgId: built.orgInfo.orgId,
                  orgExternalId: built.orgInfo.orgExternalId,
                  createIfMissing: options.createOrgIfMissing || Boolean(built.orgInfo.orgName),
                  orgName: built.orgInfo.orgName,
                });
                if (!resolvedOrgId) {
                  failures += 1;
                  recordError({
                    recordNumber: currentRecordNumber,
                    email: payload.email,
                    errorType: 'org_resolution',
                    errorMessage: `Organization not found: ${built.orgInfo.orgExternalId || built.orgInfo.orgId}`,
                    timestamp: new Date().toISOString(),
                    orgId: built.orgInfo.orgId,
                    orgExternalId: built.orgInfo.orgExternalId,
                  });
                  return;
                }
              } catch (err: any) {
                failures += 1;
                recordError({
                  recordNumber: currentRecordNumber,
                  email: payload.email,
                  errorType: 'org_resolution',
                  errorMessage: err.message || String(err),
                  timestamp: new Date().toISOString(),
                  orgId: built.orgInfo.orgId,
                  orgExternalId: built.orgInfo.orgExternalId,
                });
                return;
              }
            }

            const roleSlugsArr = built.roleSlugs || [];
            let createdUserId: string | undefined;
            const userEmail = payload.email.toLowerCase();

            if (createdUsers.has(userEmail)) {
              createdUserId = createdUsers.get(userEmail)!;
              duplicateUsers += 1;
            } else if (!dryRun) {
              try {
                createdUserId = await retryCreateUser(workos, payload, limiter);
                createdUsers.set(userEmail, createdUserId);
                usersCreated += 1;
              } catch (userErr: any) {
                failures += 1;
                recordError({
                  recordNumber: currentRecordNumber,
                  email: payload.email,
                  errorType: 'user_create',
                  errorMessage: userErr.message || String(userErr),
                  httpStatus: userErr.status,
                  workosCode: userErr.code,
                  timestamp: new Date().toISOString(),
                });
                return;
              }
            } else {
              createdUserId = `dry-run-user-${userEmail}`;
              createdUsers.set(userEmail, createdUserId);
              usersCreated += 1;
            }

            if (resolvedOrgId && createdUserId) {
              const membershipKey = `${createdUserId}:${resolvedOrgId}`;
              if (createdMemberships.has(membershipKey)) {
                duplicateMemberships += 1;
              } else {
                try {
                  let membershipResult: MembershipResult = { rolesAssigned: roleSlugsArr.length };
                  if (!dryRun) {
                    membershipResult = await retryCreateMembership(
                      workos,
                      createdUserId,
                      resolvedOrgId,
                      limiter,
                      roleSlugsArr.length > 0 ? roleSlugsArr : undefined,
                    );
                  }
                  createdMemberships.add(membershipKey);
                  membershipsCreated += 1;
                  rolesAssigned += membershipResult.rolesAssigned;
                  if (membershipResult.warning) {
                    chunkWarnings.push(`Row ${currentRecordNumber}: ${membershipResult.warning}`);
                  }
                } catch (membershipErr: any) {
                  const membershipStatus =
                    membershipErr?.status ??
                    membershipErr?.httpStatus ??
                    membershipErr?.response?.status;
                  if (membershipStatus === 409) {
                    duplicateMemberships += 1;
                    createdMemberships.add(membershipKey);
                  } else {
                    recordError({
                      recordNumber: currentRecordNumber,
                      email: payload.email,
                      userId: createdUserId,
                      errorType: 'membership_create',
                      errorMessage: membershipErr.message || String(membershipErr),
                      httpStatus: membershipStatus,
                      timestamp: new Date().toISOString(),
                    });
                    failures += 1;
                    return;
                  }
                }
              }
            }

            successes += 1;
          } finally {
            sem.release();
          }
        })();

        inFlight.push(run);
      }
    });

    parser.on('end', () => resolve());
    parser.on('error', reject);
    input.pipe(parser);
  });

  await Promise.all(inFlight);

  if (errorStream) {
    await new Promise<void>((resolve, reject) => {
      errorStream!.end((err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return {
    successes,
    failures,
    membershipsCreated,
    usersCreated,
    duplicateUsers,
    duplicateMemberships,
    rolesAssigned,
    durationMs: Date.now() - chunkStartTime,
    warnings: chunkWarnings.length > 0 ? chunkWarnings : undefined,
  };
}

// ---------------------------------------------------------------------------
// Worker mode (delegates to coordinator)
// ---------------------------------------------------------------------------

async function runWorkerMode(options: ImporterOptions): Promise<ImportSummary> {
  const { checkpointManager, workos, dryRun, numWorkers = 4, quiet } = options;
  if (!checkpointManager) throw new Error('Checkpoint manager required for worker mode');

  const state = checkpointManager.getState();

  let orgCache: OrgCache | null = null;
  if (state.mode === 'multi-org') {
    orgCache = checkpointManager.restoreCache(dryRun ? null : workos, dryRun);
    if (!orgCache) {
      orgCache = new OrgCache(dryRun ? null : workos, { dryRun });
    }
  }

  // Dynamic import to avoid circular dependency
  const { WorkerCoordinator } = await import('../workers/coordinator.js');

  const workerOptions = {
    csvPath: options.csvPath,
    concurrency: options.concurrency,
    orgId: options.orgId ?? null,
    dryRun: options.dryRun,
    quiet: options.quiet,
  };

  const coordinator = new WorkerCoordinator({
    checkpointManager,
    numWorkers,
    orgCache,
    importOptions: workerOptions,
    rateLimit: options.rateLimit,
    quiet,
  });

  if (!quiet) {
    logger.info(`Starting parallel import with ${numWorkers} workers...`);
  }

  const summary = await coordinator.start();

  if (!quiet) {
    printImportSummary(summary);
  }

  return summary;
}

// Export for use by chunk processor in workers
export {
  buildUserAndOrgFromRow,
  retryCreateUser,
  retryCreateMembership,
  Semaphore,
  type RateLimiterLike,
  type MembershipResult,
};
