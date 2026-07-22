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

/**
 * Extract the Auth0 `_id.$oid` from a CSV `external_id`.
 *
 * `mapAuth0UserToWorkOS` sets `external_id` to the Auth0 `user_id`, which for
 * database-connection users is `<strategy>|<oid>` (e.g. `auth0|<oid>`). The
 * password export keys each record by that same `<oid>` under `_id.$oid`, so we
 * match on the bare oid and stay agnostic to the strategy prefix.
 */
export function extractAuth0Oid(externalId: string | undefined): string | undefined {
  if (!externalId) return undefined;
  const trimmed = externalId.trim();
  if (!trimmed) return undefined;
  const separator = trimmed.lastIndexOf('|');
  return separator === -1 ? trimmed : trimmed.slice(separator + 1);
}

export async function loadPasswordHashes(filePath: string): Promise<PasswordLookup> {
  const lookup: PasswordLookup = {
    byOid: {},
    emailCounts: {},
    recordsWithoutId: 0,
    duplicateOids: [],
  };

  const seenOids = new Set<string>();
  const duplicateOids = new Set<string>();

  const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const record: Auth0PasswordRecord = JSON.parse(line);
      if (!record.email || !record.passwordHash) continue;

      const email = record.email.toLowerCase();
      lookup.emailCounts[email] = (lookup.emailCounts[email] ?? 0) + 1;

      const oid = record._id?.$oid;
      if (!oid) {
        // Without a stable identity we cannot safely bind this hash to a user.
        lookup.recordsWithoutId++;
        continue;
      }

      if (seenOids.has(oid)) {
        // A repeated identity is ambiguous. Rather than silently keeping the
        // last hash (the class of bug this change fixes), drop any binding for
        // this oid entirely so no user can receive a possibly-wrong hash.
        delete lookup.byOid[oid];
        duplicateOids.add(oid);
        continue;
      }
      seenOids.add(oid);

      const algorithm = detectHashAlgorithm(record.passwordHash);
      lookup.byOid[oid] = {
        hash: record.passwordHash,
        algorithm,
        setDate: record.password_set_date?.$date,
      };
    } catch {
      // Skip invalid JSON lines
    }
  }

  lookup.duplicateOids = [...duplicateOids];
  return lookup;
}

/** Lowercased emails that appear on more than one password record. */
export function duplicateEmails(lookup: PasswordLookup): string[] {
  return Object.entries(lookup.emailCounts)
    .filter(([, count]) => count > 1)
    .map(([email]) => email);
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
      const oid = extractAuth0Oid(row.external_id);
      const passwordData = oid ? passwordLookup.byOid[oid] : undefined;

      if (passwordData) {
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
    | 'package_users_csv_missing'
    | 'duplicate_email_in_password_export'
    | 'duplicate_user_id_in_password_export'
    | 'password_record_without_id';
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
    const oid = extractAuth0Oid(externalId);
    const candidate = oid ? passwordLookup.byOid[oid] : undefined;
    if (!candidate) {
      stats.passwordsNotFound++;
      continue;
    }

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

  const collidingEmails = duplicateEmails(passwordLookup);
  if (collidingEmails.length > 0) {
    stats.warnings.push({
      code: 'duplicate_email_in_password_export',
      message: `${collidingEmails.length} email(s) appear on multiple password records (multiple Auth0 connections). Hashes were bound by user_id, not email, so no user received another connection's hash.`,
    });
  }

  if (passwordLookup.duplicateOids.length > 0) {
    stats.warnings.push({
      code: 'duplicate_user_id_in_password_export',
      message: `${passwordLookup.duplicateOids.length} Auth0 user id(s) appeared on multiple password records. Those identities were treated as ambiguous and no hash was bound for them.`,
    });
  }

  if (passwordLookup.recordsWithoutId > 0) {
    stats.warnings.push({
      code: 'password_record_without_id',
      message: `${passwordLookup.recordsWithoutId} password record(s) had no _id.$oid and were skipped because they could not be safely matched to a user by identity.`,
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
