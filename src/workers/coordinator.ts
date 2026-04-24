import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  WorkerMessage,
  CoordinatorMessage,
  InitializePayload,
  ProcessChunkPayload,
  ChunkCompletePayload,
  ChunkFailedPayload,
  ChunkMetadata,
  ImportSummary,
  WorkerImportOptions,
} from '../shared/types.js';
import { RateLimiter } from '../shared/rate-limiter.js';
import { CheckpointManager } from '../import/checkpoint.js';
import { OrgCache } from '../import/org-cache.js';
import * as logger from '../shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CoordinatorOptions {
  checkpointManager: CheckpointManager;
  numWorkers: number;
  orgCache: OrgCache | null;
  importOptions: WorkerImportOptions;
  rateLimit: number;
  quiet: boolean;
}

export class WorkerCoordinator {
  private workers: Worker[] = [];
  private availableWorkers: Set<number> = new Set();
  private chunkQueue: ChunkMetadata[] = [];
  private activeChunks: Map<number, number> = new Map();
  private rateLimiter: RateLimiter;
  private checkpointManager: CheckpointManager;
  private orgCache: OrgCache | null;
  private importOptions: WorkerImportOptions;
  private numWorkers: number;
  private workerPath: string;
  private allChunksDispatched = false;
  private checkpointSaveLock: Promise<void> = Promise.resolve();
  private quiet: boolean;

  constructor(options: CoordinatorOptions) {
    this.checkpointManager = options.checkpointManager;
    this.numWorkers = options.numWorkers;
    this.orgCache = options.orgCache;
    this.importOptions = options.importOptions;
    this.rateLimiter = new RateLimiter(options.rateLimit);
    this.quiet = options.quiet;

    // Worker path resolves to compiled JS in dist/
    this.workerPath = path.join(__dirname, 'worker.js');
  }

  async start(): Promise<ImportSummary> {
    await this.initializeWorkers();
    this.loadChunkQueue();
    await this.processAllChunks();
    await this.shutdownWorkers();
    return this.checkpointManager.getFinalSummary();
  }

  private async initializeWorkers(): Promise<void> {
    const cacheEntries = this.orgCache?.serialize() || [];
    const checkpointDir = this.checkpointManager.getCheckpointDir();
    const workerReadyPromises: Promise<void>[] = [];

    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker(this.workerPath, {
        workerData: { workerId: i },
      });

      worker.on('message', (msg: WorkerMessage) => this.handleWorkerMessage(i, msg));
      worker.on('error', (err: Error) => {
        logger.error(`Worker ${i} error: ${err.message}`);
        this.handleWorkerFailure(i);
      });
      worker.on('exit', (code) => {
        if (code !== 0) {
          logger.error(`Worker ${i} exited with code ${code}`);
          this.handleWorkerFailure(i);
        }
      });

      this.workers.push(worker);

      const readyPromise = new Promise<void>((resolve) => {
        const handler = (msg: WorkerMessage) => {
          if (msg.type === 'ready') {
            worker.off('message', handler);
            this.availableWorkers.add(i);
            resolve();
          }
        };
        worker.on('message', handler);
      });

      workerReadyPromises.push(readyPromise);

      const initPayload: InitializePayload = {
        cacheEntries,
        options: this.importOptions,
        checkpointDir,
      };

      worker.postMessage({ type: 'initialize', payload: initPayload } as CoordinatorMessage);
    }

    await Promise.all(workerReadyPromises);
    if (!this.quiet) {
      logger.info(`All ${this.numWorkers} workers initialized`);
    }
  }

  private loadChunkQueue(): void {
    const state = this.checkpointManager.getState();
    this.chunkQueue = state.chunks.filter((c) => c.status === 'pending');
  }

  private async processAllChunks(): Promise<void> {
    this.dispatchChunks();

    while (this.activeChunks.size > 0 || this.chunkQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private dispatchChunks(): void {
    while (this.chunkQueue.length > 0 && this.availableWorkers.size > 0) {
      const chunk = this.chunkQueue.shift()!;
      const workerIdIter = this.availableWorkers.values().next();
      if (workerIdIter.done || workerIdIter.value === undefined) {
        this.chunkQueue.unshift(chunk);
        break;
      }

      const workerId: number = workerIdIter.value;
      this.availableWorkers.delete(workerId);
      this.activeChunks.set(chunk.chunkId, workerId);

      const payload: ProcessChunkPayload = { chunk };
      const worker = this.workers[workerId];
      if (!worker) {
        this.chunkQueue.unshift(chunk);
        continue;
      }

      worker.postMessage({ type: 'process-chunk', payload } as CoordinatorMessage);
    }

    if (this.chunkQueue.length === 0 && !this.allChunksDispatched) {
      this.allChunksDispatched = true;
    }
  }

  private handleWorkerMessage(workerId: number, msg: WorkerMessage): void {
    switch (msg.type) {
      case 'ready':
        break;
      case 'rate-limit-request':
        this.handleRateLimitRequest(workerId, msg.requestId);
        break;
      case 'chunk-complete':
        this.handleChunkComplete(workerId, msg.payload);
        break;
      case 'chunk-failed':
        this.handleChunkFailed(workerId, msg.payload);
        break;
    }
  }

  private async handleRateLimitRequest(workerId: number, requestId: string): Promise<void> {
    await this.rateLimiter.acquire();

    const worker = this.workers[workerId];
    if (!worker) return;

    worker.postMessage({ type: 'rate-limit-grant', requestId } as CoordinatorMessage);
  }

  private async handleChunkComplete(
    workerId: number,
    payload: ChunkCompletePayload,
  ): Promise<void> {
    const { chunkId, summary, cacheUpdates } = payload;

    this.checkpointManager.markChunkCompleted(chunkId, summary);

    if (this.orgCache && cacheUpdates.length > 0) {
      this.orgCache.mergeEntries(cacheUpdates);
      this.checkpointManager.serializeCache(this.orgCache);
    }

    this.checkpointSaveLock = this.checkpointSaveLock.then(async () => {
      await this.checkpointManager.saveCheckpoint();
    });
    await this.checkpointSaveLock;

    this.activeChunks.delete(chunkId);
    this.availableWorkers.add(workerId);

    if (!this.quiet) {
      const progress = this.checkpointManager.getProgress();
      logger.info(
        `Chunk ${chunkId} complete — ${progress.completedChunks}/${progress.totalChunks} (${progress.percentComplete}%)`,
      );
    }

    this.dispatchChunks();
  }

  private handleChunkFailed(workerId: number, payload: ChunkFailedPayload): void {
    const { chunkId, error } = payload;
    logger.error(`Chunk ${chunkId} failed on worker ${workerId}: ${error}`);

    this.activeChunks.delete(chunkId);
    this.availableWorkers.add(workerId);
    this.dispatchChunks();
  }

  private handleWorkerFailure(workerId: number): void {
    for (const [chunkId, wId] of this.activeChunks.entries()) {
      if (wId === workerId) {
        const state = this.checkpointManager.getState();
        const chunk = state.chunks.find((c) => c.chunkId === chunkId);
        if (chunk) {
          this.chunkQueue.unshift({ ...chunk });
        }
        this.activeChunks.delete(chunkId);
      }
    }
    this.availableWorkers.delete(workerId);
    this.dispatchChunks();
  }

  private async shutdownWorkers(): Promise<void> {
    const shutdownPromises = this.workers.map((worker) => {
      return new Promise<void>((resolve) => {
        worker.on('exit', () => resolve());
        worker.postMessage({ type: 'shutdown' } as CoordinatorMessage);
        setTimeout(() => {
          worker.terminate();
          resolve();
        }, 5000);
      });
    });
    await Promise.all(shutdownPromises);
  }
}
