import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamCSV } from '../../../shared/csv-utils';
import type { Auth0Organization, Auth0User } from '../../../shared/types';
import type { Auth0ExportClient } from '../package-exporter';
import { exportAuth0CsvWithClient } from '../exporter';

class FakeAuth0Client implements Auth0ExportClient {
  constructor(
    private readonly organizations: Auth0Organization[],
    private readonly membersByOrg: Record<string, Array<{ user_id: string }>>,
    private readonly usersById: Record<string, Auth0User>,
  ) {}

  async getOrganizations(page = 0): Promise<Auth0Organization[]> {
    return page === 0 ? this.organizations : [];
  }

  async getOrganizationMembers(orgId: string, page = 0): Promise<Array<{ user_id: string }>> {
    return page === 0 ? (this.membersByOrg[orgId] ?? []) : [];
  }

  async getUser(userId: string): Promise<Auth0User | null> {
    return this.usersById[userId] ?? null;
  }

  async getUsers(page = 0): Promise<Auth0User[]> {
    return page === 0 ? Object.values(this.usersById) : [];
  }
}

describe('exportAuth0CsvWithClient', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-auth0-csv-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('preserves the legacy single CSV export shape', async () => {
    const org: Auth0Organization = {
      id: 'org_abc123',
      name: 'acme',
      display_name: 'Acme',
    };
    const user: Auth0User = {
      user_id: 'auth0|db',
      email: 'db@example.com',
      email_verified: true,
      given_name: 'Database',
      family_name: 'User',
      user_metadata: { department: 'Engineering' },
      app_metadata: { role: 'Admin' },
      created_at: '2026-04-29T00:00:00.000Z',
      updated_at: '2026-04-29T00:00:00.000Z',
    };
    const output = path.join(tempRoot, 'auth0-export.csv');
    const client = new FakeAuth0Client(
      [org],
      { [org.id]: [{ user_id: user.user_id }] },
      { [user.user_id]: user },
    );

    const summary = await exportAuth0CsvWithClient(client, {
      domain: 'example.us.auth0.com',
      clientId: 'client_123',
      clientSecret: 'secret',
      output,
      pageSize: 100,
      rateLimit: 50,
      userFetchConcurrency: 2,
      useMetadata: false,
      quiet: true,
    });

    expect(summary).toMatchObject({
      totalUsers: 1,
      totalOrgs: 1,
      skippedUsers: 0,
    });

    const raw = fs.readFileSync(output, 'utf-8');
    expect(raw.split(/\r?\n/)[0]).toBe(
      'email,first_name,last_name,email_verified,external_id,org_external_id,org_name,metadata',
    );

    const rows = await readCsv(output);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'db@example.com',
      first_name: 'Database',
      last_name: 'User',
      email_verified: 'true',
      external_id: 'auth0|db',
      org_external_id: 'org_abc123',
      org_name: 'Acme',
    });
    expect(JSON.parse(rows[0].metadata).auth0_user_id).toBe('auth0|db');
    expect(fs.readFileSync(output.replace('.csv', '-skipped.jsonl'), 'utf-8')).toBe('');
  });
});

async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  for await (const row of streamCSV(filePath)) {
    rows.push(row as Record<string, string>);
  }
  return rows;
}
