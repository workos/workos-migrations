import type { WorkOS } from '@workos-inc/node';
import type { TotpEnrollSummary, TotpErrorRecord } from '../shared/types.js';
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
 * Enroll TOTP MFA factors for users that have been imported into WorkOS.
 *
 * For each record:
 * 1. Look up the user by email
 * 2. Enroll TOTP factor with the provided secret
 * 3. Skip already-enrolled users (idempotent)
 */
export declare function enrollTotp(workos: WorkOS, options: EnrollTotpOptions): Promise<{
    summary: TotpEnrollSummary;
    errors: TotpErrorRecord[];
}>;
