/** Shared parsing for numeric CLI flags. */

/**
 * Parse a flag that must be a positive integer. `parseInt` returns NaN for
 * garbage, which silently degrades into a no-op import, so fail at parse time.
 */
export function parsePositiveInteger(value: unknown, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer (got "${String(value)}")`);
  }
  return parsed;
}
