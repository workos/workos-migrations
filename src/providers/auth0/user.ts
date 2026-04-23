/**
 * Auth0 user → WorkOS users.csv row builder.
 *
 * Handles every Auth0 connection type (database, social, enterprise,
 * passwordless) and degrades gracefully when optional fields are missing.
 *
 * Output matches the shared WorkOS users template:
 *   user_id, email, email_verified, first_name, last_name, password_hash
 *
 * `password_hash` is always blank. The Auth0 Management API does not expose
 * password hashes via `/api/v2/users`; use the Auth0 users-export extension
 * job for bulk hash export, or accept that affected users will need to reset
 * their password post-migration.
 */
import type { Auth0User } from './client';
import { UserRow } from '../../shared/csv';
import { splitName, looksLikeEmail, looksLikePhone } from '../../shared/names';

/**
 * Map an Auth0 user into the WorkOS users.csv shape.
 *
 *   user_id        → Auth0 `user_id` preserved verbatim (includes the provider
 *                    prefix like `auth0|...`, `google-oauth2|...`,
 *                    `samlp|connection-name|...`). Preserving the prefix keeps
 *                    user_id unique across connections.
 *   email          → Auth0 `email` (blank for phone-only passwordless users)
 *   email_verified → serialized as 'true' / 'false' when Auth0 returns a boolean;
 *                    blank when Auth0 omitted the field
 *   first_name     → `given_name`, or first token of `name` when `name` is a
 *                    real display name (not the user's email or phone number)
 *   last_name      → `family_name`, or remaining tokens of `name` under the
 *                    same guard
 *   password_hash  → always blank
 */
export function toWorkOSUserRow(u: Auth0User): UserRow {
  const email = typeof u.email === 'string' ? u.email : '';
  const emailVerified =
    typeof u.email_verified === 'boolean'
      ? String(u.email_verified)
      : typeof u.email_verified === 'string'
        ? u.email_verified
        : '';

  const givenName = typeof u.given_name === 'string' ? u.given_name : '';
  const familyName = typeof u.family_name === 'string' ? u.family_name : '';
  const name = typeof u.name === 'string' ? u.name : '';

  let firstName = givenName;
  let lastName = familyName;

  // Fall back to splitting `name` ONLY when given/family are both missing AND
  // `name` is a real display name. Many providers (passwordless, GitHub, SMS)
  // set `name` to the email address or phone number when no display name is
  // available — splitting those produces garbage.
  if (!firstName && !lastName && name && !looksLikeEmail(name) && !looksLikePhone(name)) {
    const split = splitName(name);
    firstName = split.first;
    lastName = split.last;
  }

  return {
    user_id: typeof u.user_id === 'string' ? u.user_id : '',
    email,
    email_verified: emailVerified,
    first_name: firstName,
    last_name: lastName,
    password_hash: '',
  };
}

export interface UserTransformSummary {
  total: number;
  missingEmail: number;
  missingName: number;
  byProvider: Record<string, number>;
}

/** Aggregate post-transform stats useful for logging + warnings. */
export function summarizeAuth0Users(users: Auth0User[], rows: UserRow[]): UserTransformSummary {
  const byProvider: Record<string, number> = {};
  for (const u of users) {
    const provider = providerPrefix(u.user_id);
    byProvider[provider] = (byProvider[provider] ?? 0) + 1;
  }
  return {
    total: rows.length,
    missingEmail: rows.filter((r) => !r.email).length,
    missingName: rows.filter((r) => !r.first_name && !r.last_name).length,
    byProvider,
  };
}

/**
 * Pull the provider prefix out of an Auth0 `user_id` — the part before the
 * first `|`. Returns `'unknown'` when no prefix is found.
 *
 *   "auth0|123..."                 → "auth0"
 *   "google-oauth2|109..."         → "google-oauth2"
 *   "samlp|acme-saml|user@..."     → "samlp"
 */
export function providerPrefix(userId: unknown): string {
  if (typeof userId !== 'string') return 'unknown';
  const idx = userId.indexOf('|');
  return idx > 0 ? userId.slice(0, idx) : 'unknown';
}
