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
import type { PasswordLookup, PasswordLookupEntry } from '../../../shared/types.js';

function emptyLookup(entries: Record<string, PasswordLookupEntry>): PasswordLookup {
  return {
    byExternalId: new Map(Object.entries(entries)),
    collidingEmails: [],
    ambiguousExternalIds: [],
    recordsWithoutId: 0,
  };
}

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
    it('keys hashes by Auth0 identity, not email', async () => {
      const ndjsonPath = path.join(tmpDir, 'passwords.ndjson');
      const lines = [
        JSON.stringify({
          _id: { $oid: 'alice-oid' },
          email: 'Alice@Example.com',
          passwordHash: '$2a$10$abcdefghij',
          password_set_date: { $date: '2024-01-15T00:00:00.000Z' },
        }),
        JSON.stringify({
          _id: { $oid: 'bob-oid' },
          email: 'bob@example.com',
          passwordHash: '$2b$12$klmnopqrst',
        }),
        '', // Empty line should be skipped
        'invalid json line',
      ].join('\n');

      fs.writeFileSync(ndjsonPath, lines);

      const lookup = await loadPasswordHashes(ndjsonPath);

      expect(lookup.byExternalId.size).toBe(2);
      expect(lookup.byExternalId.get('auth0|alice-oid')).toEqual({
        hash: '$2a$10$abcdefghij',
        algorithm: 'bcrypt',
        setDate: '2024-01-15T00:00:00.000Z',
      });
      expect(lookup.byExternalId.get('auth0|bob-oid')).toEqual({
        hash: '$2b$12$klmnopqrst',
        algorithm: 'bcrypt',
        setDate: undefined,
      });
      expect(lookup.collidingEmails).toEqual([]);
      expect(lookup.ambiguousExternalIds).toEqual([]);
      expect(lookup.recordsWithoutId).toBe(0);
    });

    it('should skip records without email or hash', async () => {
      const ndjsonPath = path.join(tmpDir, 'passwords.ndjson');
      const lines = [
        JSON.stringify({ _id: { $oid: 'x' }, email: 'no-hash@test.com' }),
        JSON.stringify({ _id: { $oid: 'y' }, passwordHash: '$2a$10$noemail' }),
        JSON.stringify({
          _id: { $oid: 'z' },
          email: 'valid@test.com',
          passwordHash: '$2a$10$valid',
        }),
      ].join('\n');

      fs.writeFileSync(ndjsonPath, lines);

      const lookup = await loadPasswordHashes(ndjsonPath);
      expect(lookup.byExternalId.size).toBe(1);
      expect(lookup.byExternalId.get('auth0|z')).toBeDefined();
    });

    it('skips records without an identity instead of guessing by email', async () => {
      const ndjsonPath = path.join(tmpDir, 'passwords.ndjson');
      fs.writeFileSync(
        ndjsonPath,
        JSON.stringify({ email: 'orphan@test.com', passwordHash: '$2a$10$orphan' }),
      );

      const lookup = await loadPasswordHashes(ndjsonPath);
      expect(lookup.byExternalId.size).toBe(0);
      expect(lookup.recordsWithoutId).toBe(1);
    });

    it('binds no hash for an identity that appears on multiple records', async () => {
      const ndjsonPath = path.join(tmpDir, 'passwords.ndjson');
      fs.writeFileSync(
        ndjsonPath,
        [
          JSON.stringify({ _id: { $oid: 'dup' }, email: 'a@test.com', passwordHash: '$2a$10$one' }),
          JSON.stringify({ _id: { $oid: 'dup' }, email: 'a@test.com', passwordHash: '$2a$10$two' }),
          JSON.stringify({
            _id: { $oid: 'dup' },
            email: 'a@test.com',
            passwordHash: '$2a$10$three',
          }),
        ].join('\n'),
      );

      const lookup = await loadPasswordHashes(ndjsonPath);
      expect(lookup.byExternalId.has('auth0|dup')).toBe(false);
      expect(lookup.ambiguousExternalIds).toEqual(['auth0|dup']);
    });

    it('reports emails that appear on multiple records', async () => {
      const ndjsonPath = path.join(tmpDir, 'passwords.ndjson');
      fs.writeFileSync(
        ndjsonPath,
        [
          JSON.stringify({
            _id: { $oid: 'conn-a' },
            email: 'Shared@Corp.com',
            passwordHash: '$2a$10$one',
          }),
          JSON.stringify({
            _id: { $oid: 'conn-b' },
            email: 'shared@corp.com',
            passwordHash: '$2a$10$two',
          }),
        ].join('\n'),
      );

      const lookup = await loadPasswordHashes(ndjsonPath);
      expect(lookup.collidingEmails).toEqual(['shared@corp.com']);
      expect(lookup.byExternalId.size).toBe(2);
    });
  });

  describe('mergePasswordsIntoCsv', () => {
    it('merges passwords into CSV by external_id', async () => {
      const inputCsv = path.join(tmpDir, 'input.csv');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(
        inputCsv,
        'email,first_name,last_name,email_verified,external_id\n' +
          'Alice@Example.com,Alice,Johnson,true,auth0|alice-oid\n' +
          'bob@example.com,Bob,Smith,true,auth0|bob-oid\n' +
          'carol@example.com,Carol,Williams,false,auth0|carol-oid\n',
      );

      const passwordLookup = emptyLookup({
        'auth0|alice-oid': { hash: '$2a$10$alicehash', algorithm: 'bcrypt', setDate: undefined },
        'auth0|bob-oid': {
          hash: 'd41d8cd98f00b204e9800998ecf8427e',
          algorithm: 'md5',
          setDate: undefined,
        },
      });

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

    it("never binds another user's hash by shared email", async () => {
      const inputCsv = path.join(tmpDir, 'input.csv');
      const outputCsv = path.join(tmpDir, 'output.csv');

      // The victim's row from the user export. The attacker self-registered
      // the same email on a second database connection, so the password
      // export carries a record for each identity.
      fs.writeFileSync(
        inputCsv,
        'email,first_name,last_name,email_verified,external_id\n' +
          'victim@corp.com,Vera,Victim,true,auth0|victim-oid\n',
      );

      const ndjsonPath = path.join(tmpDir, 'passwords.ndjson');
      fs.writeFileSync(
        ndjsonPath,
        [
          JSON.stringify({
            _id: { $oid: 'victim-oid' },
            email: 'victim@corp.com',
            email_verified: true,
            passwordHash: '$2b$10$victimhash',
            connection: 'prod-users',
          }),
          JSON.stringify({
            _id: { $oid: 'attacker-oid' },
            email: 'victim@corp.com',
            email_verified: false,
            passwordHash: '$2b$10$attackerhash',
            connection: 'legacy-users',
          }),
        ].join('\n'),
      );
      const passwordLookup = await loadPasswordHashes(ndjsonPath);

      await mergePasswordsIntoCsv(inputCsv, outputCsv, passwordLookup);

      const output = fs.readFileSync(outputCsv, 'utf-8');
      expect(output).toContain('$2b$10$victimhash');
      expect(output).not.toContain('$2b$10$attackerhash');
    });

    it('binds no hash to a user whose identity has no password record', async () => {
      const inputCsv = path.join(tmpDir, 'input.csv');
      const outputCsv = path.join(tmpDir, 'output.csv');

      // A social-login victim has no password record of their own; the only
      // record for their email belongs to an attacker-registered account on a
      // database connection.
      fs.writeFileSync(
        inputCsv,
        'email,first_name,last_name,email_verified,external_id\n' +
          'victim@corp.com,Vera,Victim,true,google-oauth2|12345\n',
      );

      const ndjsonPath = path.join(tmpDir, 'passwords.ndjson');
      fs.writeFileSync(
        ndjsonPath,
        JSON.stringify({
          _id: { $oid: 'attacker-oid' },
          email: 'victim@corp.com',
          passwordHash: '$2b$10$attackerhash',
          connection: 'legacy-users',
        }),
      );
      const passwordLookup = await loadPasswordHashes(ndjsonPath);

      const stats = await mergePasswordsIntoCsv(inputCsv, outputCsv, passwordLookup);

      expect(stats.passwordsAdded).toBe(0);
      expect(stats.passwordsNotFound).toBe(1);
      expect(fs.readFileSync(outputCsv, 'utf-8')).not.toContain('$2b$10$attackerhash');
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
