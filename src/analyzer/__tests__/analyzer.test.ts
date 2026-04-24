import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyzeErrors } from '../analyzer.js';
import { generateRetryCsv } from '../retry-generator.js';

describe('Error Analyzer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyzer-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('analyzeErrors', () => {
    it('should group errors by pattern', async () => {
      const errorsPath = path.join(tmpDir, 'errors.jsonl');
      const errors = [
        { recordNumber: 1, email: 'a@test.com', errorType: 'user_create', errorMessage: 'User a@test.com already exists', httpStatus: 409, timestamp: new Date().toISOString() },
        { recordNumber: 2, email: 'b@test.com', errorType: 'user_create', errorMessage: 'User b@test.com already exists', httpStatus: 409, timestamp: new Date().toISOString() },
        { recordNumber: 3, email: 'c@test.com', errorType: 'user_create', errorMessage: 'Rate limit exceeded', httpStatus: 429, timestamp: new Date().toISOString() },
      ];
      fs.writeFileSync(errorsPath, errors.map(e => JSON.stringify(e)).join('\n'));

      const result = await analyzeErrors(errorsPath);

      expect(result.totalErrors).toBe(3);
      expect(result.errorGroups.length).toBe(2);
      expect(result.retryableCount).toBe(1);
      expect(result.nonRetryableCount).toBe(2);
    });

    it('should classify retryable errors correctly', async () => {
      const errorsPath = path.join(tmpDir, 'errors.jsonl');
      const errors = [
        { recordNumber: 1, email: 'a@test.com', errorType: 'user_create', errorMessage: 'Rate limited', httpStatus: 429, timestamp: new Date().toISOString() },
        { recordNumber: 2, email: 'b@test.com', errorType: 'user_create', errorMessage: 'Internal error', httpStatus: 500, timestamp: new Date().toISOString() },
        { recordNumber: 3, email: 'c@test.com', errorType: 'user_create', errorMessage: 'Invalid email', httpStatus: 400, timestamp: new Date().toISOString() },
        { recordNumber: 4, email: 'd@test.com', errorType: 'user_create', errorMessage: 'Already exists', httpStatus: 409, timestamp: new Date().toISOString() },
      ];
      fs.writeFileSync(errorsPath, errors.map(e => JSON.stringify(e)).join('\n'));

      const result = await analyzeErrors(errorsPath);

      expect(result.retryableCount).toBe(2); // 429 + 500
      expect(result.nonRetryableCount).toBe(2); // 400 + 409

      const retryableGroups = result.errorGroups.filter(g => g.retryable);
      const nonRetryableGroups = result.errorGroups.filter(g => !g.retryable);
      expect(retryableGroups.length).toBeGreaterThan(0);
      expect(nonRetryableGroups.length).toBeGreaterThan(0);
    });

    it('should generate suggestions', async () => {
      const errorsPath = path.join(tmpDir, 'errors.jsonl');
      const errors = [
        { recordNumber: 1, email: 'a@test.com', errorType: 'user_create', errorMessage: 'Already exists', httpStatus: 409, timestamp: new Date().toISOString() },
      ];
      fs.writeFileSync(errorsPath, errors.map(e => JSON.stringify(e)).join('\n'));

      const result = await analyzeErrors(errorsPath);

      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('should handle empty error file', async () => {
      const errorsPath = path.join(tmpDir, 'errors.jsonl');
      fs.writeFileSync(errorsPath, '');

      const result = await analyzeErrors(errorsPath);

      expect(result.totalErrors).toBe(0);
      expect(result.errorGroups).toHaveLength(0);
    });

    it('should skip invalid JSON lines', async () => {
      const errorsPath = path.join(tmpDir, 'errors.jsonl');
      fs.writeFileSync(errorsPath, [
        'not json',
        JSON.stringify({ recordNumber: 1, email: 'a@test.com', errorType: 'user_create', errorMessage: 'Error', httpStatus: 400, timestamp: new Date().toISOString() }),
      ].join('\n'));

      const result = await analyzeErrors(errorsPath);

      expect(result.totalErrors).toBe(1);
    });

    it('should normalize dynamic values in error patterns', async () => {
      const errorsPath = path.join(tmpDir, 'errors.jsonl');
      const errors = [
        { recordNumber: 1, email: 'a@test.com', errorType: 'user_create', errorMessage: 'User a@test.com already exists in org org_abc123def456ghijk', httpStatus: 409, timestamp: new Date().toISOString() },
        { recordNumber: 2, email: 'b@test.com', errorType: 'user_create', errorMessage: 'User b@test.com already exists in org org_xyz789abc012defgh', httpStatus: 409, timestamp: new Date().toISOString() },
      ];
      fs.writeFileSync(errorsPath, errors.map(e => JSON.stringify(e)).join('\n'));

      const result = await analyzeErrors(errorsPath);

      // Both should be grouped into one pattern because emails and org IDs are normalized
      expect(result.errorGroups.length).toBe(1);
      expect(result.errorGroups[0]!.count).toBe(2);
    });
  });

  describe('generateRetryCsv', () => {
    it('should generate retry CSV with only retryable rows', async () => {
      const errorsPath = path.join(tmpDir, 'errors.jsonl');
      const originalCsv = path.join(tmpDir, 'original.csv');
      const retryCsv = path.join(tmpDir, 'retry.csv');

      // Retryable (429) and non-retryable (409) errors
      const errors = [
        { recordNumber: 1, email: 'retry@test.com', errorType: 'user_create', errorMessage: 'Rate limited', httpStatus: 429, timestamp: new Date().toISOString() },
        { recordNumber: 2, email: 'skip@test.com', errorType: 'user_create', errorMessage: 'Already exists', httpStatus: 409, timestamp: new Date().toISOString() },
      ];
      fs.writeFileSync(errorsPath, errors.map(e => JSON.stringify(e)).join('\n'));

      fs.writeFileSync(originalCsv, [
        'email,first_name',
        'retry@test.com,Retry',
        'skip@test.com,Skip',
        'ok@test.com,Ok',
      ].join('\n'));

      const result = await generateRetryCsv(errorsPath, originalCsv, retryCsv, false);

      expect(result.totalRetryable).toBe(1);
      expect(result.rowsWritten).toBe(1);

      const output = fs.readFileSync(retryCsv, 'utf-8');
      expect(output).toContain('retry@test.com');
      expect(output).not.toContain('skip@test.com');
      expect(output).not.toContain('ok@test.com');
    });

    it('should deduplicate retry CSV by email when requested', async () => {
      const errorsPath = path.join(tmpDir, 'errors.jsonl');
      const originalCsv = path.join(tmpDir, 'original.csv');
      const retryCsv = path.join(tmpDir, 'retry.csv');

      const errors = [
        { recordNumber: 1, email: 'retry@test.com', errorType: 'user_create', errorMessage: 'Rate limited', httpStatus: 429, timestamp: new Date().toISOString() },
      ];
      fs.writeFileSync(errorsPath, errors.map(e => JSON.stringify(e)).join('\n'));

      // Same email appears twice in original
      fs.writeFileSync(originalCsv, [
        'email,first_name,org_id',
        'retry@test.com,Retry,org_1',
        'retry@test.com,Retry,org_2',
      ].join('\n'));

      const result = await generateRetryCsv(errorsPath, originalCsv, retryCsv, true);

      expect(result.rowsWritten).toBe(1);
      expect(result.deduplicatedCount).toBe(1);
    });
  });
});
