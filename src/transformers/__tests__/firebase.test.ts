import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock logger to avoid chalk ESM issues in Jest
jest.mock('../../shared/logger.js', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  debug: jest.fn(),
}));

import { transformFirebaseExport, splitDisplayName } from '../firebase/transformer.js';
import { encodeFirebaseScryptPHC } from '../firebase/scrypt.js';

describe('Firebase Transformer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'firebase-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('splitDisplayName', () => {
    it('should split at first space', () => {
      expect(splitDisplayName('John Michael Smith', 'first-space')).toEqual({
        firstName: 'John',
        lastName: 'Michael Smith',
      });
    });

    it('should split at last space', () => {
      expect(splitDisplayName('John Michael Smith', 'last-space')).toEqual({
        firstName: 'John Michael',
        lastName: 'Smith',
      });
    });

    it('should use full name as first name only', () => {
      expect(splitDisplayName('John Michael Smith', 'first-name-only')).toEqual({
        firstName: 'John Michael Smith',
        lastName: '',
      });
    });

    it('should handle single name', () => {
      expect(splitDisplayName('John', 'first-space')).toEqual({
        firstName: 'John',
        lastName: '',
      });
    });

    it('should handle empty/undefined', () => {
      expect(splitDisplayName(undefined, 'first-space')).toEqual({
        firstName: '',
        lastName: '',
      });
      expect(splitDisplayName('', 'first-space')).toEqual({
        firstName: '',
        lastName: '',
      });
    });
  });

  describe('encodeFirebaseScryptPHC', () => {
    it('should encode to PHC format', () => {
      const result = encodeFirebaseScryptPHC(
        { passwordHash: 'aGFzaA==', salt: 'c2FsdA==' },
        { signerKey: 'a2V5', saltSeparator: 'c2Vw', rounds: 8, memoryCost: 14 },
      );

      expect(result).toBe('$firebase-scrypt$hash=aGFzaA==$salt=c2FsdA==$sk=a2V5$ss=c2Vw$r=8$m=14');
    });

    it('should normalize URL-safe base64', () => {
      const result = encodeFirebaseScryptPHC(
        { passwordHash: 'a-b_c', salt: 'd-e_f' },
        { signerKey: 'g-h_i', saltSeparator: 'j-k_l', rounds: 8, memoryCost: 14 },
      );

      expect(result).toContain('hash=a+b/c');
      expect(result).toContain('salt=d+e/f');
      expect(result).toContain('sk=g+h/i');
      expect(result).toContain('ss=j+k/l');
    });
  });

  describe('transformFirebaseExport', () => {
    it('should transform basic Firebase JSON', async () => {
      const inputJson = path.join(tmpDir, 'firebase.json');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(
        inputJson,
        JSON.stringify({
          users: [
            {
              localId: 'uid1',
              email: 'alice@example.com',
              emailVerified: true,
              displayName: 'Alice Johnson',
            },
            {
              localId: 'uid2',
              email: 'bob@example.com',
              emailVerified: false,
              displayName: 'Bob Smith',
            },
          ],
        }),
      );

      const summary = await transformFirebaseExport({
        input: inputJson,
        output: outputCsv,
        nameSplitStrategy: 'first-space',
        quiet: true,
      });

      expect(summary.totalUsers).toBe(2);
      expect(summary.transformedUsers).toBe(2);
      expect(summary.skippedUsers).toBe(0);

      const output = fs.readFileSync(outputCsv, 'utf-8');
      expect(output).toContain('alice@example.com');
      expect(output).toContain('Alice');
      expect(output).toContain('Johnson');
      expect(output).toContain('bob@example.com');
    });

    it('should skip disabled users by default', async () => {
      const inputJson = path.join(tmpDir, 'firebase.json');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(
        inputJson,
        JSON.stringify({
          users: [
            { localId: 'uid1', email: 'active@example.com', displayName: 'Active User' },
            { localId: 'uid2', email: 'disabled@example.com', displayName: 'Disabled User', disabled: true },
          ],
        }),
      );

      const summary = await transformFirebaseExport({
        input: inputJson,
        output: outputCsv,
        nameSplitStrategy: 'first-space',
        quiet: true,
      });

      expect(summary.transformedUsers).toBe(1);
      expect(summary.skippedUsers).toBe(1);
      expect(summary.skippedReasons['User is disabled']).toBe(1);
    });

    it('should include disabled users when flag is set', async () => {
      const inputJson = path.join(tmpDir, 'firebase.json');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(
        inputJson,
        JSON.stringify({
          users: [
            { localId: 'uid1', email: 'disabled@example.com', displayName: 'Disabled User', disabled: true },
          ],
        }),
      );

      const summary = await transformFirebaseExport({
        input: inputJson,
        output: outputCsv,
        nameSplitStrategy: 'first-space',
        includeDisabled: true,
        quiet: true,
      });

      expect(summary.transformedUsers).toBe(1);
      expect(summary.skippedUsers).toBe(0);

      const output = fs.readFileSync(outputCsv, 'utf-8');
      expect(output).toContain('disabled@example.com');
    });

    it('should skip users without email', async () => {
      const inputJson = path.join(tmpDir, 'firebase.json');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(
        inputJson,
        JSON.stringify({
          users: [
            { localId: 'uid1', displayName: 'No Email' },
            { localId: 'uid2', email: 'has@example.com', displayName: 'Has Email' },
          ],
        }),
      );

      const summary = await transformFirebaseExport({
        input: inputJson,
        output: outputCsv,
        nameSplitStrategy: 'first-space',
        quiet: true,
      });

      expect(summary.transformedUsers).toBe(1);
      expect(summary.skippedUsers).toBe(1);
      expect(summary.skippedReasons['Missing email address']).toBe(1);
    });

    it('should encode scrypt passwords when config provided', async () => {
      const inputJson = path.join(tmpDir, 'firebase.json');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(
        inputJson,
        JSON.stringify({
          users: [
            {
              localId: 'uid1',
              email: 'alice@example.com',
              displayName: 'Alice',
              passwordHash: 'aGFzaA==',
              salt: 'c2FsdA==',
            },
          ],
        }),
      );

      const summary = await transformFirebaseExport({
        input: inputJson,
        output: outputCsv,
        nameSplitStrategy: 'first-space',
        scryptConfig: {
          signerKey: 'a2V5',
          saltSeparator: 'c2Vw',
          rounds: 8,
          memoryCost: 14,
        },
        quiet: true,
      });

      expect(summary.usersWithPasswords).toBe(1);

      const output = fs.readFileSync(outputCsv, 'utf-8');
      expect(output).toContain('firebase-scrypt');
      expect(output).toContain('$firebase-scrypt$');
    });

    it('should skip passwords when --skip-passwords', async () => {
      const inputJson = path.join(tmpDir, 'firebase.json');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(
        inputJson,
        JSON.stringify({
          users: [
            {
              localId: 'uid1',
              email: 'alice@example.com',
              passwordHash: 'aGFzaA==',
              salt: 'c2FsdA==',
            },
          ],
        }),
      );

      const summary = await transformFirebaseExport({
        input: inputJson,
        output: outputCsv,
        nameSplitStrategy: 'first-space',
        scryptConfig: {
          signerKey: 'a2V5',
          saltSeparator: 'c2Vw',
          rounds: 8,
          memoryCost: 14,
        },
        skipPasswords: true,
        quiet: true,
      });

      expect(summary.usersWithPasswords).toBe(0);
      expect(summary.usersWithoutPasswords).toBe(1);
    });

    it('should map custom claims to metadata', async () => {
      const inputJson = path.join(tmpDir, 'firebase.json');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(
        inputJson,
        JSON.stringify({
          users: [
            {
              localId: 'uid1',
              email: 'alice@example.com',
              displayName: 'Alice',
              customAttributes: '{"role":"admin","plan":"enterprise"}',
              phoneNumber: '+1555123',
              createdAt: '1700000000000',
            },
          ],
        }),
      );

      const summary = await transformFirebaseExport({
        input: inputJson,
        output: outputCsv,
        nameSplitStrategy: 'first-space',
        quiet: true,
      });

      expect(summary.transformedUsers).toBe(1);

      const output = fs.readFileSync(outputCsv, 'utf-8');
      expect(output).toContain('custom_attributes');
      expect(output).toContain('phone_number');
      expect(output).toContain('firebase_uid');
    });

    it('should apply org mapping', async () => {
      const inputJson = path.join(tmpDir, 'firebase.json');
      const orgCsv = path.join(tmpDir, 'orgs.csv');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(
        inputJson,
        JSON.stringify({
          users: [
            { localId: 'uid1', email: 'alice@example.com', displayName: 'Alice' },
            { localId: 'uid2', email: 'bob@example.com', displayName: 'Bob' },
          ],
        }),
      );

      fs.writeFileSync(
        orgCsv,
        ['firebase_uid,org_external_id,org_name', 'uid1,org_ext_1,Acme Corp'].join('\n'),
      );

      const summary = await transformFirebaseExport({
        input: inputJson,
        output: outputCsv,
        nameSplitStrategy: 'first-space',
        orgMapping: orgCsv,
        quiet: true,
      });

      expect(summary.usersWithOrgMapping).toBe(1);
      expect(summary.usersWithoutOrgMapping).toBe(1);

      const output = fs.readFileSync(outputCsv, 'utf-8');
      expect(output).toContain('org_ext_1');
      expect(output).toContain('Acme Corp');
    });

    it('should throw on invalid JSON', async () => {
      const inputJson = path.join(tmpDir, 'firebase.json');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(inputJson, 'not valid json');

      await expect(
        transformFirebaseExport({
          input: inputJson,
          output: outputCsv,
          nameSplitStrategy: 'first-space',
          quiet: true,
        }),
      ).rejects.toThrow('Invalid JSON');
    });

    it('should throw when users array missing', async () => {
      const inputJson = path.join(tmpDir, 'firebase.json');
      const outputCsv = path.join(tmpDir, 'output.csv');

      fs.writeFileSync(inputJson, JSON.stringify({ data: [] }));

      await expect(
        transformFirebaseExport({
          input: inputJson,
          output: outputCsv,
          nameSplitStrategy: 'first-space',
          quiet: true,
        }),
      ).rejects.toThrow('must have a "users" array');
    });
  });
});
