import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createMigrationPackage } from '../../../package/writer.js';
import {
  MIGRATION_PACKAGE_CSV_HEADERS,
  type MigrationPackageManifest,
} from '../../../package/manifest.js';
import {
  detectHashAlgorithm,
  loadPasswordHashes,
  mergePasswordsIntoCsv,
  mergePasswordsIntoPackage,
} from '../password-merger.js';

describe('Password Merger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-merge-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('detectHashAlgorithm', () => {
    it('should detect bcrypt hashes', () => {
      expect(detectHashAlgorithm('$2a$10$N9qo8uLOickgx2ZMRZoMy.')).toBe('bcrypt');
      expect(detectHashAlgorithm('$2b$12$something')).toBe('bcrypt');
      expect(detectHashAlgorithm('$2y$10$hash')).toBe('bcrypt');
    });

    it('should detect md5 hashes', () => {
      expect(detectHashAlgorithm('d41d8cd98f00b204e9800998ecf8427e')).toBe('md5');
    });

    it('should detect sha256 hashes', () => {
      const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      expect(detectHashAlgorithm(sha256)).toBe('sha256');
    });

    it('should detect pbkdf2 hashes', () => {
      expect(detectHashAlgorithm('sha1:1000:salt:hash')).toBe('pbkdf2');
    });

    it('should default to bcrypt for unknown formats', () => {
      expect(detectHashAlgorithm('some-unknown-hash')).toBe('bcrypt');
    });
  });

  describe('loadPasswordHashes', () => {
    it('should parse NDJSON password file', async () => {
      const ndjsonPath = path.join(tmpDir, 'passwords.ndjson');
      const lines = [
        JSON.stringify({
          email: 'Alice@Example.com',
          passwordHash: '$2a$10$abcdefghij',
          password_set_date: { $date: '2024-01-15T00:00:00.000Z' },
        }),
        JSON.stringify({
          email: 'bob@example.com',
          passwordHash: '$2b$12$klmnopqrst',
        }),
        '', // Empty line should be skipped
        'invalid json line',
      ].join('\n');

      fs.writeFileSync(ndjsonPath, lines);

      const lookup = await loadPasswordHashes(ndjsonPath);

      expect(Object.keys(lookup)).toHaveLength(2);
      // Email should be lowercased
      expect(lookup['alice@example.com']).toEqual({
        hash: '$2a$10$abcdefghij',
        algorithm: 'bcrypt',
        setDate: '2024-01-15T00:00:00.000Z',
      });
      expect(lookup['bob@example.com']).toEqual({
        hash: '$2b$12$klmnopqrst',
        algorithm: 'bcrypt',
        setDate: undefined,
      });
    });

    it('should skip records without email or hash', async () => {
      const ndjsonPath = path.join(tmpDir, 'passwords.ndjson');
      const lines = [
        JSON.stringify({ email: 'no-hash@test.com' }),
        JSON.stringify({ passwordHash: '$2a$10$noemail' }),
        JSON.stringify({ email: 'valid@test.com', passwordHash: '$2a$10$valid' }),
      ].join('\n');

      fs.writeFileSync(ndjsonPath, lines);

      const lookup = await loadPasswordHashes(ndjsonPath);
      expect(Object.keys(lookup)).toHaveLength(1);
      expect(lookup['valid@test.com']).toBeDefined();
    });
  });

  describe('mergePasswordsIntoCsv', () => {
    it('should merge passwords into CSV by email (case-insensitive)', async () => {
      const inputCsv = path.join(tmpDir, 'input.csv');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(
        inputCsv,
        'email,first_name,last_name,email_verified\n' +
          'Alice@Example.com,Alice,Johnson,true\n' +
          'bob@example.com,Bob,Smith,true\n' +
          'carol@example.com,Carol,Williams,false\n',
      );

      const passwordLookup = {
        'alice@example.com': { hash: '$2a$10$alicehash', algorithm: 'bcrypt', setDate: undefined },
        'bob@example.com': {
          hash: 'd41d8cd98f00b204e9800998ecf8427e',
          algorithm: 'md5',
          setDate: undefined,
        },
      };

      const stats = await mergePasswordsIntoCsv(inputCsv, outputCsv, passwordLookup);

      expect(stats.totalRows).toBe(3);
      expect(stats.passwordsAdded).toBe(2);
      expect(stats.passwordsNotFound).toBe(1);

      const output = fs.readFileSync(outputCsv, 'utf-8');
      expect(output).toContain('password_hash');
      expect(output).toContain('password_hash_type');
      expect(output).toContain('$2a$10$alicehash');
      expect(output).toContain('bcrypt');
      expect(output).toContain('d41d8cd98f00b204e9800998ecf8427e');
      expect(output).toContain('md5');
    });
  });

  describe('mergePasswordsIntoPackage', () => {
    it('merges hashes into users.csv and workos_upload/users.csv and updates the manifest', async () => {
      const packageDir = path.join(tmpDir, 'pkg');
      await createMigrationPackage({
        provider: 'auth0',
        rootDir: packageDir,
        entitiesRequested: ['users', 'organizations', 'memberships'],
        entitiesExported: { users: 2, uploadUsers: 2 },
        warnings: [],
      });

      writeUsersCsv(packageDir, [
        {
          email: 'alice@example.com',
          first_name: 'Alice',
          last_name: 'Smith',
          email_verified: 'true',
          external_id: 'auth0|alice',
          metadata: '',
          org_id: '',
          org_external_id: 'org_1',
          org_name: 'Acme',
          role_slugs: '',
        },
        {
          email: 'bob@example.com',
          first_name: 'Bob',
          last_name: 'Jones',
          email_verified: 'true',
          external_id: 'auth0|bob',
          metadata: '',
          org_id: '',
          org_external_id: 'org_1',
          org_name: 'Acme',
          role_slugs: '',
        },
      ]);
      writeUploadUsersCsv(packageDir, [
        {
          user_id: 'auth0|alice',
          email: 'alice@example.com',
          email_verified: 'true',
          first_name: 'Alice',
          last_name: 'Smith',
          password_hash: '',
        },
        {
          user_id: 'auth0|bob',
          email: 'bob@example.com',
          email_verified: 'true',
          first_name: 'Bob',
          last_name: 'Jones',
          password_hash: '',
        },
      ]);

      const passwordsPath = path.join(tmpDir, 'pw.ndjson');
      fs.writeFileSync(
        passwordsPath,
        [
          JSON.stringify({ email: 'alice@example.com', passwordHash: '$2a$10$alicehash' }),
          JSON.stringify({
            email: 'bob@example.com',
            passwordHash:
              'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          }),
        ].join('\n'),
      );

      const stats = await mergePasswordsIntoPackage({
        packageDir,
        passwordsPath,
      });

      expect(stats).toMatchObject({
        totalRows: 2,
        passwordsAdded: 1,
        passwordsRejectedAlgorithm: 1,
        uploadRowsUpdated: 1,
      });

      const usersCsv = fs.readFileSync(path.join(packageDir, 'users.csv'), 'utf-8');
      expect(usersCsv).toContain('alice@example.com');
      expect(usersCsv).toContain('$2a$10$alicehash');
      expect(usersCsv).toContain('bcrypt');
      expect(usersCsv).not.toContain(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );

      const uploadCsv = fs.readFileSync(
        path.join(packageDir, 'workos_upload', 'users.csv'),
        'utf-8',
      );
      expect(uploadCsv).toContain('$2a$10$alicehash');
      expect(uploadCsv).not.toContain(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );

      const manifest = JSON.parse(
        fs.readFileSync(path.join(packageDir, 'manifest.json'), 'utf-8'),
      ) as MigrationPackageManifest;
      const passwordMerge = manifest.metadata?.passwordMerge as
        | {
            passwordsAdded: number;
            passwordsNotFound: number;
            passwordsRejectedAlgorithm: number;
            uploadRowsUpdated: number;
          }
        | undefined;
      expect(passwordMerge).toMatchObject({
        passwordsAdded: 1,
        passwordsNotFound: 0,
        passwordsRejectedAlgorithm: 1,
        uploadRowsUpdated: 1,
      });
      expect(manifest.warnings.some((m) => m.includes('algorithm "sha256"'))).toBe(true);
    });

    it('reports a single warning when users.csv is missing', async () => {
      const passwordsPath = path.join(tmpDir, 'empty-passwords.ndjson');
      fs.writeFileSync(passwordsPath, '');
      const stats = await mergePasswordsIntoPackage({
        packageDir: path.join(tmpDir, 'missing'),
        passwordsPath,
      });
      expect(stats.warnings.map((warning) => warning.code)).toEqual(['package_users_csv_missing']);
      expect(stats.passwordsAdded).toBe(0);
    });
  });
});

function writeUsersCsv(packageDir: string, rows: Record<string, string>[]): void {
  const headers = MIGRATION_PACKAGE_CSV_HEADERS.users;
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => row[header] ?? '').join(','));
  }
  fs.writeFileSync(path.join(packageDir, 'users.csv'), `${lines.join('\n')}\n`);
}

function writeUploadUsersCsv(packageDir: string, rows: Record<string, string>[]): void {
  const headers = MIGRATION_PACKAGE_CSV_HEADERS.uploadUsers;
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => row[header] ?? '').join(','));
  }
  fs.writeFileSync(path.join(packageDir, 'workos_upload', 'users.csv'), `${lines.join('\n')}\n`);
}
