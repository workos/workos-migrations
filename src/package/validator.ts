import fs from 'node:fs/promises';
import path from 'node:path';
import { countCSVRows } from '../shared/csv-utils.js';
import {
  DEFAULT_ENTITY_COUNTS,
  MIGRATION_PACKAGE_CSV_HEADERS,
  MIGRATION_PACKAGE_FILES,
  MIGRATION_PACKAGE_FILE_KEYS,
  MIGRATION_PACKAGE_SCHEMA_VERSION,
  isMigrationPackageCsvFileKey,
  isMigrationPackageFileKey,
  type MigrationPackageFileKey,
  type MigrationPackageManifest,
} from './manifest.js';
import { getPackageFilePath } from './writer.js';

export type ValidationSeverity = 'error' | 'warning';

export interface MigrationPackageValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  file?: string;
  field?: string;
}

export interface MigrationPackageValidationResult {
  valid: boolean;
  errors: MigrationPackageValidationIssue[];
  warnings: MigrationPackageValidationIssue[];
  manifest?: MigrationPackageManifest;
}

export interface ValidateMigrationPackageOptions {
  requireFiles?: boolean;
  validateCsvHeaders?: boolean;
  validateCounts?: boolean;
}

type CountableFileKind = 'csv' | 'jsonl';

const COUNTABLE_FILES: Record<
  string,
  { fileKey: MigrationPackageFileKey; kind: CountableFileKind }
> = {
  users: { fileKey: 'users', kind: 'csv' },
  organizations: { fileKey: 'organizations', kind: 'csv' },
  memberships: { fileKey: 'memberships', kind: 'csv' },
  roles: { fileKey: 'roleDefinitions', kind: 'csv' },
  roleDefinitions: { fileKey: 'roleDefinitions', kind: 'csv' },
  roleAssignments: { fileKey: 'userRoleAssignments', kind: 'csv' },
  totpSecrets: { fileKey: 'totpSecrets', kind: 'csv' },
  samlConnections: { fileKey: 'samlConnections', kind: 'csv' },
  oidcConnections: { fileKey: 'oidcConnections', kind: 'csv' },
  customAttributeMappings: { fileKey: 'customAttributeMappings', kind: 'csv' },
  proxyRoutes: { fileKey: 'proxyRoutes', kind: 'csv' },
  warnings: { fileKey: 'warnings', kind: 'jsonl' },
  skippedUsers: { fileKey: 'skippedUsers', kind: 'jsonl' },
};

export async function validateMigrationPackage(
  rootDir: string,
  options: ValidateMigrationPackageOptions = {},
): Promise<MigrationPackageValidationResult> {
  const requireFiles = options.requireFiles ?? true;
  const validateCsvHeaders = options.validateCsvHeaders ?? true;
  const validateCounts = options.validateCounts ?? true;
  const issues: MigrationPackageValidationIssue[] = [];

  const manifestPath = getPackageFilePath(rootDir, 'manifest');
  const manifest = await readManifest(manifestPath, issues);
  if (!manifest) return result(issues);

  issues.push(...validateMigrationPackageManifest(manifest));

  if (isRecord(manifest.files)) {
    issues.push(...validateManifestFilePaths(manifest));

    if (requireFiles) {
      for (const fileKey of MIGRATION_PACKAGE_FILE_KEYS) {
        const manifestPathForKey = manifest.files[fileKey];
        if (!manifestPathForKey) continue;

        const fullPath = path.join(rootDir, manifestPathForKey);
        if (!(await fileExists(fullPath))) {
          issues.push({
            severity: 'error',
            code: 'missing_file',
            message: `Package file is missing: ${manifestPathForKey}`,
            file: manifestPathForKey,
          });
        }
      }
    }

    if (validateCsvHeaders) {
      await validatePackageCsvHeaders(rootDir, manifest, issues);
    }

    if (validateCounts) {
      await validatePackageCounts(rootDir, manifest, issues);
    }
  }

  return result(issues, manifest);
}

export function validateMigrationPackageManifest(
  manifest: MigrationPackageManifest,
): MigrationPackageValidationIssue[] {
  const issues: MigrationPackageValidationIssue[] = [];

  if (!isRecord(manifest)) {
    issues.push({
      severity: 'error',
      code: 'invalid_manifest',
      message: 'manifest.json must contain a JSON object',
    });
    return issues;
  }

  if (manifest.schemaVersion !== MIGRATION_PACKAGE_SCHEMA_VERSION) {
    issues.push({
      severity: 'error',
      code: 'unsupported_schema_version',
      message: `Unsupported migration package schemaVersion: ${String(manifest.schemaVersion)}`,
      field: 'schemaVersion',
    });
  }

  if (typeof manifest.provider !== 'string' || manifest.provider.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'missing_provider',
      message: 'manifest.provider must be a non-empty string',
      field: 'provider',
    });
  }

  if (typeof manifest.generatedAt !== 'string' || Number.isNaN(Date.parse(manifest.generatedAt))) {
    issues.push({
      severity: 'error',
      code: 'invalid_generated_at',
      message: 'manifest.generatedAt must be an ISO timestamp string',
      field: 'generatedAt',
    });
  }

  if (!Array.isArray(manifest.entitiesRequested)) {
    issues.push({
      severity: 'error',
      code: 'invalid_entities_requested',
      message: 'manifest.entitiesRequested must be an array',
      field: 'entitiesRequested',
    });
  }

  if (!isRecord(manifest.entitiesExported)) {
    issues.push({
      severity: 'error',
      code: 'invalid_entities_exported',
      message: 'manifest.entitiesExported must be an object of non-negative integer counts',
      field: 'entitiesExported',
    });
  } else {
    for (const [entity, count] of Object.entries(manifest.entitiesExported)) {
      if (!Number.isInteger(count) || count < 0) {
        issues.push({
          severity: 'error',
          code: 'invalid_entity_count',
          message: `manifest.entitiesExported.${entity} must be a non-negative integer`,
          field: `entitiesExported.${entity}`,
        });
      }
    }
  }

  if (!isRecord(manifest.files)) {
    issues.push({
      severity: 'error',
      code: 'invalid_files',
      message: 'manifest.files must be an object',
      field: 'files',
    });
  }

  if (!isRecord(manifest.importability)) {
    issues.push({
      severity: 'error',
      code: 'invalid_importability',
      message: 'manifest.importability must be an object',
      field: 'importability',
    });
  }

  if (typeof manifest.secretsRedacted !== 'boolean') {
    issues.push({
      severity: 'error',
      code: 'invalid_secrets_redacted',
      message: 'manifest.secretsRedacted must be a boolean',
      field: 'secretsRedacted',
    });
  }

  if (!Array.isArray(manifest.warnings)) {
    issues.push({
      severity: 'error',
      code: 'invalid_warnings',
      message: 'manifest.warnings must be an array',
      field: 'warnings',
    });
  }

  return issues;
}

export async function assertValidMigrationPackage(
  rootDir: string,
  options?: ValidateMigrationPackageOptions,
): Promise<MigrationPackageManifest> {
  const validation = await validateMigrationPackage(rootDir, options);
  if (!validation.valid) {
    throw new Error(validation.errors.map((issue) => issue.message).join('\n'));
  }
  return validation.manifest as MigrationPackageManifest;
}

function validateManifestFilePaths(
  manifest: MigrationPackageManifest,
): MigrationPackageValidationIssue[] {
  const issues: MigrationPackageValidationIssue[] = [];

  for (const [key, value] of Object.entries(manifest.files)) {
    if (typeof value !== 'string' || value.trim() === '') {
      issues.push({
        severity: 'error',
        code: 'invalid_file_path',
        message: `manifest.files.${key} must be a non-empty relative path`,
        field: `files.${key}`,
      });
      continue;
    }

    if (isUnsafeRelativePath(value)) {
      issues.push({
        severity: 'error',
        code: 'unsafe_file_path',
        message: `manifest.files.${key} must stay inside the package directory`,
        field: `files.${key}`,
        file: value,
      });
    }

    if (!isMigrationPackageFileKey(key)) {
      issues.push({
        severity: 'warning',
        code: 'unknown_file_key',
        message: `manifest.files.${key} is not a canonical package file key`,
        field: `files.${key}`,
        file: value,
      });
      continue;
    }

    const expectedPath = MIGRATION_PACKAGE_FILES[key];
    if (value !== expectedPath) {
      issues.push({
        severity: 'error',
        code: 'noncanonical_file_path',
        message: `manifest.files.${key} must be "${expectedPath}"`,
        field: `files.${key}`,
        file: value,
      });
    }
  }
  return issues;
}

async function validatePackageCsvHeaders(
  rootDir: string,
  manifest: MigrationPackageManifest,
  issues: MigrationPackageValidationIssue[],
): Promise<void> {
  for (const [key, expectedHeaders] of Object.entries(MIGRATION_PACKAGE_CSV_HEADERS)) {
    if (!isMigrationPackageCsvFileKey(key)) continue;

    const relativePath = manifest.files[key];
    if (!relativePath) continue;

    const fullPath = path.join(rootDir, relativePath);
    if (!(await fileExists(fullPath))) continue;

    const actualHeaders = await readCsvHeader(fullPath);
    if (!actualHeaders) {
      issues.push({
        severity: 'error',
        code: 'missing_csv_header',
        message: `CSV file is missing a header row: ${relativePath}`,
        file: relativePath,
      });
      continue;
    }

    if (!arraysEqual(actualHeaders, [...expectedHeaders])) {
      issues.push({
        severity: 'error',
        code: 'invalid_csv_header',
        message: `CSV header for ${relativePath} does not match the package contract`,
        file: relativePath,
      });
    }
  }
}

async function validatePackageCounts(
  rootDir: string,
  manifest: MigrationPackageManifest,
  issues: MigrationPackageValidationIssue[],
): Promise<void> {
  const counts = {
    ...DEFAULT_ENTITY_COUNTS,
    ...manifest.entitiesExported,
  };

  for (const [entity, expectedCount] of Object.entries(counts)) {
    const countable = COUNTABLE_FILES[entity];
    if (!countable) continue;

    const relativePath = manifest.files[countable.fileKey];
    if (!relativePath) continue;

    const fullPath = path.join(rootDir, relativePath);
    if (!(await fileExists(fullPath))) continue;

    const actualCount =
      countable.kind === 'csv'
        ? await countCsvRowsSafely(fullPath, relativePath, issues)
        : await countJsonlRecords(fullPath, relativePath, issues);

    if (actualCount === undefined) continue;
    if (actualCount !== expectedCount) {
      issues.push({
        severity: 'error',
        code: 'entity_count_mismatch',
        message: `manifest.entitiesExported.${entity} is ${expectedCount}, but ${relativePath} contains ${actualCount} records`,
        field: `entitiesExported.${entity}`,
        file: relativePath,
      });
    }
  }
}

async function readManifest(
  manifestPath: string,
  issues: MigrationPackageValidationIssue[],
): Promise<MigrationPackageManifest | undefined> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as MigrationPackageManifest;
  } catch (error) {
    issues.push({
      severity: 'error',
      code: 'manifest_read_failed',
      message: `Unable to read manifest.json: ${(error as Error).message}`,
      file: MIGRATION_PACKAGE_FILES.manifest,
    });
    return undefined;
  }
}

async function readCsvHeader(filePath: string): Promise<string[] | undefined> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const firstLine = raw.split(/\r?\n/, 1)[0]?.replace(/^\uFEFF/, '');
  if (!firstLine) return undefined;
  return firstLine.split(',').map((header) => header.trim());
}

async function countCsvRowsSafely(
  filePath: string,
  relativePath: string,
  issues: MigrationPackageValidationIssue[],
): Promise<number | undefined> {
  try {
    return await countCSVRows(filePath);
  } catch (error) {
    issues.push({
      severity: 'error',
      code: 'csv_parse_failed',
      message: `Unable to parse CSV file ${relativePath}: ${(error as Error).message}`,
      file: relativePath,
    });
    return undefined;
  }
}

async function countJsonlRecords(
  filePath: string,
  relativePath: string,
  issues: MigrationPackageValidationIssue[],
): Promise<number> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '');

  lines.forEach((line, index) => {
    try {
      JSON.parse(line);
    } catch {
      issues.push({
        severity: 'error',
        code: 'jsonl_parse_failed',
        message: `Invalid JSONL record in ${relativePath} on line ${index + 1}`,
        file: relativePath,
      });
    }
  });

  return lines.length;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isUnsafeRelativePath(value: string): boolean {
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) return true;
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  return normalized === '..' || normalized.startsWith('../');
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function result(
  issues: MigrationPackageValidationIssue[],
  manifest?: MigrationPackageManifest,
): MigrationPackageValidationResult {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    ...(manifest ? { manifest } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
