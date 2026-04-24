import type { WorkOS } from '@workos-inc/node';
import type { ChunkMetadata, ChunkSummary, WorkerImportOptions } from '../shared/types.js';
import { type RateLimiterLike } from '../import/importer.js';
import { OrgCache } from '../import/org-cache.js';
export declare function processChunkInWorker(workos: WorkOS, chunk: ChunkMetadata, options: WorkerImportOptions, orgCache: OrgCache | null, rateLimiter: RateLimiterLike, checkpointDir: string): Promise<ChunkSummary>;
