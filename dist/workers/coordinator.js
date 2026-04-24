import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RateLimiter } from '../shared/rate-limiter.js';
import * as logger from '../shared/logger.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class WorkerCoordinator {
    workers = [];
    availableWorkers = new Set();
    chunkQueue = [];
    activeChunks = new Map();
    rateLimiter;
    checkpointManager;
    orgCache;
    importOptions;
    numWorkers;
    workerPath;
    allChunksDispatched = false;
    checkpointSaveLock = Promise.resolve();
    quiet;
    constructor(options) {
        this.checkpointManager = options.checkpointManager;
        this.numWorkers = options.numWorkers;
        this.orgCache = options.orgCache;
        this.importOptions = options.importOptions;
        this.rateLimiter = new RateLimiter(options.rateLimit);
        this.quiet = options.quiet;
        // Worker path resolves to compiled JS in dist/
        this.workerPath = path.join(__dirname, 'worker.js');
    }
    async start() {
        await this.initializeWorkers();
        this.loadChunkQueue();
        await this.processAllChunks();
        await this.shutdownWorkers();
        return this.checkpointManager.getFinalSummary();
    }
    async initializeWorkers() {
        const cacheEntries = this.orgCache?.serialize() || [];
        const checkpointDir = this.checkpointManager.getCheckpointDir();
        const workerReadyPromises = [];
        for (let i = 0; i < this.numWorkers; i++) {
            const worker = new Worker(this.workerPath, {
                workerData: { workerId: i },
            });
            worker.on('message', (msg) => this.handleWorkerMessage(i, msg));
            worker.on('error', (err) => {
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
            const readyPromise = new Promise((resolve) => {
                const handler = (msg) => {
                    if (msg.type === 'ready') {
                        worker.off('message', handler);
                        this.availableWorkers.add(i);
                        resolve();
                    }
                };
                worker.on('message', handler);
            });
            workerReadyPromises.push(readyPromise);
            const initPayload = {
                cacheEntries,
                options: this.importOptions,
                checkpointDir,
            };
            worker.postMessage({ type: 'initialize', payload: initPayload });
        }
        await Promise.all(workerReadyPromises);
        if (!this.quiet) {
            logger.info(`All ${this.numWorkers} workers initialized`);
        }
    }
    loadChunkQueue() {
        const state = this.checkpointManager.getState();
        this.chunkQueue = state.chunks.filter((c) => c.status === 'pending');
    }
    async processAllChunks() {
        this.dispatchChunks();
        while (this.activeChunks.size > 0 || this.chunkQueue.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    dispatchChunks() {
        while (this.chunkQueue.length > 0 && this.availableWorkers.size > 0) {
            const chunk = this.chunkQueue.shift();
            const workerIdIter = this.availableWorkers.values().next();
            if (workerIdIter.done || workerIdIter.value === undefined) {
                this.chunkQueue.unshift(chunk);
                break;
            }
            const workerId = workerIdIter.value;
            this.availableWorkers.delete(workerId);
            this.activeChunks.set(chunk.chunkId, workerId);
            const payload = { chunk };
            const worker = this.workers[workerId];
            if (!worker) {
                this.chunkQueue.unshift(chunk);
                continue;
            }
            worker.postMessage({ type: 'process-chunk', payload });
        }
        if (this.chunkQueue.length === 0 && !this.allChunksDispatched) {
            this.allChunksDispatched = true;
        }
    }
    handleWorkerMessage(workerId, msg) {
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
    async handleRateLimitRequest(workerId, requestId) {
        await this.rateLimiter.acquire();
        const worker = this.workers[workerId];
        if (!worker)
            return;
        worker.postMessage({ type: 'rate-limit-grant', requestId });
    }
    async handleChunkComplete(workerId, payload) {
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
            logger.info(`Chunk ${chunkId} complete — ${progress.completedChunks}/${progress.totalChunks} (${progress.percentComplete}%)`);
        }
        this.dispatchChunks();
    }
    handleChunkFailed(workerId, payload) {
        const { chunkId, error } = payload;
        logger.error(`Chunk ${chunkId} failed on worker ${workerId}: ${error}`);
        this.activeChunks.delete(chunkId);
        this.availableWorkers.add(workerId);
        this.dispatchChunks();
    }
    handleWorkerFailure(workerId) {
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
    async shutdownWorkers() {
        const shutdownPromises = this.workers.map((worker) => {
            return new Promise((resolve) => {
                worker.on('exit', () => resolve());
                worker.postMessage({ type: 'shutdown' });
                setTimeout(() => {
                    worker.terminate();
                    resolve();
                }, 5000);
            });
        });
        await Promise.all(shutdownPromises);
    }
}
