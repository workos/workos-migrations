import { jest } from '@jest/globals';
import { getRetryDelayMs, RateLimiter, withRetry } from '../rate-limiter.js';
import { DEFAULT_IMPORT_RATE_LIMIT } from '../../import/importer.js';

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-09-09T12:00:00Z') });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('RateLimiter', () => {
  it('keeps a 4,000-request migration below the AuthKit write ceiling at the default rate', async () => {
    const limiter = new RateLimiter(DEFAULT_IMPORT_RATE_LIMIT);
    const granted: number[] = [];
    const requests = Array.from({ length: 4000 }, () =>
      limiter.acquire().then(() => {
        granted.push(Date.now());
      }),
    );
    await jest.runAllTimersAsync();
    await Promise.all(requests);
    expect(granted).toHaveLength(4000);
    let start = 0;
    for (let end = 0; end < granted.length; end++) {
      while (granted[end] - granted[start] >= 10_000) start++;
      expect(end - start + 1).toBeLessThan(500);
    }
  });

  it('paces concurrent callers after the initial burst without overspending tokens', async () => {
    const limiter = new RateLimiter(50);
    const granted: number[] = [];
    const startedAt = Date.now();
    const requests = Array.from({ length: 100 }, () =>
      limiter.acquire().then(() => {
        granted.push(Date.now() - startedAt);
        expect(limiter.getAvailableTokens()).toBeGreaterThanOrEqual(0);
      }),
    );

    await jest.advanceTimersByTimeAsync(0);
    expect(granted).toHaveLength(50);
    await jest.advanceTimersByTimeAsync(20);
    expect(granted).toHaveLength(51);
    await jest.advanceTimersByTimeAsync(980);
    await Promise.all(requests);
    expect(granted.slice(50)).toEqual(Array.from({ length: 50 }, (_, i) => (i + 1) * 20));
  });

  it('does not accumulate more than one bucket during idle time', async () => {
    const limiter = new RateLimiter(2);
    await limiter.acquire();
    await jest.advanceTimersByTimeAsync(60_000);
    let granted = 0;
    const requests = Array.from({ length: 3 }, () =>
      limiter.acquire().then(() => {
        granted++;
      }),
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(granted).toBe(2);
    await jest.advanceTimersByTimeAsync(500);
    await Promise.all(requests);
    expect(granted).toBe(3);
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid rate %s', (rate) => {
    expect(() => new RateLimiter(rate)).toThrow('positive finite');
  });

  it('supports fractional rates', async () => {
    const limiter = new RateLimiter(0.5);
    await limiter.acquire();
    let granted = false;
    const next = limiter.acquire().then(() => {
      granted = true;
    });
    await jest.advanceTimersByTimeAsync(1999);
    expect(granted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await next;
    expect(granted).toBe(true);
  });
});

describe('retry delays', () => {
  it.each([
    [{ retryAfter: 2 }, 2000],
    [{ retryAfter: 0 }, 0],
    [{ retryAfter: null, response: { headers: { 'retry-after': '0.5' } } }, 500],
    [{ response: { headers: { 'Retry-After': 'Wed, 09 Sep 2026 12:00:03 GMT' } } }, 3000],
    [{ response: { headers: new Headers({ 'Retry-After': '2' }) } }, 2000],
  ])('honors server retry delay %j', (error, delay) => {
    expect(getRetryDelayMs(error, 0)).toBe(delay);
  });

  it.each([undefined, '', 'invalid', -1, Infinity, NaN])(
    'uses jittered backoff for invalid retryAfter %s',
    (retryAfter) => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      expect(getRetryDelayMs({ retryAfter }, 0)).toBe(562);
      expect(getRetryDelayMs({ retryAfter }, 1)).toBe(1125);
    },
  );

  it('waits for SDK retryAfter before retrying', async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ status: 429, retryAfter: 2 })
      .mockResolvedValue('ok');
    const result = withRetry(fn);
    await jest.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
