import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateCsv } from '../validator.js';

describe('CSV Validator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Pass 1 — Header Validation', () => {
    it('should pass for valid CSV', async () => {
      const csvPath = path.join(tmpDir, 'valid.csv');
      fs.writeFileSync(csvPath, [
        'email,first_name,last_name,email_verified',
        'alice@example.com,Alice,Johnson,true',
        'bob@example.com,Bob,Smith,false',
      ].join('\n'));

      const result = await validateCsv({ csvPath });

      expect(result.valid).toBe(true);
      expect(result.totalRows).toBe(2);
      expect(result.validRows).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('should error when email column is missing', async () => {
      const csvPath = path.join(tmpDir, 'no-email.csv');
      fs.writeFileSync(csvPath, [
        'first_name,last_name',
        'Alice,Johnson',
      ].join('\n'));

      const result = await validateCsv({ csvPath });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Missing required column: email'))).toBe(true);
    });

    it('should warn about unknown columns', async () => {
      const csvPath = path.join(tmpDir, 'unknown.csv');
      fs.writeFileSync(csvPath, [
        'email,custom_field',
        'alice@example.com,hello',
      ].join('\n'));

      const result = await validateCsv({ csvPath });

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.message.includes('Unknown column'))).toBe(true);
    });
  });

  describe('Pass 2 — Row Validation', () => {
    it('should error for rows with missing email', async () => {
      const csvPath = path.join(tmpDir, 'missing-email.csv');
      fs.writeFileSync(csvPath, [
        'email,first_name',
        ',Alice',
        'bob@example.com,Bob',
      ].join('\n'));

      const result = await validateCsv({ csvPath });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Missing required email'))).toBe(true);
    });

    it('should error for invalid email format', async () => {
      const csvPath = path.join(tmpDir, 'bad-email.csv');
      fs.writeFileSync(csvPath, [
        'email,first_name',
        'not-an-email,Alice',
      ].join('\n'));

      const result = await validateCsv({ csvPath });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Invalid email format'))).toBe(true);
    });

    it('should error for invalid metadata JSON', async () => {
      const csvPath = path.join(tmpDir, 'bad-metadata.csv');
      fs.writeFileSync(csvPath, [
        'email,metadata',
        'alice@example.com,{invalid json}',
      ].join('\n'));

      const result = await validateCsv({ csvPath });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Invalid JSON'))).toBe(true);
    });

    it('should warn for non-string metadata values', async () => {
      const csvPath = path.join(tmpDir, 'metadata-types.csv');
      fs.writeFileSync(csvPath, [
        'email,metadata',
        'alice@example.com,"{""name"":""Alice"",""count"":42}"',
      ].join('\n'));

      const result = await validateCsv({ csvPath });

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.message.includes('not a string'))).toBe(true);
    });

    it('should error when password_hash present without type', async () => {
      const csvPath = path.join(tmpDir, 'pw-no-type.csv');
      fs.writeFileSync(csvPath, [
        'email,password_hash',
        'alice@example.com,$2a$10$someHash',
      ].join('\n'));

      const result = await validateCsv({ csvPath });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('password_hash provided without password_hash_type'))).toBe(true);
    });

    it('should error when org_id and org_external_id both present', async () => {
      const csvPath = path.join(tmpDir, 'org-conflict.csv');
      fs.writeFileSync(csvPath, [
        'email,org_id,org_external_id',
        'alice@example.com,org_123,ext_456',
      ].join('\n'));

      const result = await validateCsv({ csvPath });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('mutually exclusive'))).toBe(true);
    });
  });

  describe('Pass 3 — Cross-Row Checks', () => {
    it('should detect duplicate emails', async () => {
      const csvPath = path.join(tmpDir, 'dupes.csv');
      fs.writeFileSync(csvPath, [
        'email,first_name',
        'alice@example.com,Alice',
        'alice@example.com,Alice2',
        'bob@example.com,Bob',
      ].join('\n'));

      const result = await validateCsv({ csvPath });

      expect(result.duplicateEmails).toContain('alice@example.com');
      expect(result.warnings.some(w => w.message.includes('Duplicate email'))).toBe(true);
    });
  });

  describe('Auto-Fix', () => {
    it('should normalize boolean values', async () => {
      const csvPath = path.join(tmpDir, 'booleans.csv');
      const outputPath = path.join(tmpDir, 'fixed.csv');
      fs.writeFileSync(csvPath, [
        'email,email_verified',
        'alice@example.com,Yes',
        'bob@example.com,1',
      ].join('\n'));

      const result = await validateCsv({ csvPath, autoFix: true, outputPath });

      expect(result.fixesApplied).toBeGreaterThan(0);

      const output = fs.readFileSync(outputPath, 'utf-8');
      expect(output).toContain('true');
      expect(output).not.toContain('Yes');
    });

    it('should stringify non-string metadata values', async () => {
      const csvPath = path.join(tmpDir, 'metadata-fix.csv');
      const outputPath = path.join(tmpDir, 'fixed.csv');
      fs.writeFileSync(csvPath, [
        'email,metadata',
        'alice@example.com,"{""name"":""Alice"",""tags"":[""a"",""b""]}"',
      ].join('\n'));

      const result = await validateCsv({ csvPath, autoFix: true, outputPath });

      expect(result.fixesApplied).toBeGreaterThan(0);

      const output = fs.readFileSync(outputPath, 'utf-8');
      // The array should now be a JSON string
      expect(output).toContain('Alice');
    });

    it('should rename reserved metadata fields', async () => {
      const csvPath = path.join(tmpDir, 'reserved-meta.csv');
      const outputPath = path.join(tmpDir, 'fixed.csv');
      fs.writeFileSync(csvPath, [
        'email,metadata',
        'alice@example.com,"{""email"":""old@test.com"",""custom"":""value""}"',
      ].join('\n'));

      const result = await validateCsv({ csvPath, autoFix: true, outputPath });

      expect(result.fixesApplied).toBeGreaterThan(0);

      const output = fs.readFileSync(outputPath, 'utf-8');
      expect(output).toContain('custom_email');
    });
  });

  describe('Strict Mode', () => {
    it('should treat warnings as errors in strict mode', async () => {
      const csvPath = path.join(tmpDir, 'strict.csv');
      fs.writeFileSync(csvPath, [
        'email,custom_field',
        'alice@example.com,hello',
      ].join('\n'));

      const result = await validateCsv({ csvPath, strict: true });

      expect(result.valid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
