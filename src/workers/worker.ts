import { parentPort, workerData } from 'node:worker_threads';
import { WorkOS } from '@workos-inc/node';
import type {
  CoordinatorMessage,
  WorkerMessage,
  InitializePayload,
  ProcessChunkPayload,
  ChunkCompletePayload,
  ChunkFailedPayload,
  CacheUpdate,
} from '../shared/types.js';
import { DistributedRateLimiter } from './distributed-rate-limiter.js';
import { processChunkInWorker } from './chunk-processor.js';
import { OrgCache } from '../import/org-cache.js';

let workos: WorkOS | null = null;
let orgCache: OrgCache | null = null;
let rateLimiter: DistributedRateLimiter | null = null;
let importOptions: InitializePayload['options'] | null = null;
let checkpointDir = '';
let isShuttingDown = false;

function sendMessage(msg: WorkerMessage): void {
  if (parentPort && !isShuttingDown) {
    parentPort.postMessage(msg);
  }
}

async function handleInitialize(payload: InitializePayload): Promise<void> {
  try {
    // Each worker gets its own WorkOS client instance
    const apiKey = process.env.WORKOS_SECRET_KEY;
    if (apiKey && !payload.options.dryRun) {
      workos = new WorkOS(apiKey);
    }

    if (payload.cacheEntries && payload.cacheEntries.length > 0) {
      orgCache = OrgCache.deserialize(workos, payload.cacheEntries, {
        dryRun: payload.options.dryRun,
      });
    } else if (payload.options.orgId === null) {
      orgCache = new OrgCache(workos, { maxSize: 10000, dryRun: payload.options.dryRun });
    }

    rateLimiter = new DistributedRateLimiter();
    importOptions = payload.options;
    checkpointDir = payload.checkpointDir;

    sendMessage({ type: 'ready' });
  } catch (err: any) {
    console.error(`[Worker ${workerData?.workerId ?? '?'}] Initialization failed:`, err);
    process.exit(1);
  }
}

async function handleProcessChunk(payload: ProcessChunkPayload): Promise<void> {
  if (!rateLimiter || !importOptions) {
    sendMessage({
      type: 'chunk-failed',
      payload: { chunkId: payload.chunk.chunkId, error: 'Worker not initialized' },
    });
    return;
  }

  const { chunk } = payload;

  try {
    const summary = await processChunkInWorker(
      workos!,
      chunk,
      importOptions,
      orgCache,
      rateLimiter,
      checkpointDir,
    );

    const cacheUpdates: CacheUpdate[] = [];
    if (orgCache) {
      for (const entry of orgCache.serialize()) {
        cacheUpdates.push({
          key: entry.key,
          id: entry.id,
          externalId: entry.externalId,
          name: entry.name,
        });
      }
    }

    const completePayload: ChunkCompletePayload = {
      chunkId: chunk.chunkId,
      summary,
      cacheUpdates,
    };

    sendMessage({ type: 'chunk-complete', payload: completePayload });
  } catch (err: any) {
    console.error(`[Worker ${workerData?.workerId ?? '?'}] Chunk ${chunk.chunkId} failed:`, err);

    const failedPayload: ChunkFailedPayload = {
      chunkId: chunk.chunkId,
      error: err.message || String(err),
    };

    sendMessage({ type: 'chunk-failed', payload: failedPayload });
  }
}

function handleShutdown(): void {
  isShuttingDown = true;
  if (rateLimiter) rateLimiter.cleanup();
  process.exit(0);
}

if (!parentPort) {
  console.error('Worker must be run as a worker thread (parentPort is null)');
  process.exit(1);
}

parentPort.on('message', async (msg: CoordinatorMessage) => {
  try {
    switch (msg.type) {
      case 'initialize':
        await handleInitialize(msg.payload);
        break;
      case 'process-chunk':
        await handleProcessChunk(msg.payload);
        break;
      case 'rate-limit-grant':
        // Handled by DistributedRateLimiter's message handler
        break;
      case 'shutdown':
        handleShutdown();
        break;
    }
  } catch (err) {
    console.error(`[Worker ${workerData?.workerId ?? '?'}] Error handling message:`, err);
  }
});

process.on('uncaughtException', (err) => {
  console.error(`[Worker ${workerData?.workerId ?? '?'}] Uncaught exception:`, err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[Worker ${workerData?.workerId ?? '?'}] Unhandled rejection:`, reason);
  process.exit(1);
});
