import type { ClerkUserRow } from '../../shared/types.js';

/**
 * Determine whether a Clerk user's primary email address is verified.
 *
 * Clerk's CSV export records every address under either
 * `verified_email_addresses` or `unverified_email_addresses`. The primary
 * address is only verified when it appears in the verified column; otherwise it
 * must be treated as unverified so an unproven address is not promoted to a
 * verified WorkOS identity during import.
 */
export function isClerkPrimaryEmailVerified(row: ClerkUserRow, primaryEmail: string): boolean {
  const target = primaryEmail.trim().toLowerCase();
  if (!target) return false;

  const verified = (row.verified_email_addresses ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return verified.includes(target);
}
