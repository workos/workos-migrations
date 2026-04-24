import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { parse } from 'csv-parse';
import type { TotpRecord } from '../shared/types.js';

/**
 * Auto-detect input format from file extension.
 */
export function detectFormat(filePath: string): 'csv' | 'ndjson' {
  const ext = filePath.toLowerCase();
  if (ext.endsWith('.ndjson') || ext.endsWith('.jsonl')) {
    return 'ndjson';
  }
  return 'csv';
}

/**
 * Parse TOTP records from a CSV file.
 * Expected columns: email, totp_secret (required), totp_issuer, totp_user (optional)
 */
export async function parseTotpCsv(filePath: string): Promise<TotpRecord[]> {
  return new Promise((resolve, reject) => {
    const records: TotpRecord[] = [];
    const input = fs.createReadStream(filePath);
    const parser = parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
    });

    parser.on('data', (row: Record<string, string>) => {
      if (row.email && row.totp_secret) {
        records.push({
          email: row.email.toLowerCase().trim(),
          totpSecret: row.totp_secret.trim(),
          totpIssuer: row.totp_issuer?.trim() || undefined,
          totpUser: row.totp_user?.trim() || undefined,
        });
      }
    });
    parser.on('end', () => resolve(records));
    parser.on('error', reject);
    input.pipe(parser);
  });
}

interface NdjsonRecord {
  email: string;
  totp_secret?: string;
  secret?: string;
  mfa_factors?: Array<{
    type: string;
    secret?: string;
    totp_secret?: string;
  }>;
}

/**
 * Parse TOTP records from an NDJSON/JSONL file.
 * Handles multiple schema variations:
 * - Direct totp_secret or secret field
 * - mfa_factors array with type: "totp" entries
 * - Auth0 MFA enrollment format
 */
export async function parseTotpNdjson(filePath: string): Promise<TotpRecord[]> {
  const records: TotpRecord[] = [];
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const record: NdjsonRecord = JSON.parse(line);
      if (!record.email) continue;

      // Try direct totp_secret/secret field first
      let secret = record.totp_secret || record.secret;

      // Fall back to mfa_factors array
      if (!secret && record.mfa_factors) {
        const totpFactor = record.mfa_factors.find((f) => f.type === 'totp');
        secret = totpFactor?.secret || totpFactor?.totp_secret;
      }

      if (secret) {
        records.push({
          email: record.email.toLowerCase().trim(),
          totpSecret: secret.trim(),
        });
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  return records;
}

/**
 * Load TOTP records from a file, auto-detecting format.
 */
export async function loadTotpRecords(
  filePath: string,
  format?: 'csv' | 'ndjson',
): Promise<TotpRecord[]> {
  const resolvedFormat = format ?? detectFormat(filePath);
  return resolvedFormat === 'ndjson' ? parseTotpNdjson(filePath) : parseTotpCsv(filePath);
}
