/**
 * Token bucket rate limiter for controlling API request rates.
 *
 * Used in single-threaded mode. Worker threads use the distributed
 * rate limiter (coordinator-based IPC) instead.
 */
export class RateLimiter {
    tokens;
    maxTokens;
    refillRate;
    lastRefill;
    constructor(tokensPerSecond) {
        this.maxTokens = tokensPerSecond;
        this.tokens = tokensPerSecond;
        this.refillRate = tokensPerSecond;
        this.lastRefill = Date.now();
    }
    refill() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
        this.lastRefill = now;
    }
    async acquire() {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }
        const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
        await sleep(waitMs);
        this.refill();
        this.tokens -= 1;
    }
    getAvailableTokens() {
        this.refill();
        return this.tokens;
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Retry a function with exponential backoff.
 * Respects Retry-After headers from API responses.
 */
export async function withRetry(fn, options = {}) {
    const { maxRetries = 3, baseDelayMs = 500, retryOn } = options;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (attempt === maxRetries)
                break;
            if (retryOn && !retryOn(error))
                break;
            const retryAfter = getRetryAfterMs(error);
            const delay = retryAfter ?? baseDelayMs * Math.pow(2, attempt);
            await sleep(delay);
        }
    }
    throw lastError;
}
function getRetryAfterMs(error) {
    if (error &&
        typeof error === 'object' &&
        'response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'headers' in error.response) {
        const headers = error.response.headers;
        const retryAfter = headers?.['retry-after'];
        if (retryAfter) {
            const seconds = parseFloat(retryAfter);
            if (!isNaN(seconds))
                return seconds * 1000;
        }
    }
    return undefined;
}
/**
 * Check if an error is a rate limit (429) response.
 */
export function isRateLimitError(error) {
    if (error && typeof error === 'object' && 'status' in error) {
        return error.status === 429;
    }
    if (error &&
        typeof error === 'object' &&
        'response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'status' in error.response) {
        return error.response.status === 429;
    }
    return false;
}
