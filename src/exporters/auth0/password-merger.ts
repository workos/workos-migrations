import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import type { Auth0PasswordRecord, PasswordLookup } from '../../shared/types.js';

export async function loadPasswordHashes(filePath: string): Promise<PasswordLookup> {
  const lookup: PasswordLookup = {};

  const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const record: Auth0PasswordRecord = JSON.parse(line);
      if (!record.email || !record.passwordHash) continue;

      const email = record.email.toLowerCase();
      const algorithm = detectHashAlgorithm(record.passwordHash);

      lookup[email] = {
        hash: record.passwordHash,
        algorithm,
        setDate: record.password_set_date?.$date,
      };
    } catch {
      // Skip invalid JSON lines
    }
  }

  return lookup;
}

export function detectHashAlgorithm(hash: string): string {
  // Bcrypt: $2a$, $2b$, $2x$, $2y$
  if (/^\$2[abxy]\$/.test(hash)) return 'bcrypt';
  // MD5: 32 hex characters
  if (/^[a-f0-9]{32}$/i.test(hash)) return 'md5';
  // SHA256: 64 hex characters
  if (/^[a-f0-9]{64}$/i.test(hash)) return 'sha256';
  // SHA512: 128 hex characters
  if (/^[a-f0-9]{128}$/i.test(hash)) return 'sha512';
  // PBKDF2: colon-separated
  if (hash.includes(':')) return 'pbkdf2';
  // Default to bcrypt (Auth0 primarily uses bcrypt)
  return 'bcrypt';
}

export interface MergeStats {
  totalRows: number;
  passwordsAdded: number;
  passwordsNotFound: number;
}

export async function mergePasswordsIntoCsv(
  inputCsv: string,
  outputCsv: string,
  passwordLookup: PasswordLookup,
): Promise<MergeStats> {
  // First pass: collect rows and determine columns
  const rows: Record<string, string>[] = [];
  let outputColumns: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const inputStream = createReadStream(inputCsv);
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    inputStream
      .pipe(parser)
      .on('data', (row: Record<string, string>) => {
        if (rows.length === 0) {
          const existing = Object.keys(row);
          outputColumns = existing.includes('password_hash')
            ? existing
            : [...existing, 'password_hash', 'password_hash_type'];
        }
        rows.push(row);
      })
      .on('end', resolve)
      .on('error', reject);
  });

  // Second pass: merge passwords and write output
  let passwordsAdded = 0;
  let passwordsNotFound = 0;

  return new Promise((resolve, reject) => {
    const outputStream = createWriteStream(outputCsv);
    const stringifier = stringify({ header: true, columns: outputColumns });

    // Pipe must be set up BEFORE writing data
    stringifier
      .pipe(outputStream)
      .on('finish', () => {
        resolve({
          totalRows: rows.length,
          passwordsAdded,
          passwordsNotFound,
        });
      })
      .on('error', reject);

    for (const row of rows) {
      const email = row.email?.toLowerCase();

      if (email && passwordLookup[email]) {
        const passwordData = passwordLookup[email];
        row.password_hash = passwordData.hash;
        row.password_hash_type = passwordData.algorithm;
        passwordsAdded++;
      } else {
        row.password_hash = row.password_hash || '';
        row.password_hash_type = row.password_hash_type || '';
        passwordsNotFound++;
      }

      stringifier.write(row);
    }

    stringifier.end();
  });
}
