import { jest } from '@jest/globals';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportSupabase } from '../../../src/exporters/supabase/exporter.js';
import type { SupabasePgQueryClient } from '../../../src/exporters/supabase/pg-client.js';
import type { OrgSchemaConfig } from '../../../src/shared/types.js';
import { streamCSV } from '../../../src/shared/csv-utils.js';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/providers/supabase/fixtures');

interface FakePgState {
  orgRows?: Array<Record<string, unknown>>;
  membershipRows?: Array<Record<string, unknown>>;
  orphanCount?: number;
}

function fakePgClient(state: FakePgState): SupabasePgQueryClient {
  return {
    async testConnection() {},
    async query<T>(sql: string): Promise<T[]> {
      if (/AS org_internal_id/.test(sql)) return (state.orgRows ?? []) as T[];
      if (/u\.email AS email/.test(sql)) return (state.membershipRows ?? []) as T[];
      if (/LEFT JOIN auth\.users/.test(sql)) {
        return [{ count: state.orphanCount ?? 0 }] as unknown as T[];
      }
      return [] as T[];
    },
    async close() {},
  };
}

const WORKSPACES_SCHEMA: OrgSchemaConfig = {
  orgTable: { schema: 'public', name: 'workspaces' },
  orgIdColumn: 'id',
  orgNameColumn: 'name',
  orgExternalIdColumn: 'slug',
  orgDomainsColumn: 'domain',
  membersTable: { schema: 'public', name: 'workspace_members' },
  membershipUserColumn: 'user_id',
  membershipOrgColumn: 'workspace_id',
  membershipRoleColumn: 'role',
};

describe('exportSupabase end-to-end with organizations', () => {
  let tmpDir: string;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabase-export-orgs-test-'));
    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('produces organizations.csv + organization_memberships.csv with role mappings', async () => {
    const roleMapPath = path.join(tmpDir, 'roles.json');
    await fsp.writeFile(roleMapPath, JSON.stringify({ owner: 'admin', member: 'member' }));

    const page1 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-1.json'), 'utf-8'));
    const empty = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-3-empty.json'), 'utf-8'));

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ users: [page1.users[0]] }))
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(empty));

    await exportSupabase({
      url: 'https://demo.supabase.co',
      serviceRoleKey: 'sb-service-role-jwt',
      dbUrl: 'postgresql://x:y@db.example.com:5432/postgres',
      outputDir: tmpDir,
      entities: ['users', 'organizations'],
      rateLimit: 1000,
      pageSize: 100,
      quiet: true,
      orgSchema: { ...WORKSPACES_SCHEMA, roleSlugMapPath: roleMapPath },
      pgClientFactory: () =>
        fakePgClient({
          orgRows: [
            {
              org_internal_id: 'uuid-acme',
              org_name: 'Acme',
              org_external_id: 'acme',
              org_domains: ['acme.com', 'acme.io'],
            },
            {
              org_internal_id: 'uuid-globex',
              org_name: 'Globex',
              org_external_id: 'globex',
              org_domains: null,
            },
          ],
          membershipRows: [
            {
              email: 'alice@example.com',
              user_external_id: '11111111-1111-1111-1111-111111111111',
              org_external_id: 'acme',
              role: 'owner',
            },
            {
              email: 'bob.builder@example.com',
              user_external_id: '22222222-2222-2222-2222-222222222222',
              org_external_id: 'acme',
              role: 'member',
            },
          ],
          orphanCount: 0,
        }),
    });

    const orgs = await readCsvRows(path.join(tmpDir, 'organizations.csv'));
    expect(orgs).toHaveLength(2);
    expect(orgs.find((o) => o.org_external_id === 'acme')?.domains).toBe('acme.com,acme.io');
    expect(orgs.find((o) => o.org_external_id === 'globex')?.domains).toBe('');

    const memberships = await readCsvRows(path.join(tmpDir, 'organization_memberships.csv'));
    expect(memberships).toHaveLength(2);
    expect(memberships[0].role_slugs).toBe('admin');
    expect(memberships[1].role_slugs).toBe('member');

    const manifest = JSON.parse(await fsp.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8'));
    expect(manifest.entitiesExported.organizations).toBe(2);
    expect(manifest.entitiesExported.memberships).toBe(2);
  });

  it('warns and skips org export when organizations is requested without schema flags', async () => {
    const page1 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-1.json'), 'utf-8'));
    const empty = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-3-empty.json'), 'utf-8'));

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ users: [page1.users[0]] }))
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(empty));

    await exportSupabase({
      url: 'https://demo.supabase.co',
      serviceRoleKey: 'sb-service-role-jwt',
      dbUrl: 'postgresql://x:y@db.example.com:5432/postgres',
      outputDir: tmpDir,
      entities: ['users', 'organizations'],
      rateLimit: 1000,
      pageSize: 100,
      quiet: true,
      pgClientFactory: () => fakePgClient({}),
    });

    const orgs = await readCsvRows(path.join(tmpDir, 'organizations.csv'));
    expect(orgs).toHaveLength(0);

    const warnings = fs.readFileSync(path.join(tmpDir, 'warnings.jsonl'), 'utf-8');
    expect(warnings).toMatch(/no org schema flags supplied/);
  });

  it('emits an unmapped-role warning when every DB role is missing from the slug map', async () => {
    const roleMapPath = path.join(tmpDir, 'roles.json');
    await fsp.writeFile(roleMapPath, JSON.stringify({ admin: 'admin' }));

    const page1 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-1.json'), 'utf-8'));
    const empty = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-3-empty.json'), 'utf-8'));

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ users: [page1.users[0]] }))
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(empty));

    await exportSupabase({
      url: 'https://demo.supabase.co',
      serviceRoleKey: 'sb-service-role-jwt',
      dbUrl: 'postgresql://x:y@db.example.com:5432/postgres',
      outputDir: tmpDir,
      entities: ['users', 'organizations'],
      rateLimit: 1000,
      pageSize: 100,
      quiet: true,
      orgSchema: { ...WORKSPACES_SCHEMA, roleSlugMapPath: roleMapPath },
      pgClientFactory: () =>
        fakePgClient({
          orgRows: [
            {
              org_internal_id: 'uuid-acme',
              org_name: 'Acme',
              org_external_id: 'acme',
              org_domains: null,
            },
          ],
          membershipRows: [
            {
              email: 'a@example.com',
              user_external_id: 'u1',
              org_external_id: 'acme',
              role: 'owner',
            },
            {
              email: 'b@example.com',
              user_external_id: 'u2',
              org_external_id: 'acme',
              role: 'guest',
            },
          ],
        }),
    });

    const memberships = await readCsvRows(path.join(tmpDir, 'organization_memberships.csv'));
    expect(memberships).toHaveLength(2);
    expect(memberships.every((m) => m.role_slugs === '')).toBe(true);

    const warnings = fs.readFileSync(path.join(tmpDir, 'warnings.jsonl'), 'utf-8');
    expect(warnings).toMatch(/Unmapped role: owner/);
    expect(warnings).toMatch(/Unmapped role: guest/);
  });
});

async function readCsvRows(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  for await (const row of streamCSV(filePath)) {
    rows.push(row as Record<string, string>);
  }
  return rows;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
