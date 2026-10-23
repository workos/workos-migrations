import fs from 'node:fs';
import type { WorkOS } from '@workos-inc/node';
import { RateLimiter, withRetry, isRateLimitError } from '../shared/rate-limiter.js';
import type { TotpEnrollSummary, TotpErrorRecord } from '../shared/types.js';
import { loadTotpRecords } from './parsers.js';

export interface EnrollTotpOptions {
  inputPath: string;
  format?: 'csv' | 'ndjson';
  concurrency: number;
  rateLimit: number;
  dryRun: boolean;
  errorsPath?: string;
  totpIssuer?: string;
  quiet: boolean;
}

/**
 * Look up a user in WorkOS by email. Returns the user ID or null.
 */
async function lookupUserByEmail(workos: WorkOS, email: string): Promise<string | null> {
  const users = await workos.userManagement.listUsers({ email });
  const data = users.data;
  if (data.length === 0) return null;
  const first = data[0];
  if (!first) return null;
  return first.id;
}

/**
 * Look up a user in WorkOS by external ID. Returns the user ID or null.
 */
async function lookupUserByExternalId(workos: WorkOS, externalId: string): Promise<string | null> {
  try {
    const user = await workos.userManagement.getUserByExternalId(externalId);
    return user.id;
  } catch (err: unknown) {
    const status = (err as Record<string, unknown>)?.status;
    if (status === 404) return null;
    throw err;
  }
}

/**
 * Simple semaphore for concurrency control.
 */
class Semaphore {
  private count = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

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

/**
 * Enroll TOTP MFA factors for users that have been imported into WorkOS.
 *
 * For each record:
 * 1. Look up the user by email
 * 2. Enroll TOTP factor with the provided secret
 * 3. Skip already-enrolled users (idempotent)
 */
export async function enrollTotp(
  workos: WorkOS,
  options: EnrollTotpOptions,
): Promise<{ summary: TotpEnrollSummary; errors: TotpErrorRecord[] }> {
  const { inputPath, format, concurrency, rateLimit, dryRun, errorsPath, totpIssuer } = options;

  const rateLimiter = new RateLimiter(rateLimit);
  const semaphore = new Semaphore(concurrency);
  const startedAt = Date.now();
  const errors: TotpErrorRecord[] = [];
  const warnings: string[] = [];
  let emailOnlyCount = 0;

  let errorStream: fs.WriteStream | null = null;
  if (errorsPath) {
    errorStream = fs.createWriteStream(errorsPath, { flags: 'w', encoding: 'utf8' });
  }

  const recordError = (errRec: TotpErrorRecord) => {
    if (errorStream) {
      errorStream.write(JSON.stringify(errRec) + '\n');
    } else {
      errors.push(errRec);
    }
  };

  const summary: TotpEnrollSummary = {
    total: 0,
    enrolled: 0,
    skipped: 0,
    failures: 0,
    userNotFound: 0,
    duration: 0,
    warnings,
  };

  // Load records
  const records = await loadTotpRecords(inputPath, format);
  summary.total = records.length;

  if (records.length === 0) {
    summary.duration = Date.now() - startedAt;
    return { summary, errors };
  }

  // Process with concurrency control
  const inFlight: Promise<void>[] = [];

  for (const [i, record] of records.entries()) {
    const recordNumber = i + 1;

    const task = (async () => {
      await semaphore.acquire();
      try {
        // Step 1: Resolve the target user. Prefer the record's external_id —
        // it uniquely identifies the source account, while emails can be
        // shared by multiple source accounts. A record with an external_id
        // that resolves no user is a failure, never an email fallback:
        // falling back would allow a same-email record from a different
        // source account to enroll its secret on this user.
        let userId: string | null = null;
        try {
          await rateLimiter.acquire();
          if (record.externalId) {
            userId = await lookupUserByExternalId(workos, record.externalId);
          } else {
            emailOnlyCount += 1;
            userId = await lookupUserByEmail(workos, record.email);
          }
        } catch (err: unknown) {
          const error = err as Record<string, unknown>;
          recordError({
            recordNumber,
            email: record.email,
            errorType: 'user_lookup',
            errorMessage: (error?.message as string) || 'User lookup failed',
            timestamp: new Date().toISOString(),
            httpStatus: (error?.status as number) ?? undefined,
          });
          summary.failures += 1;
          return;
        }

        if (!userId) {
          recordError({
            recordNumber,
            email: record.email,
            errorType: 'user_lookup',
            errorMessage: record.externalId
              ? `No WorkOS user found for external_id: ${record.externalId} (email: ${record.email})`
              : `No WorkOS user found for email: ${record.email}`,
            timestamp: new Date().toISOString(),
          });
          summary.userNotFound += 1;
          summary.failures += 1;
          return;
        }

        if (dryRun) {
          summary.enrolled += 1;
          return;
        }

        // Step 2: Enroll TOTP factor with retry
        try {
          await withRetry(
            async () => {
              await rateLimiter.acquire();
              await workos.multiFactorAuth.createUserAuthFactor({
                userId: userId!,
                type: 'totp',
                totpSecret: record.totpSecret,
                ...(totpIssuer || record.totpIssuer
                  ? { totpIssuer: totpIssuer || record.totpIssuer }
                  : {}),
                ...(record.totpUser ? { totpUser: record.totpUser } : {}),
              });
            },
            {
              maxRetries: 3,
              retryOn: isRateLimitError,
            },
          );
          summary.enrolled += 1;
        } catch (err: unknown) {
          const error = err as Record<string, unknown>;
          const message = (error?.message as string) || 'Unknown error';

          // If factor already exists, count as skipped not failed
          if (/already.?enrolled|factor.?already.?exists|duplicate/i.test(message)) {
            summary.skipped += 1;
            return;
          }

          recordError({
            recordNumber,
            email: record.email,
            errorType: 'enroll_factor',
            errorMessage: message,
            timestamp: new Date().toISOString(),
            httpStatus: (error?.status as number) ?? undefined,
          });
          summary.failures += 1;
        }
      } finally {
        semaphore.release();
      }
    })();

    inFlight.push(task);

    // Drain in batches to avoid unbounded memory
    if (inFlight.length >= concurrency * 10) {
      await Promise.all(inFlight);
      inFlight.length = 0;
    }
  }

  // Wait for remaining tasks
  await Promise.all(inFlight);

  if (emailOnlyCount > 0) {
    warnings.push(
      `${emailOnlyCount} record(s) had no external_id and were matched by email only. ` +
        'Emails are not unique per account in some source systems, so a secret can bind to ' +
        'the wrong user. Include the source user id as external_id in the TOTP input for exact matching.',
    );
  }

  summary.duration = Date.now() - startedAt;

  if (errorStream) {
    const stream = errorStream;
    await new Promise<void>((resolve, reject) => {
      stream.once('finish', () => resolve());
      stream.once('error', reject);
      stream.end();
    });
  }

  return { summary, errors };
}
