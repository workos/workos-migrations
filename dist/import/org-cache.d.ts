import type { WorkOS } from '@workos-inc/node';
import type { SerializedCacheEntry } from '../shared/types.js';
export interface OrgCacheStats {
    hits: number;
    misses: number;
    evictions: number;
    size: number;
    capacity: number;
    hitRate: number;
}
export interface OrgResolveOptions {
    orgId?: string;
    orgExternalId?: string;
    createIfMissing?: boolean;
    orgName?: string;
}
export interface OrgCacheOptions {
    maxSize?: number;
    dryRun?: boolean;
}
export declare class OrgCache {
    private cache;
    private inFlightRequests;
    private stats;
    private readonly maxSize;
    private readonly dryRun;
    private workos;
    constructor(workos: WorkOS | null, options?: OrgCacheOptions);
    resolve(options: OrgResolveOptions): Promise<string | null>;
    private get;
    private set;
    private fetchAndCache;
    private generateCacheKey;
    getStats(): OrgCacheStats;
    serialize(): SerializedCacheEntry[];
    static deserialize(workos: WorkOS | null, entries: SerializedCacheEntry[], options?: OrgCacheOptions): OrgCache;
    mergeEntries(entries: SerializedCacheEntry[]): void;
}
