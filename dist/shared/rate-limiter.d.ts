/**
 * Token bucket rate limiter for controlling API request rates.
 *
 * Used in single-threaded mode. Worker threads use the distributed
 * rate limiter (coordinator-based IPC) instead.
 */
export declare class RateLimiter {
    private tokens;
    private readonly maxTokens;
    private readonly refillRate;
    private lastRefill;
    constructor(tokensPerSecond: number);
    private refill;
    acquire(): Promise<void>;
    getAvailableTokens(): number;
}
/**
 * Retry a function with exponential backoff.
 * Respects Retry-After headers from API responses.
 */
export declare function withRetry<T>(fn: () => Promise<T>, options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    retryOn?: (error: unknown) => boolean;
}): Promise<T>;
/**
 * Check if an error is a rate limit (429) response.
 */
export declare function isRateLimitError(error: unknown): boolean;
