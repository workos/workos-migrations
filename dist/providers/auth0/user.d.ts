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
export declare function toWorkOSUserRow(u: Auth0User): UserRow;
export interface UserTransformSummary {
    total: number;
    missingEmail: number;
    missingName: number;
    byProvider: Record<string, number>;
}
/** Aggregate post-transform stats useful for logging + warnings. */
export declare function summarizeAuth0Users(users: Auth0User[], rows: UserRow[]): UserTransformSummary;
/**
 * Pull the provider prefix out of an Auth0 `user_id` — the part before the
 * first `|`. Returns `'unknown'` when no prefix is found.
 *
 *   "auth0|123..."                 → "auth0"
 *   "google-oauth2|109..."         → "google-oauth2"
 *   "samlp|acme-saml|user@..."     → "samlp"
 */
export declare function providerPrefix(userId: unknown): string;
