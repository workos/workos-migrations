import type { FirebaseScryptConfig } from '../../shared/types.js';
export interface UserPasswordData {
    passwordHash: string;
    salt: string;
}
/**
 * Encode Firebase scrypt password into PHC format string.
 *
 * PHC format:
 *   $firebase-scrypt$hash=<b64hash>$salt=<b64salt>$sk=<b64signerKey>$ss=<b64saltSep>$r=<rounds>$m=<memCost>
 */
export declare function encodeFirebaseScryptPHC(userData: UserPasswordData, config: FirebaseScryptConfig): string;
