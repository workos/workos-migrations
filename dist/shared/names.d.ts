/**
 * Name-parsing helpers shared across provider transforms.
 */
/**
 * Whitespace-split a full name into first/last halves. The first token becomes
 * first_name; everything after becomes last_name. Empty input → both empty.
 *
 *   "Prince"              → { first: "Prince", last: "" }
 *   "Jane Doe"            → { first: "Jane", last: "Doe" }
 *   "María García López"  → { first: "María", last: "García López" }
 *   "  extra  spaces  "   → { first: "extra", last: "spaces" }
 */
export declare function splitName(name: string | undefined | null): {
    first: string;
    last: string;
};
/**
 * True if a string looks like an email address. Used to avoid feeding an email
 * to `splitName` when a provider set `name` to the user's email (common for
 * passwordless and some social connections).
 */
export declare function looksLikeEmail(value: string | undefined | null): boolean;
/** True if a string looks like a phone number (E.164 or common formats). */
export declare function looksLikePhone(value: string | undefined | null): boolean;
//# sourceMappingURL=names.d.ts.map