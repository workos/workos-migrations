import type { Auth0Job, Auth0User, Auth0UserExportField } from '../../shared/types.js';
export interface BulkExportClient {
    createUserExportJob(options?: {
        connectionId?: string;
        format?: 'json' | 'csv';
        limit?: number;
        fields?: Auth0UserExportField[];
    }): Promise<Auth0Job>;
    getJob(jobId: string): Promise<Auth0Job>;
    downloadJobLocation(location: string): Promise<string | ArrayBuffer | Uint8Array>;
}
export interface RunAuth0BulkExportOptions {
    connectionId?: string;
    fields?: Auth0UserExportField[];
    /** How many ms to wait between job-status polls. Defaults to 2_000. */
    pollIntervalMs?: number;
    /** Maximum poll attempts. Defaults to 150 (~5 minutes at 2s). */
    maxPollAttempts?: number;
    /** Optional sleep injection for tests. */
    sleep?: (ms: number) => Promise<void>;
}
export interface RunAuth0BulkExportResult {
    job: Auth0Job;
    users: Auth0User[];
    pollAttempts: number;
}
export declare function runAuth0BulkUserExport(client: BulkExportClient, options?: RunAuth0BulkExportOptions): Promise<RunAuth0BulkExportResult>;
export declare function parseAuth0BulkExportPayload(payload: string | ArrayBuffer | Uint8Array): Auth0User[];
