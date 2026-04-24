/**
 * Normalize URL-safe base64 to standard base64.
 * Firebase CLI sometimes emits URL-safe base64 (using - and _ instead of + and /).
 */
function normalizeBase64(value) {
    return value.replace(/-/g, '+').replace(/_/g, '/');
}
/**
 * Encode Firebase scrypt password into PHC format string.
 *
 * PHC format:
 *   $firebase-scrypt$hash=<b64hash>$salt=<b64salt>$sk=<b64signerKey>$ss=<b64saltSep>$r=<rounds>$m=<memCost>
 */
export function encodeFirebaseScryptPHC(userData, config) {
    const hash = normalizeBase64(userData.passwordHash);
    const salt = normalizeBase64(userData.salt);
    const sk = normalizeBase64(config.signerKey);
    const ss = normalizeBase64(config.saltSeparator);
    return `$firebase-scrypt$hash=${hash}$salt=${salt}$sk=${sk}$ss=${ss}$r=${config.rounds}$m=${config.memoryCost}`;
}
