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
    it('should parse NDJSON password file keyed by _id.$oid', async () => {
      const ndjsonPath = path.join(tmpDir, 'passwords.ndjson');
      const lines = [
        JSON.stringify({
          _id: { $oid: 'alice' },
          email: 'Alice@Example.com',
          passwordHash: '$2a$10$abcdefghij',
          password_set_date: { $date: '2024-01-15T00:00:00.000Z' },
        }),
        JSON.stringify({
          _id: { $oid: 'bob' },
          email: 'bob@example.com',
          passwordHash: '$2b$12$klmnopqrst',
        }),
        '', // Empty line should be skipped
        'invalid json line',
      ].join('\n');

      fs.writeFileSync(ndjsonPath, lines);

      const lookup = await loadPasswordHashes(ndjsonPath);

      expect(Object.keys(lookup.byOid)).toHaveLength(2);
      expect(lookup.byOid['alice']).toEqual({
        hash: '$2a$10$abcdefghij',
        algorithm: 'bcrypt',
        setDate: '2024-01-15T00:00:00.000Z',
      });
      expect(lookup.byOid['bob']).toEqual({
        hash: '$2b$12$klmnopqrst',
        algorithm: 'bcrypt',
        setDate: undefined,
      });
      // Email is tracked only for collision reporting, lowercased.
      expect(lookup.emailCounts['alice@example.com']).toBe(1);
      expect(lookup.recordsWithoutId).toBe(0);
      expect(lookup.duplicateOids).toEqual([]);
    });

    it('treats a repeated _id.$oid as ambiguous and binds no hash for it', async () => {
      const ndjsonPath = path.join(tmpDir, 'dup-oid.ndjson');
      const lines = [
        JSON.stringify({ _id: { $oid: 'dup' }, email: 'a@test.com', passwordHash: '$2a$10$first' }),
        JSON.stringify({
          _id: { $oid: 'dup' },
          email: 'b@test.com',
          passwordHash: '$2a$10$second',
        }),
        JSON.stringify({ _id: { $oid: 'solo' }, email: 'c@test.com', passwordHash: '$2a$10$solo' }),
      ].join('\n');

      fs.writeFileSync(ndjsonPath, lines);

      const lookup = await loadPasswordHashes(ndjsonPath);
      expect(lookup.byOid['dup']).toBeUndefined();
      expect(lookup.byOid['solo']).toBeDefined();
      expect(lookup.duplicateOids).toEqual(['dup']);
    });

    it('should skip records without email or hash', async () => {
      const ndjsonPath = path.join(tmpDir, 'passwords.ndjson');
      const lines = [
        JSON.stringify({ _id: { $oid: 'x' }, email: 'no-hash@test.com' }),
        JSON.stringify({ _id: { $oid: 'y' }, passwordHash: '$2a$10$noemail' }),
        JSON.stringify({
          _id: { $oid: 'valid' },
          email: 'valid@test.com',
          passwordHash: '$2a$10$valid',
        }),
      ].join('\n');

      fs.writeFileSync(ndjsonPath, lines);

      const lookup = await loadPasswordHashes(ndjsonPath);
      expect(Object.keys(lookup.byOid)).toHaveLength(1);
      expect(lookup.byOid['valid']).toBeDefined();
    });

    it('should skip records without _id.$oid so they cannot be misbound by email', async () => {
      const ndjsonPath = path.join(tmpDir, 'passwords.ndjson');
      const lines = [
        JSON.stringify({ email: 'noid@test.com', passwordHash: '$2a$10$noid' }),
        JSON.stringify({ _id: { $oid: 'ok' }, email: 'ok@test.com', passwordHash: '$2a$10$ok' }),
      ].join('\n');

      fs.writeFileSync(ndjsonPath, lines);

      const lookup = await loadPasswordHashes(ndjsonPath);
      expect(Object.keys(lookup.byOid)).toEqual(['ok']);
      expect(lookup.recordsWithoutId).toBe(1);
    });
  });

  describe('mergePasswordsIntoCsv', () => {
    it('should merge passwords into CSV by external_id (Auth0 user_id)', async () => {
      const inputCsv = path.join(tmpDir, 'input.csv');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(
        inputCsv,
        'email,first_name,last_name,email_verified,external_id\n' +
          'Alice@Example.com,Alice,Johnson,true,auth0|alice\n' +
          'bob@example.com,Bob,Smith,true,auth0|bob\n' +
          'carol@example.com,Carol,Williams,false,auth0|carol\n',
      );

      const passwordLookup = {
        byOid: {
          alice: { hash: '$2a$10$alicehash', algorithm: 'bcrypt', setDate: undefined },
          bob: {
            hash: 'd41d8cd98f00b204e9800998ecf8427e',
            algorithm: 'md5',
            setDate: undefined,
          },
        },
        emailCounts: { 'alice@example.com': 1, 'bob@example.com': 1 },
        recordsWithoutId: 0,
        duplicateOids: [],
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

    // Regression guard for SEC-1326: a same-email record from another Auth0
    // connection must never be bound to a different user's row.
    it('does not bind a colliding-email hash to a victim row (CSV mode)', async () => {
      const inputCsv = path.join(tmpDir, 'victim.csv');
      const outputCsv = path.join(tmpDir, 'victim-merged.csv');

      fs.writeFileSync(
        inputCsv,
        'email,first_name,last_name,email_verified,external_id\n' +
          'victim@corp.com,Vera,Victim,true,auth0|victimoid\n',
      );

      // Export contains the attacker's record (different oid, same email) but no
      // record for the victim's oid (e.g. the victim is a social-login user).
      const passwordLookup = {
        byOid: {
          attackeroid: { hash: '$2b$10$attackerhash', algorithm: 'bcrypt', setDate: undefined },
        },
        emailCounts: { 'victim@corp.com': 1 },
        recordsWithoutId: 0,
        duplicateOids: [],
      };

      const stats = await mergePasswordsIntoCsv(inputCsv, outputCsv, passwordLookup);

      expect(stats.passwordsAdded).toBe(0);
      expect(stats.passwordsNotFound).toBe(1);
      const output = fs.readFileSync(outputCsv, 'utf-8');
      expect(output).not.toContain('$2b$10$attackerhash');
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
          JSON.stringify({
            _id: { $oid: 'alice' },
            email: 'alice@example.com',
            passwordHash: '$2a$10$alicehash',
          }),
          JSON.stringify({
            _id: { $oid: 'bob' },
            email: 'bob@example.com',
            passwordHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
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

    // Regression guard for SEC-1326: full attack shape through the package flow.
    it('binds each connection hash to its own user and never cross-binds by email', async () => {
      const packageDir = path.join(tmpDir, 'attack-pkg');
      await createMigrationPackage({
        provider: 'auth0',
        rootDir: packageDir,
        entitiesRequested: ['users'],
        entitiesExported: { users: 1 },
        warnings: [],
      });

      // Only the victim's row is exported (the attacker's duplicate row would be
      // dropped as a duplicate on import).
      writeUsersCsv(packageDir, [
        {
          email: 'victim@corp.com',
          first_name: 'Vera',
          last_name: 'Victim',
          email_verified: 'true',
          external_id: 'auth0|victimoid',
          metadata: '',
          org_id: '',
          org_external_id: 'org_1',
          org_name: 'Acme',
          role_slugs: '',
        },
      ]);

      // Password export has two same-email records from different connections:
      // the victim's real hash and the attacker's hash. The attacker's record is
      // last (email last-write-wins would previously have won).
      const passwordsPath = path.join(tmpDir, 'attack.ndjson');
      fs.writeFileSync(
        passwordsPath,
        [
          JSON.stringify({
            _id: { $oid: 'victimoid' },
            email: 'victim@corp.com',
            email_verified: true,
            passwordHash: '$2b$10$victimhash',
            connection: 'prod-users',
          }),
          JSON.stringify({
            _id: { $oid: 'attackeroid' },
            email: 'victim@corp.com',
            email_verified: false,
            passwordHash: '$2b$10$attackerhash',
            connection: 'legacy-users',
          }),
        ].join('\n'),
      );

      const stats = await mergePasswordsIntoPackage({ packageDir, passwordsPath });

      const usersCsv = fs.readFileSync(path.join(packageDir, 'users.csv'), 'utf-8');
      // The victim's row keeps the victim's own hash, not the attacker's.
      expect(usersCsv).toContain('$2b$10$victimhash');
      expect(usersCsv).not.toContain('$2b$10$attackerhash');
      expect(stats.passwordsAdded).toBe(1);
      expect(stats.warnings.some((w) => w.code === 'duplicate_email_in_password_export')).toBe(
        true,
      );
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
