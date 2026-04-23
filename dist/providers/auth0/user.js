"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWorkOSUserRow = toWorkOSUserRow;
exports.summarizeAuth0Users = summarizeAuth0Users;
exports.providerPrefix = providerPrefix;
const names_1 = require("../../shared/names");
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
function toWorkOSUserRow(u) {
    const email = typeof u.email === 'string' ? u.email : '';
    const emailVerified = typeof u.email_verified === 'boolean'
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
    if (!firstName && !lastName && name && !(0, names_1.looksLikeEmail)(name) && !(0, names_1.looksLikePhone)(name)) {
        const split = (0, names_1.splitName)(name);
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
/** Aggregate post-transform stats useful for logging + warnings. */
function summarizeAuth0Users(users, rows) {
    const byProvider = {};
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
function providerPrefix(userId) {
    if (typeof userId !== 'string')
        return 'unknown';
    const idx = userId.indexOf('|');
    return idx > 0 ? userId.slice(0, idx) : 'unknown';
}
//# sourceMappingURL=user.js.map