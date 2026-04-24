import type { ImportSummary, WorkerImportOptions } from '../shared/types.js';
import { CheckpointManager } from '../import/checkpoint.js';
import { OrgCache } from '../import/org-cache.js';
export interface CoordinatorOptions {
    checkpointManager: CheckpointManager;
    numWorkers: number;
    orgCache: OrgCache | null;
    importOptions: WorkerImportOptions;
    rateLimit: number;
    quiet: boolean;
}
export declare class WorkerCoordinator {
    private workers;
    private availableWorkers;
    private chunkQueue;
    private activeChunks;
    private rateLimiter;
    private checkpointManager;
    private orgCache;
    private importOptions;
    private numWorkers;
    private workerPath;
    private allChunksDispatched;
    private checkpointSaveLock;
    private quiet;
    constructor(options: CoordinatorOptions);
    start(): Promise<ImportSummary>;
    private initializeWorkers;
    private loadChunkQueue;
    private processAllChunks;
    private dispatchChunks;
    private handleWorkerMessage;
    private handleRateLimitRequest;
    private handleChunkComplete;
    private handleChunkFailed;
    private handleWorkerFailure;
    private shutdownWorkers;
}
