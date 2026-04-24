import type { CheckpointState, ChunkMetadata, ChunkSummary, CreateCheckpointOptions, ImportSummary } from '../shared/types.js';
import { OrgCache } from './org-cache.js';
export declare class CheckpointManager {
    private readonly checkpointDir;
    private readonly jobId;
    private state;
    private readonly checkpointPath;
    private constructor();
    static create(options: CreateCheckpointOptions): Promise<CheckpointManager>;
    static resume(jobId: string, checkpointDir?: string): Promise<CheckpointManager>;
    static exists(jobId: string, checkpointDir?: string): Promise<boolean>;
    saveCheckpoint(): Promise<void>;
    getState(): Readonly<CheckpointState>;
    getJobId(): string;
    getCheckpointDir(): string;
    getNextPendingChunk(): ChunkMetadata | null;
    markChunkStarted(chunkId: number): void;
    markChunkCompleted(chunkId: number, chunkSummary: ChunkSummary): void;
    markChunkFailed(chunkId: number): void;
    private updateSummary;
    getFinalSummary(): ImportSummary;
    getProgress(): {
        completedChunks: number;
        totalChunks: number;
        percentComplete: number;
        estimatedTimeRemainingMs: number | null;
    };
    serializeCache(cache: OrgCache): void;
    restoreCache(workos: import('@workos-inc/node').WorkOS | null, dryRun?: boolean): OrgCache | null;
    deleteCheckpoint(): Promise<void>;
}
export declare function calculateCsvHash(filePath: string): Promise<string>;
export declare function findLastJob(checkpointDir?: string): Promise<string | null>;
