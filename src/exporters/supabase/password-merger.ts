import { createReadStream, createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import {
  MIGRATION_PACKAGE_CSV_HEADERS,
  type MigrationPackageManifest,
} from '../../package/manifest.js';
import { getPackageFilePath, writeMigrationPackageManifest } from '../../package/writer.js';
import type { SupabasePasswordMergeOptions } from '../../shared/types.js';
import { SupabasePgClient, type SupabasePgQueryClient } from './pg-client.js';

interface PasswordRow {
  email: string;
  encrypted_password: string | null;
}

export interface PasswordMergeStats {
  totalRows: number;
  matched: number;
  missing: number;
  unsupportedAlgo: number;
  uploadRowsUpdated: number;
  warnings: string[];
}

const BCRYPT_RE = /^\$2[abxy]\$/;
const EMAIL_BATCH_SIZE = 1000;

export interface MergeSupabasePasswordsInternal extends SupabasePasswordMergeOptions {
  /** Test seam — defaults to constructing a real SupabasePgClient. */
  clientFactory?: (dbUrl: string) => SupabasePgQueryClient;
}

export async function mergeSupabasePasswords(
  options: MergeSupabasePasswordsInternal,
): Promise<PasswordMergeStats> {
  const packageDir = path.resolve(options.packageDir);
  const usersCsvPath = getPackageFilePath(packageDir, 'users');
  const uploadUsersCsvPath = getPackageFilePath(packageDir, 'uploadUsers');
  const manifestPath = getPackageFilePath(packageDir, 'manifest');

  await assertSupabasePackage(manifestPath);

  if (!(await pathExists(usersCsvPath))) {
    throw new Error(
      `Package users.csv not found at ${usersCsvPath}. Run export-supabase --package first.`,
    );
  }

  const usersHeaders = [...MIGRATION_PACKAGE_CSV_HEADERS.users];
  const usersRows = await readCsvWithFixedHeaders(usersCsvPath, usersHeaders);

  const stats: PasswordMergeStats = {
    totalRows: usersRows.length,
    matched: 0,
    missing: 0,
    unsupportedAlgo: 0,
    uploadRowsUpdated: 0,
    warnings: [],
  };

  if (usersRows.length === 0) {
    return stats;
  }

  const pg: SupabasePgQueryClient = options.clientFactory
    ? options.clientFactory(options.dbUrl)
    : new SupabasePgClient({ connectionString: options.dbUrl });
  if (pg.poolerWarning) stats.warnings.push(pg.poolerWarning);

  const passwordByEmail = new Map<string, string>();
  try {
    await pg.testConnection();

    const emails = uniqueEmails(usersRows);
    for (let i = 0; i < emails.length; i += EMAIL_BATCH_SIZE) {
      const batch = emails.slice(i, i + EMAIL_BATCH_SIZE);
      const rows = await pg.query<PasswordRow>(
        'SELECT email, encrypted_password FROM auth.users WHERE email = ANY($1)',
        [batch],
      );
      for (const row of rows) {
        if (row.email && row.encrypted_password) {
          passwordByEmail.set(row.email.toLowerCase(), row.encrypted_password);
        }
      }
    }
  } finally {
    await pg.close();
  }

  const hashByExternalId = new Map<string, string>();

  for (const row of usersRows) {
    const email = row.email?.toLowerCase().trim();
    if (!email) {
      stats.warnings.push('Skipping password merge for row with empty email column');
      continue;
    }
    const candidate = passwordByEmail.get(email);
    if (!candidate) {
      stats.missing++;
      continue;
    }

    if (!BCRYPT_RE.test(candidate)) {
      stats.unsupportedAlgo++;
      stats.warnings.push(
        `Skipped password hash for ${email}: unsupported algorithm (prefix ${candidate.slice(0, 4)}); only bcrypt is supported by WorkOS imports.`,
      );
      continue;
    }

    row.password_hash = candidate;
    row.password_hash_type = 'bcrypt';
    stats.matched++;

    if (row.external_id) hashByExternalId.set(row.external_id, candidate);
  }

  await writeCsvAtomic(usersCsvPath, usersHeaders, usersRows);

  if (await pathExists(uploadUsersCsvPath)) {
    const uploadHeaders = [...MIGRATION_PACKAGE_CSV_HEADERS.uploadUsers];
    const uploadRows = await readCsvWithFixedHeaders(uploadUsersCsvPath, uploadHeaders);
    for (const uploadRow of uploadRows) {
      const userId = uploadRow.user_id;
      const hash = userId ? hashByExternalId.get(userId) : undefined;
      if (hash) {
        uploadRow.password_hash = hash;
        stats.uploadRowsUpdated++;
      }
    }
    await writeCsvAtomic(uploadUsersCsvPath, uploadHeaders, uploadRows);
  }

  if (await pathExists(manifestPath)) {
    await updateManifest(manifestPath, stats);
  }

  return stats;
}

async function assertSupabasePackage(manifestPath: string): Promise<void> {
  if (!(await pathExists(manifestPath))) {
    throw new Error(
      `Manifest not found at ${manifestPath}. Run export-supabase --package first.`,
    );
  }
  const raw = await fsp.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as MigrationPackageManifest;
  if (manifest.provider !== 'supabase') {
    throw new Error(
      `Refusing to operate on package with provider "${manifest.provider}". merge-passwords-supabase only supports Supabase packages.`,
    );
  }
}

function uniqueEmails(rows: Record<string, string>[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const email = row.email?.toLowerCase().trim();
    if (email) set.add(email);
  }
  return Array.from(set);
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

async function writeCsvAtomic(
  filePath: string,
  headers: string[],
  rows: Record<string, string>[],
): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  await new Promise<void>((resolve, reject) => {
    const stringifier = stringify({ header: true, columns: headers });
    const out = createWriteStream(tmpPath);
    stringifier.pipe(out).on('finish', resolve).on('error', reject);
    for (const row of rows) {
      stringifier.write(row);
    }
    stringifier.end();
  });
  await fsp.rename(tmpPath, filePath);
}

async function updateManifest(
  manifestPath: string,
  stats: PasswordMergeStats,
): Promise<void> {
  const raw = await fsp.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as MigrationPackageManifest;
  manifest.metadata = {
    ...(manifest.metadata ?? {}),
    passwordMerge: {
      mergedAt: new Date().toISOString(),
      matched: stats.matched,
      missing: stats.missing,
      unsupportedAlgo: stats.unsupportedAlgo,
      uploadRowsUpdated: stats.uploadRowsUpdated,
    },
  };
  if (stats.warnings.length > 0) {
    manifest.warnings = [...(manifest.warnings ?? []), ...stats.warnings];
  }
  const rootDir = path.dirname(manifestPath);
  await writeMigrationPackageManifest(rootDir, manifest);
}
