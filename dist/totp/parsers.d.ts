import type { TotpRecord } from '../shared/types.js';
/**
 * Auto-detect input format from file extension.
 */
export declare function detectFormat(filePath: string): 'csv' | 'ndjson';
/**
 * Parse TOTP records from a CSV file.
 * Expected columns: email, totp_secret (required), totp_issuer, totp_user (optional)
 */
export declare function parseTotpCsv(filePath: string): Promise<TotpRecord[]>;
/**
 * Parse TOTP records from an NDJSON/JSONL file.
 * Handles multiple schema variations:
 * - Direct totp_secret or secret field
 * - mfa_factors array with type: "totp" entries
 * - Auth0 MFA enrollment format
 */
export declare function parseTotpNdjson(filePath: string): Promise<TotpRecord[]>;
/**
 * Load TOTP records from a file, auto-detecting format.
 */
export declare function loadTotpRecords(filePath: string, format?: 'csv' | 'ndjson'): Promise<TotpRecord[]>;
