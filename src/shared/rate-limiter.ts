/**
 * Token bucket rate limiter for controlling API request rates.
 *
 * Used in single-threaded mode. Worker threads use the distributed
 * rate limiter (coordinator-based IPC) instead.
 */
export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private lastRefill: number;

  constructor(tokensPerSecond: number) {
    this.maxTokens = tokensPerSecond;
    this.tokens = tokensPerSecond;
    this.refillRate = tokensPerSecond;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
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

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff.
 * Respects Retry-After headers from API responses.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    retryOn?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 500, retryOn } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      if (attempt === maxRetries) break;
      if (retryOn && !retryOn(error)) break;

      const retryAfter = getRetryAfterMs(error);
      const delay = retryAfter ?? baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }

  throw lastError;
}

function getRetryAfterMs(error: unknown): number | undefined {
  if (
    error &&
    typeof error === 'object' &&
    'response' in error &&
    error.response &&
    typeof error.response === 'object' &&
    'headers' in error.response
  ) {
    const headers = (error.response as { headers?: Record<string, string> }).headers;
    const retryAfter = headers?.['retry-after'];
    if (retryAfter) {
      const seconds = parseFloat(retryAfter);
      if (!isNaN(seconds)) return seconds * 1000;
    }
  }
  return undefined;
}

/**
 * Check if an error is a rate limit (429) response.
 */
export function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    return (error as { status: number }).status === 429;
  }
  if (
    error &&
    typeof error === 'object' &&
    'response' in error &&
    error.response &&
    typeof error.response === 'object' &&
    'status' in error.response
  ) {
    return (error.response as { status: number }).status === 429;
  }
  return false;
}
