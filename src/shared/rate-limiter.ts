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
  private queue: Promise<void> = Promise.resolve();

  constructor(tokensPerSecond: number) {
    if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) {
      throw new Error('Rate limit must be a positive finite number');
    }
    this.maxTokens = Math.max(1, tokensPerSecond);
    this.tokens = this.maxTokens;
    this.refillRate = tokensPerSecond;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  acquire(): Promise<void> {
    const request = this.queue.then(async () => {
      this.refill();
      while (this.tokens < 1) {
        await sleep(Math.ceil(((1 - this.tokens) / this.refillRate) * 1000));
        this.refill();
      }
      this.tokens -= 1;
    });
    this.queue = request.catch(() => {});
    return request;
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

      await sleep(getRetryDelayMs(error, attempt, baseDelayMs));
    }
  }

  throw lastError;
}

export function getRetryDelayMs(error: unknown, attempt: number, baseDelayMs = 500): number {
  const retryAfter = getRetryAfterMs(error);
  if (retryAfter !== undefined) return retryAfter;
  const backoff = baseDelayMs * Math.pow(2, attempt);
  return backoff + Math.floor(Math.random() * backoff * 0.25);
}

function getRetryAfterMs(error: unknown, depth = 0): number | undefined {
  if (!error || typeof error !== 'object' || depth > 3) return undefined;
  const sdkDelay = 'retryAfter' in error ? parseRetryAfter(error.retryAfter) : undefined;
  if (sdkDelay !== undefined) return sdkDelay;
  const headerDelay = getRetryAfterFromHeaders(error);
  if (headerDelay !== undefined) return headerDelay;
  // The SDK wraps anything it cannot classify (an unparseable error body, a
  // dropped socket) in a plain Error, so the real response is on the cause.
  return 'cause' in error ? getRetryAfterMs(error.cause, depth + 1) : undefined;
}

function getRetryAfterFromHeaders(error: object): number | undefined {
  if (!('response' in error) || !error.response || typeof error.response !== 'object') {
    return undefined;
  }
  const response = error.response;
  if (!('headers' in response)) return undefined;
  const headers = response.headers;
  if (headers instanceof Headers) return parseRetryAfter(headers.get('retry-after'));
  if (headers && typeof headers === 'object') {
    const header = Object.entries(headers).find(([key]) => key.toLowerCase() === 'retry-after');
    return parseRetryAfter(header?.[1]);
  }
  return undefined;
}

function parseRetryAfter(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) {
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
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
