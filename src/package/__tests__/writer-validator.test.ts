import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MIGRATION_PACKAGE_FILES } from '../manifest';
import {
  createMigrationPackage,
  loadMigrationPackage,
  writeMigrationPackageManifest,
  writePackageCsvRows,
  writePackageJsonlRecords,
} from '../writer';
import { validateMigrationPackage } from '../validator';

describe('migration package writer and validator', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-package-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates, loads, and validates an empty package without provider-specific code', async () => {
    await createMigrationPackage({
      rootDir: tempRoot,
      provider: 'auth0',
      sourceTenant: 'example.us.auth0.com',
      generatedAt: '2026-04-29T00:00:00.000Z',
      entitiesRequested: ['users', 'sso'],
      secretRedaction: {
        mode: 'redacted',
        redacted: true,
        redactedFields: ['client_secret'],
        files: ['raw/auth0-connections.jsonl'],
      },
    });

    const loaded = await loadMigrationPackage(tempRoot);
    expect(loaded.manifest.provider).toBe('auth0');
    expect(loaded.manifest.secretRedaction?.redactedFields).toEqual(['client_secret']);

    for (const relativePath of Object.values(MIGRATION_PACKAGE_FILES)) {
      expect(fs.existsSync(path.join(tempRoot, relativePath))).toBe(true);
    }

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('validates manifest counts against generated CSV and JSONL files', async () => {
    await createMigrationPackage({
      rootDir: tempRoot,
      provider: 'csv',
      generatedAt: '2026-04-29T00:00:00.000Z',
      entitiesRequested: ['users'],
      entitiesExported: {
        users: 1,
        warnings: 1,
      },
    });

    await writePackageCsvRows(tempRoot, 'users', [
      {
        email: 'alice@example.com',
        email_verified: true,
        external_id: 'auth0|alice',
        metadata: '{"source":"test"}',
      },
    ]);
    await writePackageJsonlRecords(tempRoot, 'warnings', [
      { code: 'missing_domains', message: 'No domains were found' },
    ]);

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(true);
  });

  it('reports count mismatches', async () => {
    await createMigrationPackage({
      rootDir: tempRoot,
      provider: 'csv',
      generatedAt: '2026-04-29T00:00:00.000Z',
      entitiesExported: {
        users: 1,
      },
    });

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'entity_count_mismatch')).toBe(true);
  });

  it('rejects noncanonical file paths for known manifest file keys', async () => {
    const migrationPackage = await createMigrationPackage({
      rootDir: tempRoot,
      provider: 'csv',
      generatedAt: '2026-04-29T00:00:00.000Z',
    });

    migrationPackage.manifest.files.users = 'nested/users.csv';
    await writeMigrationPackageManifest(tempRoot, migrationPackage.manifest);

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'noncanonical_file_path')).toBe(true);
  });

  it('rejects CSV files whose headers drift from the contract', async () => {
    await createMigrationPackage({
      rootDir: tempRoot,
      provider: 'csv',
      generatedAt: '2026-04-29T00:00:00.000Z',
    });

    fs.writeFileSync(path.join(tempRoot, 'users.csv'), 'email,external_id\n', 'utf-8');

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'invalid_csv_header')).toBe(true);
  });
});
