import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mergeSupabasePasswords } from '../password-merger.js';
import type { SupabasePgQueryClient } from '../pg-client.js';

interface PasswordRow {
  email: string;
  encrypted_password: string;
}

function fakeClient(rows: PasswordRow[]): SupabasePgQueryClient {
  return {
    async testConnection() {},
    async query<T>(_sql: string, params?: unknown[]): Promise<T[]> {
      const emails = Array.isArray(params?.[0]) ? (params[0] as string[]) : [];
      const matched = rows.filter((row) => emails.includes(row.email.toLowerCase()));
      return matched as unknown as T[];
    },
    async close() {},
  };
}

interface UserSeed {
  email: string;
  external_id: string;
}

async function setupPackage(
  rootDir: string,
  users: UserSeed[],
  provider: string = 'supabase',
  options: { withoutUsersCsv?: boolean } = {},
): Promise<void> {
  const manifest = {
    schemaVersion: 1,
    provider,
    generatedAt: new Date().toISOString(),
    entitiesRequested: ['users'],
    entitiesExported: { users: users.length },
    files: {},
    importability: {},
    secretsRedacted: true,
    warnings: [],
  };
  await fsp.writeFile(path.join(rootDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  if (options.withoutUsersCsv) return;

  const header =
    'email,password,password_hash,password_hash_type,first_name,last_name,email_verified,external_id,metadata,org_id,org_external_id,org_name,role_slugs\n';
  const body = users.map((u) => `${u.email},,,,,,true,${u.external_id},{},,,,`).join('\n');
  await fsp.writeFile(path.join(rootDir, 'users.csv'), header + body + (body ? '\n' : ''), 'utf-8');
}

async function readUsersCsv(rootDir: string): Promise<Record<string, string>[]> {
  const raw = await fsp.readFile(path.join(rootDir, 'users.csv'), 'utf-8');
  const [headerLine, ...lines] = raw.trim().split('\n');
  const headers = headerLine.split(',');
  return lines.map((line) => {
    const cols = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

describe('mergeSupabasePasswords', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabase-merge-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('merges bcrypt hashes into users.csv and patches the manifest', async () => {
    await setupPackage(tmpDir, [
      { email: 'alice@example.com', external_id: 'u1' },
      { email: 'bob@example.com', external_id: 'u2' },
      { email: 'no-match@example.com', external_id: 'u3' },
    ]);

    const stats = await mergeSupabasePasswords({
      packageDir: tmpDir,
      dbUrl: 'postgresql://x',
      quiet: true,
      clientFactory: () =>
        fakeClient([
          { email: 'alice@example.com', encrypted_password: '$2a$10$alicebcrypt' },
          { email: 'bob@example.com', encrypted_password: '$2b$12$bobbcrypt' },
        ]),
    });

    expect(stats.totalRows).toBe(3);
    expect(stats.matched).toBe(2);
    expect(stats.missing).toBe(1);
    expect(stats.unsupportedAlgo).toBe(0);

    const rows = await readUsersCsv(tmpDir);
    expect(rows.find((r) => r.email === 'alice@example.com')?.password_hash).toBe('$2a$10$alicebcrypt');
    expect(rows.find((r) => r.email === 'alice@example.com')?.password_hash_type).toBe('bcrypt');
    expect(rows.find((r) => r.email === 'bob@example.com')?.password_hash).toBe('$2b$12$bobbcrypt');

    const manifest = JSON.parse(await fsp.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8'));
    expect(manifest.metadata.passwordMerge.matched).toBe(2);
    expect(manifest.metadata.passwordMerge.missing).toBe(1);
  });

  it('accepts $2y$ bcrypt prefix and rejects non-bcrypt with a warning', async () => {
    await setupPackage(tmpDir, [
      { email: 'alice@example.com', external_id: 'u1' },
      { email: 'argon@example.com', external_id: 'u2' },
    ]);

    const stats = await mergeSupabasePasswords({
      packageDir: tmpDir,
      dbUrl: 'postgresql://x',
      quiet: true,
      clientFactory: () =>
        fakeClient([
          { email: 'alice@example.com', encrypted_password: '$2y$10$alicebcrypt' },
          { email: 'argon@example.com', encrypted_password: '$argon2id$v=19$m=4096,t=3,p=1$xxxx$yyyy' },
        ]),
    });

    expect(stats.matched).toBe(1);
    expect(stats.unsupportedAlgo).toBe(1);
    expect(stats.warnings.some((w) => /unsupported algorithm/.test(w))).toBe(true);
  });

  it('is idempotent: running twice produces identical CSV', async () => {
    await setupPackage(tmpDir, [{ email: 'alice@example.com', external_id: 'u1' }]);
    const factory = () => fakeClient([{ email: 'alice@example.com', encrypted_password: '$2a$10$alicebcrypt' }]);

    await mergeSupabasePasswords({ packageDir: tmpDir, dbUrl: 'postgresql://x', quiet: true, clientFactory: factory });
    const first = await fsp.readFile(path.join(tmpDir, 'users.csv'), 'utf-8');

    await mergeSupabasePasswords({ packageDir: tmpDir, dbUrl: 'postgresql://x', quiet: true, clientFactory: factory });
    const second = await fsp.readFile(path.join(tmpDir, 'users.csv'), 'utf-8');
    expect(second).toBe(first);
  });

  it('refuses to operate on a non-Supabase package', async () => {
    await setupPackage(tmpDir, [{ email: 'alice@example.com', external_id: 'u1' }], 'auth0');

    await expect(
      mergeSupabasePasswords({
        packageDir: tmpDir,
        dbUrl: 'postgresql://x',
        quiet: true,
        clientFactory: () => fakeClient([]),
      }),
    ).rejects.toThrow(/provider "auth0"/);
  });

  it('throws when users.csv is missing', async () => {
    await setupPackage(tmpDir, [], 'supabase', { withoutUsersCsv: true });

    await expect(
      mergeSupabasePasswords({
        packageDir: tmpDir,
        dbUrl: 'postgresql://x',
        quiet: true,
        clientFactory: () => fakeClient([]),
      }),
    ).rejects.toThrow(/users\.csv not found/);
  });

  it('batches large email lists into chunks of 1000', async () => {
    const seeds: UserSeed[] = [];
    for (let i = 0; i < 1500; i++) {
      seeds.push({ email: `user${i}@example.com`, external_id: `u${i}` });
    }
    await setupPackage(tmpDir, seeds);

    let batchCount = 0;
    const stats = await mergeSupabasePasswords({
      packageDir: tmpDir,
      dbUrl: 'postgresql://x',
      quiet: true,
      clientFactory: () => ({
        async testConnection() {},
        async query<T>(_sql: string, params?: unknown[]): Promise<T[]> {
          batchCount++;
          const emails = Array.isArray(params?.[0]) ? (params[0] as string[]) : [];
          return emails.map((email) => ({
            email,
            encrypted_password: '$2b$10$generic',
          })) as unknown as T[];
        },
        async close() {},
      }),
    });

    expect(stats.matched).toBe(1500);
    expect(batchCount).toBe(2); // 1500 emails / 1000 per batch
  });
});
