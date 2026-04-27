import fs from 'node:fs';
import { RateLimiter, withRetry, isRateLimitError } from '../shared/rate-limiter.js';
import { loadTotpRecords } from './parsers.js';
/**
 * Look up a user in WorkOS by email. Returns the user ID or null.
 */
async function lookupUserByEmail(workos, email) {
    const users = await workos.userManagement.listUsers({ email });
    const data = users.data;
    if (data.length === 0)
        return null;
    const first = data[0];
    if (!first)
        return null;
    return first.id;
}
/**
 * Simple semaphore for concurrency control.
 */
class Semaphore {
    max;
    count = 0;
    queue = [];
    constructor(max) {
        this.max = max;
    }
    async acquire() {
        if (this.count < this.max) {
            this.count += 1;
            return;
        }
        await new Promise((resolve) => {
            this.queue.push(() => {
                this.count += 1;
                resolve();
            });
        });
    }
    release() {
        this.count -= 1;
        const next = this.queue.shift();
        if (next)
            next();
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
export async function enrollTotp(workos, options) {
    const { inputPath, format, concurrency, rateLimit, dryRun, errorsPath, totpIssuer } = options;
    const rateLimiter = new RateLimiter(rateLimit);
    const semaphore = new Semaphore(concurrency);
    const startedAt = Date.now();
    const errors = [];
    const warnings = [];
    let errorStream = null;
    if (errorsPath) {
        errorStream = fs.createWriteStream(errorsPath, { flags: 'w', encoding: 'utf8' });
    }
    const recordError = (errRec) => {
        if (errorStream) {
            errorStream.write(JSON.stringify(errRec) + '\n');
        }
        else {
            errors.push(errRec);
        }
    };
    const summary = {
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
    const inFlight = [];
    for (const [i, record] of records.entries()) {
        const recordNumber = i + 1;
        const task = (async () => {
            await semaphore.acquire();
            try {
                // Step 1: Look up user by email
                let userId = null;
                try {
                    await rateLimiter.acquire();
                    userId = await lookupUserByEmail(workos, record.email);
                }
                catch (err) {
                    const error = err;
                    recordError({
                        recordNumber,
                        email: record.email,
                        errorType: 'user_lookup',
                        errorMessage: error?.message || 'User lookup failed',
                        timestamp: new Date().toISOString(),
                        httpStatus: error?.status ?? undefined,
                    });
                    summary.failures += 1;
                    return;
                }
                if (!userId) {
                    recordError({
                        recordNumber,
                        email: record.email,
                        errorType: 'user_lookup',
                        errorMessage: `No WorkOS user found for email: ${record.email}`,
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
                    await withRetry(async () => {
                        await rateLimiter.acquire();
                        await workos.multiFactorAuth.createUserAuthFactor({
                            userId: userId,
                            type: 'totp',
                            totpSecret: record.totpSecret,
                            ...(totpIssuer || record.totpIssuer
                                ? { totpIssuer: totpIssuer || record.totpIssuer }
                                : {}),
                            ...(record.totpUser ? { totpUser: record.totpUser } : {}),
                        });
                    }, {
                        maxRetries: 3,
                        retryOn: isRateLimitError,
                    });
                    summary.enrolled += 1;
                }
                catch (err) {
                    const error = err;
                    const message = error?.message || 'Unknown error';
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
                        httpStatus: error?.status ?? undefined,
                    });
                    summary.failures += 1;
                }
            }
            finally {
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
    summary.duration = Date.now() - startedAt;
    if (errorStream) {
        const stream = errorStream;
        await new Promise((resolve, reject) => {
            stream.once('finish', () => resolve());
            stream.once('error', reject);
            stream.end();
        });
    }
    return { summary, errors };
}
