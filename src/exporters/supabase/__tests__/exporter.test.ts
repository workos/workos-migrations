import { jest } from '@jest/globals';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportSupabase } from '../exporter.js';
import { streamCSV } from '../../../shared/csv-utils.js';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/providers/supabase/fixtures');

describe('exportSupabase (end-to-end)', () => {
  let tmpDir: string;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabase-export-test-'));
    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('produces a complete package directory from two pages of users', async () => {
    const page1 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-1.json'), 'utf-8'));
    const page2 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-2.json'), 'utf-8'));
    const empty = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-3-empty.json'), 'utf-8'));

    fetchMock
      // testConnection() makes a per_page=1 probe call first
      .mockResolvedValueOnce(jsonResponse({ users: [page1.users[0]] }))
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2))
      .mockResolvedValueOnce(jsonResponse(empty));

    const summary = await exportSupabase({
      url: 'https://demo.supabase.co',
      serviceRoleKey: 'sb-service-role-jwt',
      outputDir: tmpDir,
      entities: ['users', 'identities'],
      rateLimit: 1000,
      pageSize: 3,
      quiet: true,
    });

    // Page 1 has 3 users (1 missing email → skip), page 2 has 2 users (1 banned → skip)
    expect(summary.totalUsers).toBe(3);
    expect(summary.skippedUsers).toBe(2);

    const usersCsv = path.join(tmpDir, 'users.csv');
    expect(fs.existsSync(usersCsv)).toBe(true);

    const rows: Record<string, unknown>[] = [];
    for await (const row of streamCSV(usersCsv)) {
      rows.push(row);
    }
    expect(rows).toHaveLength(3);

    const alice = rows.find((r) => r.email === 'alice@example.com');
    expect(alice).toBeDefined();
    expect(alice?.first_name).toBe('Alice');
    expect(alice?.last_name).toBe('Anderson');
    expect(alice?.email_verified).toBe('true');
    expect(alice?.external_id).toBe('11111111-1111-1111-1111-111111111111');

    const bob = rows.find((r) => r.email === 'bob.builder@example.com');
    expect(bob).toBeDefined();
    const bobMetadata = JSON.parse(bob?.metadata as string);
    expect(bobMetadata.supabase_identities).toHaveLength(2);
    expect(bobMetadata.supabase_identities.map((i: { provider: string }) => i.provider)).toEqual([
      'google',
      'github',
    ]);

    const dana = rows.find((r) => r.email === 'dana@example.com');
    expect(dana).toBeDefined();
    expect(dana?.email_verified).toBe('false');

    // Manifest
    const manifestRaw = await fsPromises.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.provider).toBe('supabase');
    expect(manifest.sourceTenant).toBe('https://demo.supabase.co');
    expect(manifest.entitiesRequested).toEqual(['users', 'identities']);
    expect(manifest.entitiesExported.users).toBe(3);
    expect(manifest.secretsRedacted).toBe(true);

    // Skipped users JSONL
    const skippedRaw = await fsPromises.readFile(path.join(tmpDir, 'skipped_users.jsonl'), 'utf-8');
    const skippedLines = skippedRaw.split('\n').filter(Boolean);
    expect(skippedLines).toHaveLength(2);
    const reasons = skippedLines.map((line) => JSON.parse(line).reason);
    expect(reasons).toContain('Missing email address');
    expect(reasons).toContain('Banned user');

    // Warnings file exists (even if empty)
    expect(fs.existsSync(path.join(tmpDir, 'warnings.jsonl'))).toBe(true);

    // Empty package files left as headers-only
    expect(fs.existsSync(path.join(tmpDir, 'organizations.csv'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'totp_secrets.csv'))).toBe(true);
  });

  it('throws when an unsupported entity is requested', async () => {
    await expect(
      exportSupabase({
        url: 'https://demo.supabase.co',
        serviceRoleKey: 'sb-service-role-jwt',
        outputDir: tmpDir,
        entities: ['users', 'organizations'],
        rateLimit: 1000,
        pageSize: 100,
        quiet: true,
      }),
    ).rejects.toThrow(/Unsupported entities for Supabase export/);
  });

  it('throws a clear connection error on 401 from the Admin API', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Invalid JWT' }, 401));

    await expect(
      exportSupabase({
        url: 'https://demo.supabase.co',
        serviceRoleKey: 'wrong-key',
        outputDir: tmpDir,
        entities: ['users'],
        rateLimit: 1000,
        pageSize: 100,
        quiet: true,
      }),
    ).rejects.toThrow(/Supabase connection failed/);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
