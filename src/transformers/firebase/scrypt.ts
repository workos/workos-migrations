import type { FirebaseScryptConfig } from '../../shared/types.js';

export interface UserPasswordData {
  passwordHash: string;
  salt: string;
}

/**
 * Normalize URL-safe base64 to standard base64.
 * Firebase CLI sometimes emits URL-safe base64 (using - and _ instead of + and /).
 * Also strips `=` padding: PHC B64 fields and parameter values must be unpadded,
 * and the import API's parser rejects padded values.
 */
function normalizeBase64(value: string): string {
  return value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
}

/**
 * Encode Firebase scrypt password into PHC format string.
 *
 * PHC format:
 *   $firebase-scrypt$v=1$r=<rounds>,m=<memCost>,ss=<b64saltSep>,sk=<b64signerKey>$<b64salt>$<b64hash>
 */
export function encodeFirebaseScryptPHC(
  userData: UserPasswordData,
  config: FirebaseScryptConfig,
): string {
  const hash = normalizeBase64(userData.passwordHash);
  const salt = normalizeBase64(userData.salt);
  const sk = normalizeBase64(config.signerKey);
  const ss = normalizeBase64(config.saltSeparator);

  return `$firebase-scrypt$v=1$r=${config.rounds},m=${config.memoryCost},ss=${ss},sk=${sk}$${salt}$${hash}`;
}
