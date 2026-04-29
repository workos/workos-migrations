import fs from 'node:fs/promises';
import path from 'node:path';
import { createCSVWriter } from '../shared/csv-utils.js';
import {
  MIGRATION_PACKAGE_FILES,
  MIGRATION_PACKAGE_CSV_HEADERS,
  createMigrationPackageManifest,
  isMigrationPackageCsvFileKey,
  type CreateMigrationPackageManifestOptions,
  type MigrationPackageCsvFileKey,
  type MigrationPackageFileKey,
  type MigrationPackageManifest,
} from './manifest.js';

export interface MigrationPackage {
  rootDir: string;
  manifest: MigrationPackageManifest;
  files: Record<MigrationPackageFileKey, string>;
}

export interface CreateMigrationPackageOptions extends CreateMigrationPackageManifestOptions {
  rootDir: string;
  createEmptyFiles?: boolean;
  handoffNotes?: string;
}

export type CsvCellValue = string | number | boolean | null | undefined;
export type CsvRow = Record<string, CsvCellValue>;

export async function createMigrationPackage(
  options: CreateMigrationPackageOptions,
): Promise<MigrationPackage> {
  const manifest = createMigrationPackageManifest(options);
  await fs.mkdir(options.rootDir, { recursive: true });
  await fs.mkdir(path.join(options.rootDir, 'sso'), { recursive: true });

  if (options.createEmptyFiles ?? true) {
    await createEmptyPackageFiles(options.rootDir, options.handoffNotes);
  }

  await writeMigrationPackageManifest(options.rootDir, manifest);

  return {
    rootDir: options.rootDir,
    manifest,
    files: resolvePackageFiles(options.rootDir),
  };
}

export async function loadMigrationPackage(rootDir: string): Promise<MigrationPackage> {
  const manifestPath = getPackageFilePath(rootDir, 'manifest');
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as MigrationPackageManifest;

  return {
    rootDir,
    manifest,
    files: resolvePackageFiles(rootDir),
  };
}

export async function writeMigrationPackageManifest(
  rootDir: string,
  manifest: MigrationPackageManifest,
): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true });
  await fs.writeFile(
    getPackageFilePath(rootDir, 'manifest'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf-8',
  );
}

export async function writePackageCsvRows(
  rootDir: string,
  fileKey: MigrationPackageCsvFileKey,
  rows: CsvRow[],
  headers: readonly string[] = MIGRATION_PACKAGE_CSV_HEADERS[fileKey],
): Promise<number> {
  const filePath = getPackageFilePath(rootDir, fileKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const writer = createCSVWriter(filePath, [...headers]);
  for (const row of rows) {
    writer.write(normalizeCsvRow(row, headers));
  }
  await writer.end();

  return rows.length;
}

export async function writePackageJsonlRecords(
  rootDir: string,
  fileKey: 'warnings' | 'skippedUsers',
  records: unknown[],
): Promise<number> {
  const filePath = getPackageFilePath(rootDir, fileKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const contents = records.map((record) => JSON.stringify(record)).join('\n');
  await fs.writeFile(filePath, contents ? `${contents}\n` : '', 'utf-8');
  return records.length;
}

export async function createEmptyPackageFiles(
  rootDir: string,
  handoffNotes = '# SSO handoff notes\n\nNo SSO handoff notes were generated.\n',
): Promise<void> {
  await Promise.all(
    Object.entries(MIGRATION_PACKAGE_CSV_HEADERS).map(async ([key, headers]) => {
      if (!isMigrationPackageCsvFileKey(key)) return;
      const filePath = getPackageFilePath(rootDir, key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${headers.join(',')}\n`, 'utf-8');
    }),
  );

  await Promise.all([
    writePackageJsonlRecords(rootDir, 'warnings', []),
    writePackageJsonlRecords(rootDir, 'skippedUsers', []),
    fs.writeFile(getPackageFilePath(rootDir, 'handoffNotes'), handoffNotes, 'utf-8'),
  ]);
}

export function getPackageFilePath(rootDir: string, fileKey: MigrationPackageFileKey): string {
  return path.join(rootDir, MIGRATION_PACKAGE_FILES[fileKey]);
}

export function resolvePackageFiles(rootDir: string): Record<MigrationPackageFileKey, string> {
  return Object.fromEntries(
    Object.keys(MIGRATION_PACKAGE_FILES).map((key) => [
      key,
      getPackageFilePath(rootDir, key as MigrationPackageFileKey),
    ]),
  ) as Record<MigrationPackageFileKey, string>;
}

function normalizeCsvRow(row: CsvRow, headers: readonly string[]): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const header of headers) {
    const value = row[header];
    if (value === undefined || value === null) {
      normalized[header] = '';
    } else if (typeof value === 'boolean') {
      normalized[header] = value ? 'true' : 'false';
    } else {
      normalized[header] = String(value);
    }
  }

  return normalized;
}
