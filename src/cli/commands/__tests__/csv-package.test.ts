import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMigrationPackage } from '../../../package/writer';
import { validateMigrationPackage } from '../../../package/validator';
import { MIGRATION_PACKAGE_CSV_HEADERS, MIGRATION_PACKAGE_FILES } from '../../../package/manifest';

// These tests exercise the same orchestration the CSV-package CLI commands wrap.
// They keep the CLI argv parsing path out of test scope (commander side-effects on
// process.exit) and verify the actual contract: a generated skeleton validates,
// a populated package validates, and a header-mismatched package fails.

describe('csv package skeleton + validator', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-csv-package-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('createMigrationPackage produces a skeleton that validates against the contract', async () => {
    const pkgDir = path.join(tempRoot, 'skeleton');
    await createMigrationPackage({
      provider: 'csv',
      rootDir: pkgDir,
      entitiesRequested: ['users', 'organizations', 'memberships'],
      warnings: [],
    });

    // Every canonical CSV file should exist with its header row only.
    for (const [key, headers] of Object.entries(MIGRATION_PACKAGE_CSV_HEADERS)) {
      const fullPath = path.join(
        pkgDir,
        MIGRATION_PACKAGE_FILES[key as keyof typeof MIGRATION_PACKAGE_FILES],
      );
      expect(fs.existsSync(fullPath)).toBe(true);
      const firstLine = fs.readFileSync(fullPath, 'utf-8').split(/\r?\n/)[0];
      expect(firstLine).toBe(headers.join(','));
    }

    const validation = await validateMigrationPackage(pkgDir);
    expect(validation.valid).toBe(true);
  });

  it('validates a populated CSV package and surfaces row count mismatches', async () => {
    const pkgDir = path.join(tempRoot, 'populated');
    await createMigrationPackage({
      provider: 'csv',
      rootDir: pkgDir,
      entitiesRequested: ['users'],
      entitiesExported: { users: 1 },
      warnings: [],
    });

    const userHeaders = MIGRATION_PACKAGE_CSV_HEADERS.users;
    const userRow = userHeaders
      .map((header) => (header === 'email' ? 'alice@example.com' : ''))
      .join(',');
    fs.writeFileSync(path.join(pkgDir, 'users.csv'), `${userHeaders.join(',')}\n${userRow}\n`);

    const valid = await validateMigrationPackage(pkgDir);
    expect(valid.valid).toBe(true);

    // Mutate the manifest to claim the wrong user count and confirm the validator catches it.
    const manifestPath = path.join(pkgDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.entitiesExported.users = 5;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const invalid = await validateMigrationPackage(pkgDir);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.some((issue) => issue.code === 'entity_count_mismatch')).toBe(true);
  });

  it('flags non-canonical CSV headers', async () => {
    const pkgDir = path.join(tempRoot, 'broken-headers');
    await createMigrationPackage({
      provider: 'csv',
      rootDir: pkgDir,
      entitiesRequested: ['users'],
      warnings: [],
    });

    fs.writeFileSync(
      path.join(pkgDir, 'users.csv'),
      'email,wrong_column\nalice@example.com,oops\n',
    );

    const result = await validateMigrationPackage(pkgDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === 'invalid_csv_header')).toBe(true);
  });
});
