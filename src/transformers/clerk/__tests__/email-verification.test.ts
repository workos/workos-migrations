import type { ClerkUserRow } from '../../../shared/types';
import { isClerkPrimaryEmailVerified } from '../email-verification';

function row(verified?: string): ClerkUserRow {
  return { verified_email_addresses: verified } as ClerkUserRow;
}

describe('isClerkPrimaryEmailVerified', () => {
  it('returns true when the primary address is in the verified column', () => {
    expect(isClerkPrimaryEmailVerified(row('alice@corp.com'), 'alice@corp.com')).toBe(true);
  });

  it('returns false when only a secondary address is verified', () => {
    expect(isClerkPrimaryEmailVerified(row('other@corp.com'), 'alice@corp.com')).toBe(false);
  });

  it('returns false when the column is missing or empty', () => {
    expect(isClerkPrimaryEmailVerified(row(undefined), 'alice@corp.com')).toBe(false);
    expect(isClerkPrimaryEmailVerified(row(''), 'alice@corp.com')).toBe(false);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(isClerkPrimaryEmailVerified(row(' Alice@Corp.com '), 'alice@corp.com')).toBe(true);
    expect(isClerkPrimaryEmailVerified(row('alice@corp.com'), ' ALICE@CORP.COM ')).toBe(true);
  });

  it('finds the primary address in comma, pipe, and semicolon separated lists', () => {
    expect(isClerkPrimaryEmailVerified(row('other@corp.com, alice@corp.com'), 'alice@corp.com')).toBe(true);
    expect(isClerkPrimaryEmailVerified(row('other@corp.com|alice@corp.com'), 'alice@corp.com')).toBe(true);
    expect(isClerkPrimaryEmailVerified(row('other@corp.com;alice@corp.com'), 'alice@corp.com')).toBe(true);
  });

  it('returns false for an empty primary address', () => {
    expect(isClerkPrimaryEmailVerified(row('alice@corp.com'), '')).toBe(false);
  });
});
