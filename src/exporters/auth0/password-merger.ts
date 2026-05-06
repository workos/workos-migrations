import { createReadStream, createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import {
  MIGRATION_PACKAGE_CSV_HEADERS,
  type MigrationPackageManifest,
} from '../../package/manifest.js';
import { getPackageFilePath, writeMigrationPackageManifest } from '../../package/writer.js';
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

export const SUPPORTED_PACKAGE_PASSWORD_ALGORITHMS = new Set(['bcrypt', 'md5']);

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

export interface PackageMergeWarning {
  code:
    | 'unsupported_password_hash_algorithm'
    | 'missing_password_hash'
    | 'package_users_csv_missing';
  message: string;
  email?: string;
  external_id?: string;
  algorithm?: string;
}

export interface PackageMergeStats {
  totalRows: number;
  passwordsAdded: number;
  passwordsNotFound: number;
  passwordsRejectedAlgorithm: number;
  uploadRowsUpdated: number;
  warnings: PackageMergeWarning[];
}

export interface MergePasswordsIntoPackageOptions {
  packageDir: string;
  passwordsPath: string;
  /** Optional override of the supported hash algorithm set. */
  supportedAlgorithms?: Set<string>;
}

export async function mergePasswordsIntoPackage(
  options: MergePasswordsIntoPackageOptions,
): Promise<PackageMergeStats> {
  const supportedAlgorithms = options.supportedAlgorithms ?? SUPPORTED_PACKAGE_PASSWORD_ALGORITHMS;
  const packageDir = path.resolve(options.packageDir);
  const usersCsvPath = getPackageFilePath(packageDir, 'users');
  const uploadUsersCsvPath = getPackageFilePath(packageDir, 'uploadUsers');
  const manifestPath = getPackageFilePath(packageDir, 'manifest');

  if (!(await pathExists(usersCsvPath))) {
    return {
      totalRows: 0,
      passwordsAdded: 0,
      passwordsNotFound: 0,
      passwordsRejectedAlgorithm: 0,
      uploadRowsUpdated: 0,
      warnings: [
        {
          code: 'package_users_csv_missing',
          message: `Package users.csv not found at ${usersCsvPath}; merge skipped.`,
        },
      ],
    };
  }

  const passwordLookup = await loadPasswordHashes(options.passwordsPath);

  const stats: PackageMergeStats = {
    totalRows: 0,
    passwordsAdded: 0,
    passwordsNotFound: 0,
    passwordsRejectedAlgorithm: 0,
    uploadRowsUpdated: 0,
    warnings: [],
  };

  const usersHeaders = [...MIGRATION_PACKAGE_CSV_HEADERS.users];
  const usersRows = await readCsvWithFixedHeaders(usersCsvPath, usersHeaders);
  stats.totalRows = usersRows.length;

  const passwordHashByExternalId = new Map<string, string>();
  const algorithmByExternalId = new Map<string, string>();

  for (const row of usersRows) {
    const email = row.email?.toLowerCase();
    const externalId = row.external_id;
    if (!email || !passwordLookup[email]) {
      stats.passwordsNotFound++;
      continue;
    }

    const candidate = passwordLookup[email];
    if (!supportedAlgorithms.has(candidate.algorithm)) {
      stats.passwordsRejectedAlgorithm++;
      stats.warnings.push({
        code: 'unsupported_password_hash_algorithm',
        message: `Skipped password hash for ${email} because algorithm "${candidate.algorithm}" is not supported by WorkOS imports.`,
        email,
        ...(externalId ? { external_id: externalId } : {}),
        algorithm: candidate.algorithm,
      });
      continue;
    }

    row.password_hash = candidate.hash;
    row.password_hash_type = candidate.algorithm;
    stats.passwordsAdded++;

    if (externalId) {
      passwordHashByExternalId.set(externalId, candidate.hash);
      algorithmByExternalId.set(externalId, candidate.algorithm);
    }
  }

  await writeCsvWithFixedHeaders(usersCsvPath, usersHeaders, usersRows);

  if (await pathExists(uploadUsersCsvPath)) {
    const uploadHeaders = [...MIGRATION_PACKAGE_CSV_HEADERS.uploadUsers];
    const uploadRows = await readCsvWithFixedHeaders(uploadUsersCsvPath, uploadHeaders);
    for (const row of uploadRows) {
      const userId = row.user_id;
      if (userId && passwordHashByExternalId.has(userId)) {
        row.password_hash = passwordHashByExternalId.get(userId) ?? '';
        stats.uploadRowsUpdated++;
      }
    }
    await writeCsvWithFixedHeaders(uploadUsersCsvPath, uploadHeaders, uploadRows);
  }

  if (stats.passwordsNotFound > 0) {
    stats.warnings.push({
      code: 'missing_password_hash',
      message: `${stats.passwordsNotFound} package user(s) had no matching Auth0 password hash.`,
    });
  }

  if (await pathExists(manifestPath)) {
    await updatePackageManifestForMerge(manifestPath, stats);
  }

  return stats;
}

async function updatePackageManifestForMerge(
  manifestPath: string,
  stats: PackageMergeStats,
): Promise<void> {
  const raw = await fsp.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as MigrationPackageManifest;

  const messages = stats.warnings.map((warning) => warning.message);
  manifest.warnings = [...(manifest.warnings ?? []), ...messages];

  const counts = manifest.entitiesExported ?? {};
  counts.warnings = (counts.warnings ?? 0) + messages.length;
  manifest.entitiesExported = counts;

  manifest.metadata = {
    ...(manifest.metadata ?? {}),
    passwordMerge: {
      mergedAt: new Date().toISOString(),
      passwordsAdded: stats.passwordsAdded,
      passwordsNotFound: stats.passwordsNotFound,
      passwordsRejectedAlgorithm: stats.passwordsRejectedAlgorithm,
      uploadRowsUpdated: stats.uploadRowsUpdated,
    },
  };

  const rootDir = path.dirname(manifestPath);
  await writeMigrationPackageManifest(rootDir, manifest);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readCsvWithFixedHeaders(
  filePath: string,
  headers: string[],
): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  await new Promise<void>((resolve, reject) => {
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });
    createReadStream(filePath)
      .pipe(parser)
      .on('data', (row: Record<string, string>) => {
        const normalized: Record<string, string> = {};
        for (const header of headers) {
          normalized[header] = row[header] ?? '';
        }
        rows.push(normalized);
      })
      .on('end', resolve)
      .on('error', reject);
  });
  return rows;
}

async function writeCsvWithFixedHeaders(
  filePath: string,
  headers: string[],
  rows: Record<string, string>[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stringifier = stringify({ header: true, columns: headers });
    const out = createWriteStream(filePath);
    stringifier.pipe(out).on('finish', resolve).on('error', reject);
    for (const row of rows) {
      stringifier.write(row);
    }
    stringifier.end();
  });
}
