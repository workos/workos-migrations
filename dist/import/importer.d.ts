import type { WorkOS } from '@workos-inc/node';
import type { CSVRow, CreateUserPayload, ImportSummary } from '../shared/types.js';
import { CheckpointManager } from './checkpoint.js';
declare class Semaphore {
    private max;
    private count;
    private queue;
    constructor(max: number);
    acquire(): Promise<void>;
    release(): void;
}
export declare const KNOWN_COLUMNS: Set<string>;
interface OrgInfo {
    orgId?: string;
    orgExternalId?: string;
    orgName?: string;
}
declare function buildUserAndOrgFromRow(row: CSVRow): {
    userPayload?: CreateUserPayload;
    orgInfo?: OrgInfo;
    roleSlugs?: string[];
    error?: string;
};
interface RateLimiterLike {
    acquire(): Promise<void>;
}
declare function retryCreateUser(workos: WorkOS, payload: CreateUserPayload, limiter: RateLimiterLike, maxRetries?: number, baseDelayMs?: number): Promise<string>;
interface MembershipResult {
    rolesAssigned: number;
    warning?: string;
}
declare function retryCreateMembership(workos: WorkOS, userId: string, organizationId: string, limiter: RateLimiterLike, roleSlugs?: string[], maxRetries?: number, baseDelayMs?: number): Promise<MembershipResult>;
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
export declare function runImport(options: ImporterOptions): Promise<ImportSummary>;
export { buildUserAndOrgFromRow, retryCreateUser, retryCreateMembership, Semaphore, type RateLimiterLike, type MembershipResult, };
