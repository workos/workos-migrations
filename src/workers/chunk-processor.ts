import fs from 'node:fs';
import { parse } from 'csv-parse';
import type { WorkOS } from '@workos-inc/node';
import type {
  CSVRow,
  ErrorRecord,
  ChunkMetadata,
  ChunkSummary,
  WorkerImportOptions,
} from '../shared/types.js';
import {
  buildUserAndOrgFromRow,
  retryCreateUser,
  retryCreateMembership,
  Semaphore,
  type RateLimiterLike,
  type MembershipResult,
} from '../import/importer.js';
import { OrgCache } from '../import/org-cache.js';

export async function processChunkInWorker(
  workos: WorkOS,
  chunk: ChunkMetadata,
  options: WorkerImportOptions,
  orgCache: OrgCache | null,
  rateLimiter: RateLimiterLike,
  checkpointDir: string,
): Promise<ChunkSummary> {
  const { csvPath, concurrency = 10, orgId = null, dryRun = false } = options;
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

  const errorPath = `${checkpointDir}/errors.jsonl`;
  const errorStream = fs.createWriteStream(errorPath, { flags: 'a', encoding: 'utf8' });

  const recordError = (errRec: ErrorRecord) => {
    errorStream.write(JSON.stringify(errRec) + '\n');
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
                if (!dryRun) await rateLimiter.acquire();
                resolvedOrgId = await orgCache.resolve({
                  orgId: built.orgInfo.orgId,
                  orgExternalId: built.orgInfo.orgExternalId,
                  createIfMissing: Boolean(built.orgInfo.orgName),
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

            const roleSlugs = built.roleSlugs || [];
            let createdUserId: string | undefined;
            const userEmail = payload.email.toLowerCase();

            if (createdUsers.has(userEmail)) {
              createdUserId = createdUsers.get(userEmail)!;
              duplicateUsers += 1;
            } else if (!dryRun) {
              try {
                createdUserId = await retryCreateUser(workos, payload, rateLimiter);
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
                  let membershipResult: MembershipResult = { rolesAssigned: roleSlugs.length };
                  if (!dryRun) {
                    membershipResult = await retryCreateMembership(
                      workos,
                      createdUserId,
                      resolvedOrgId,
                      rateLimiter,
                      roleSlugs.length > 0 ? roleSlugs : undefined,
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
                    membershipErr?.status ?? membershipErr?.httpStatus ?? membershipErr?.response?.status;
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

  await new Promise<void>((resolve, reject) => {
    errorStream.end((err?: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });

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
