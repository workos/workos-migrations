import { jest } from '@jest/globals';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportSupabase } from '../../../src/exporters/supabase/exporter.js';
import type { SupabasePgQueryClient } from '../../../src/exporters/supabase/pg-client.js';
import { streamCSV } from '../../../src/shared/csv-utils.js';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/providers/supabase/fixtures');

interface FakePgState {
  mfaRows?: Array<Record<string, unknown>>;
  samlRows?: Array<Record<string, unknown>>;
  failTestConnection?: boolean;
}

function fakePgClient(state: FakePgState): SupabasePgQueryClient {
  return {
    async testConnection() {
      if (state.failTestConnection) {
        throw new Error('SSL connection required');
      }
    },
    async query<T>(sql: string): Promise<T[]> {
      if (/auth\.mfa_factors/i.test(sql)) return (state.mfaRows ?? []) as T[];
      if (/auth\.saml_providers/i.test(sql)) return (state.samlRows ?? []) as T[];
      return [] as T[];
    },
    async close() {},
  };
}

const SAMPLE_SAML_METADATA = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com/saml">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor>
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data><X509Certificate>MIIDCERT</X509Certificate></X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;

describe('exportSupabase end-to-end with Postgres-backed entities', () => {
  let tmpDir: string;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabase-export-pg-test-'));
    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('produces users + MFA + SAML outputs when --db-url is provided', async () => {
    const page1 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-1.json'), 'utf-8'));
    const empty = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-3-empty.json'), 'utf-8'));

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ users: [page1.users[0]] })) // testConnection probe
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(empty));

    await exportSupabase({
      url: 'https://demo.supabase.co',
      serviceRoleKey: 'sb-service-role-jwt',
      dbUrl: 'postgresql://user:pw@db.example.com:5432/postgres',
      outputDir: tmpDir,
      entities: ['users', 'mfa', 'sso'],
      rateLimit: 1000,
      pageSize: 100,
      quiet: true,
      pgClientFactory: () =>
        fakePgClient({
          mfaRows: [
            {
              email: 'alice@example.com',
              factor_type: 'totp',
              secret: 'JBSWY3DPEHPK3PXP',
              friendly_name: 'Phone',
              status: 'verified',
            },
          ],
          samlRows: [
            {
              id: 'saml-1',
              sso_provider_id: 'ssp-1',
              entity_id: null,
              metadata_xml: SAMPLE_SAML_METADATA,
              metadata_url: null,
              attribute_mapping: { keys: { email: 'urn:oid:email' } },
              resource_id: 'ext-org-1',
              domains: ['example.com'],
            },
          ],
        }),
    });

    const usersRows = await readCsvRows(path.join(tmpDir, 'users.csv'));
    expect(usersRows.length).toBeGreaterThanOrEqual(2);

    const totpRows = await readCsvRows(path.join(tmpDir, 'totp_secrets.csv'));
    expect(totpRows).toHaveLength(1);
    expect(totpRows[0].email).toBe('alice@example.com');
    expect(totpRows[0].totp_secret).toBe('JBSWY3DPEHPK3PXP');
    expect(totpRows[0].totp_issuer).toBe('Supabase');

    const samlRows = await readCsvRows(path.join(tmpDir, 'sso/saml_connections.csv'));
    expect(samlRows).toHaveLength(1);
    expect(samlRows[0].idpUrl).toBe('https://idp.example.com/sso');
    expect(samlRows[0].x509Cert).toBe('MIIDCERT');
    expect(samlRows[0].domains).toBe('example.com');

    const manifest = JSON.parse(await fsp.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8'));
    expect(manifest.entitiesExported.totpSecrets).toBe(1);
    expect(manifest.entitiesExported.samlConnections).toBe(1);
  });

  it('completes users.csv with a warning when Postgres connection fails', async () => {
    const page1 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-1.json'), 'utf-8'));
    const empty = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-3-empty.json'), 'utf-8'));

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ users: [page1.users[0]] }))
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(empty));

    await exportSupabase({
      url: 'https://demo.supabase.co',
      serviceRoleKey: 'sb-service-role-jwt',
      dbUrl: 'postgresql://user:pw@db.example.com:5432/postgres',
      outputDir: tmpDir,
      entities: ['users', 'mfa', 'sso'],
      rateLimit: 1000,
      pageSize: 100,
      quiet: true,
      pgClientFactory: () => fakePgClient({ failTestConnection: true }),
    });

    expect(fs.existsSync(path.join(tmpDir, 'users.csv'))).toBe(true);
    const usersRows = await readCsvRows(path.join(tmpDir, 'users.csv'));
    expect(usersRows.length).toBeGreaterThan(0);

    const totpRows = await readCsvRows(path.join(tmpDir, 'totp_secrets.csv'));
    expect(totpRows).toHaveLength(0);

    const warnings = fs
      .readFileSync(path.join(tmpDir, 'warnings.jsonl'), 'utf-8')
      .split('\n')
      .filter(Boolean);
    expect(warnings.some((w) => /Supabase Postgres connection failed/.test(w))).toBe(true);
  });

  it('warns and skips mfa/sso when --db-url is not provided', async () => {
    const page1 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-1.json'), 'utf-8'));
    const empty = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'admin-users-page-3-empty.json'), 'utf-8'));

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ users: [page1.users[0]] }))
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(empty));

    await exportSupabase({
      url: 'https://demo.supabase.co',
      serviceRoleKey: 'sb-service-role-jwt',
      outputDir: tmpDir,
      entities: ['users', 'mfa'],
      rateLimit: 1000,
      pageSize: 100,
      quiet: true,
    });

    const totpRows = await readCsvRows(path.join(tmpDir, 'totp_secrets.csv'));
    expect(totpRows).toHaveLength(0);

    const warnings = fs
      .readFileSync(path.join(tmpDir, 'warnings.jsonl'), 'utf-8')
      .split('\n')
      .filter(Boolean);
    expect(warnings.some((w) => /require --db-url/.test(w))).toBe(true);
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
