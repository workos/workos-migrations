import { parentPort } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

interface PendingRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class DistributedRateLimiter {
  private pendingRequests: Map<string, PendingRequest>;
  private messageHandler: ((msg: any) => void) | null = null;

  constructor() {
    this.pendingRequests = new Map();
    this.setupMessageHandler();
  }

  async acquire(): Promise<void> {
    const requestId = randomUUID();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Rate limit request timeout after 5s (requestId: ${requestId})`));
      }, 5000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      if (!parentPort) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(new Error('parentPort is null - not running in worker thread'));
        return;
      }

      parentPort.postMessage({
        type: 'rate-limit-request',
        requestId,
      });
    });
  }

  private setupMessageHandler(): void {
    if (!parentPort) {
      throw new Error('DistributedRateLimiter must be used in worker thread');
    }

    this.messageHandler = (msg: any) => {
      if (msg.type === 'rate-limit-grant' && typeof msg.requestId === 'string') {
        this.handleGrant(msg.requestId);
      }
    };

    parentPort.on('message', this.messageHandler);
  }

  private handleGrant(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      pending.resolve();
    }
  }

  cleanup(): void {
    if (parentPort && this.messageHandler) {
      parentPort.off('message', this.messageHandler);
      this.messageHandler = null;
    }
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Worker shutting down (requestId: ${requestId})`));
    }
    this.pendingRequests.clear();
  }

  getPendingCount(): number {
    return this.pendingRequests.size;
  }
}
