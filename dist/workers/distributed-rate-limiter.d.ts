export declare class DistributedRateLimiter {
    private pendingRequests;
    private messageHandler;
    constructor();
    acquire(): Promise<void>;
    private setupMessageHandler;
    private handleGrant;
    cleanup(): void;
    getPendingCount(): number;
}
