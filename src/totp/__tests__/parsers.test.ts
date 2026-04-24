import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseTotpCsv, parseTotpNdjson, detectFormat, loadTotpRecords } from '../parsers.js';

describe('TOTP Parsers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totp-parser-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('detectFormat', () => {
    it('should detect CSV from .csv extension', () => {
      expect(detectFormat('data.csv')).toBe('csv');
    });

    it('should detect NDJSON from .ndjson extension', () => {
      expect(detectFormat('data.ndjson')).toBe('ndjson');
    });

    it('should detect NDJSON from .jsonl extension', () => {
      expect(detectFormat('data.jsonl')).toBe('ndjson');
    });

    it('should default to CSV for unknown extensions', () => {
      expect(detectFormat('data.txt')).toBe('csv');
    });
  });

  describe('parseTotpCsv', () => {
    it('should parse CSV with required columns', async () => {
      const filePath = path.join(tmpDir, 'totp.csv');
      fs.writeFileSync(
        filePath,
        [
          'email,totp_secret',
          'alice@example.com,JBSWY3DPEHPK3PXP',
          'bob@example.com,KRSXG5CTMVRXEZLU',
        ].join('\n'),
      );

      const records = await parseTotpCsv(filePath);

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        email: 'alice@example.com',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        totpIssuer: undefined,
        totpUser: undefined,
      });
    });

    it('should parse optional issuer and user columns', async () => {
      const filePath = path.join(tmpDir, 'totp.csv');
      fs.writeFileSync(
        filePath,
        [
          'email,totp_secret,totp_issuer,totp_user',
          'alice@example.com,JBSWY3DPEHPK3PXP,MyApp,alice',
        ].join('\n'),
      );

      const records = await parseTotpCsv(filePath);

      expect(records).toHaveLength(1);
      expect(records[0]!.totpIssuer).toBe('MyApp');
      expect(records[0]!.totpUser).toBe('alice');
    });

    it('should lowercase and trim emails', async () => {
      const filePath = path.join(tmpDir, 'totp.csv');
      fs.writeFileSync(
        filePath,
        ['email,totp_secret', ' Alice@Example.COM ,JBSWY3DPEHPK3PXP'].join('\n'),
      );

      const records = await parseTotpCsv(filePath);

      expect(records[0]!.email).toBe('alice@example.com');
    });

    it('should skip rows without email or secret', async () => {
      const filePath = path.join(tmpDir, 'totp.csv');
      fs.writeFileSync(
        filePath,
        [
          'email,totp_secret',
          ',JBSWY3DPEHPK3PXP',
          'alice@example.com,',
          'bob@example.com,SECRET123',
        ].join('\n'),
      );

      const records = await parseTotpCsv(filePath);

      expect(records).toHaveLength(1);
      expect(records[0]!.email).toBe('bob@example.com');
    });
  });

  describe('parseTotpNdjson', () => {
    it('should parse direct totp_secret field', async () => {
      const filePath = path.join(tmpDir, 'totp.ndjson');
      fs.writeFileSync(
        filePath,
        [
          '{"email":"alice@example.com","totp_secret":"JBSWY3DPEHPK3PXP"}',
          '{"email":"bob@example.com","totp_secret":"KRSXG5CTMVRXEZLU"}',
        ].join('\n'),
      );

      const records = await parseTotpNdjson(filePath);

      expect(records).toHaveLength(2);
      expect(records[0]!.totpSecret).toBe('JBSWY3DPEHPK3PXP');
    });

    it('should parse alternative secret field', async () => {
      const filePath = path.join(tmpDir, 'totp.ndjson');
      fs.writeFileSync(filePath, '{"email":"alice@example.com","secret":"MYSECRET"}');

      const records = await parseTotpNdjson(filePath);

      expect(records).toHaveLength(1);
      expect(records[0]!.totpSecret).toBe('MYSECRET');
    });

    it('should parse mfa_factors array format', async () => {
      const filePath = path.join(tmpDir, 'totp.ndjson');
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          email: 'alice@example.com',
          mfa_factors: [
            { type: 'sms', secret: 'ignored' },
            { type: 'totp', secret: 'TOTPSECRET' },
          ],
        }),
      );

      const records = await parseTotpNdjson(filePath);

      expect(records).toHaveLength(1);
      expect(records[0]!.totpSecret).toBe('TOTPSECRET');
    });

    it('should skip records without email', async () => {
      const filePath = path.join(tmpDir, 'totp.ndjson');
      fs.writeFileSync(filePath, '{"totp_secret":"JBSWY3DPEHPK3PXP"}');

      const records = await parseTotpNdjson(filePath);

      expect(records).toHaveLength(0);
    });

    it('should skip records without any secret', async () => {
      const filePath = path.join(tmpDir, 'totp.ndjson');
      fs.writeFileSync(filePath, '{"email":"alice@example.com"}');

      const records = await parseTotpNdjson(filePath);

      expect(records).toHaveLength(0);
    });

    it('should skip invalid JSON lines', async () => {
      const filePath = path.join(tmpDir, 'totp.ndjson');
      fs.writeFileSync(
        filePath,
        ['not json', '{"email":"alice@example.com","totp_secret":"SECRET"}'].join('\n'),
      );

      const records = await parseTotpNdjson(filePath);

      expect(records).toHaveLength(1);
    });

    it('should skip empty lines', async () => {
      const filePath = path.join(tmpDir, 'totp.ndjson');
      fs.writeFileSync(
        filePath,
        ['', '{"email":"alice@example.com","totp_secret":"SECRET"}', ''].join('\n'),
      );

      const records = await parseTotpNdjson(filePath);

      expect(records).toHaveLength(1);
    });
  });

  describe('loadTotpRecords', () => {
    it('should auto-detect CSV format', async () => {
      const filePath = path.join(tmpDir, 'totp.csv');
      fs.writeFileSync(filePath, ['email,totp_secret', 'alice@example.com,SECRET'].join('\n'));

      const records = await loadTotpRecords(filePath);
      expect(records).toHaveLength(1);
    });

    it('should auto-detect NDJSON format', async () => {
      const filePath = path.join(tmpDir, 'totp.jsonl');
      fs.writeFileSync(filePath, '{"email":"alice@example.com","totp_secret":"SECRET"}');

      const records = await loadTotpRecords(filePath);
      expect(records).toHaveLength(1);
    });

    it('should respect explicit format override', async () => {
      const filePath = path.join(tmpDir, 'totp.txt');
      fs.writeFileSync(filePath, '{"email":"alice@example.com","totp_secret":"SECRET"}');

      const records = await loadTotpRecords(filePath, 'ndjson');
      expect(records).toHaveLength(1);
    });
  });
});
