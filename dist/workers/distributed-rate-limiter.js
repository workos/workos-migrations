import { parentPort } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
export class DistributedRateLimiter {
    pendingRequests;
    messageHandler = null;
    constructor() {
        this.pendingRequests = new Map();
        this.setupMessageHandler();
    }
    async acquire() {
        const requestId = randomUUID();
        return new Promise((resolve, reject) => {
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
    setupMessageHandler() {
        if (!parentPort) {
            throw new Error('DistributedRateLimiter must be used in worker thread');
        }
        this.messageHandler = (msg) => {
            if (msg.type === 'rate-limit-grant' && typeof msg.requestId === 'string') {
                this.handleGrant(msg.requestId);
            }
        };
        parentPort.on('message', this.messageHandler);
    }
    handleGrant(requestId) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(requestId);
            pending.resolve();
        }
    }
    cleanup() {
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
    getPendingCount() {
        return this.pendingRequests.size;
    }
}
