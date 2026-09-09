import { parsePositiveInteger } from '../options';

describe('parsePositiveInteger', () => {
  it('accepts positive integers', () => {
    expect(parsePositiveInteger('10', '--concurrency')).toBe(10);
    expect(parsePositiveInteger(3, '--workers')).toBe(3);
  });

  it.each(['abc', '', '0', '-1', '1.5', undefined, null])('rejects %s', (value) => {
    // parseInt would return NaN here, and Math.max(1, NaN) is NaN, which stalls
    // the import semaphore instead of reporting anything.
    expect(() => parsePositiveInteger(value, '--concurrency')).toThrow(
      '--concurrency must be a positive integer',
    );
  });
});
