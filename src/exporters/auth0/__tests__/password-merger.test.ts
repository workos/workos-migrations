import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  detectHashAlgorithm,
  loadPasswordHashes,
  mergePasswordsIntoCsv,
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
});
