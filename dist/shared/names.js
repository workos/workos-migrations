"use strict";
/**
 * Name-parsing helpers shared across provider transforms.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitName = splitName;
exports.looksLikeEmail = looksLikeEmail;
exports.looksLikePhone = looksLikePhone;
/**
 * Whitespace-split a full name into first/last halves. The first token becomes
 * first_name; everything after becomes last_name. Empty input → both empty.
 *
 *   "Prince"              → { first: "Prince", last: "" }
 *   "Jane Doe"            → { first: "Jane", last: "Doe" }
 *   "María García López"  → { first: "María", last: "García López" }
 *   "  extra  spaces  "   → { first: "extra", last: "spaces" }
 */
function splitName(name) {
    const trimmed = (name ?? '').trim();
    if (!trimmed)
        return { first: '', last: '' };
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1)
        return { first: parts[0], last: '' };
    return {
        first: parts[0],
        last: parts.slice(1).join(' '),
    };
}
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[\d\s\-().]{6,}$/;
/**
 * True if a string looks like an email address. Used to avoid feeding an email
 * to `splitName` when a provider set `name` to the user's email (common for
 * passwordless and some social connections).
 */
function looksLikeEmail(value) {
    if (!value)
        return false;
    return EMAIL_REGEX.test(value.trim());
}
/** True if a string looks like a phone number (E.164 or common formats). */
function looksLikePhone(value) {
    if (!value)
        return false;
    const trimmed = value.trim();
    if (!PHONE_REGEX.test(trimmed))
        return false;
    // Require at least some digits — rejects pure punctuation strings
    return /\d/.test(trimmed);
}
//# sourceMappingURL=names.js.map