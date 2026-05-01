import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamCSV } from '../../../shared/csv-utils';
import type { Auth0Organization, Auth0User } from '../../../shared/types';
import { validateMigrationPackage } from '../../../package/validator';
import { exportAuth0PackageWithClient, type Auth0ExportClient } from '../package-exporter';

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

const org: Auth0Organization = {
  id: 'org_abc123',
  name: 'acme',
  display_name: 'Acme',
  metadata: {
    domains: ['acme.com', 'login.acme.com'],
  },
};

const databaseUser: Auth0User = {
  user_id: 'auth0|db',
  email: 'db@example.com',
  email_verified: true,
  given_name: 'Database',
  family_name: 'User',
  created_at: '2026-04-29T00:00:00.000Z',
  updated_at: '2026-04-29T00:00:00.000Z',
  identities: [
    {
      provider: 'auth0',
      user_id: 'db',
      connection: 'Username-Password-Authentication',
      isSocial: false,
    },
  ],
};

const blockedUser: Auth0User = {
  ...databaseUser,
  user_id: 'auth0|blocked',
  email: 'blocked@example.com',
  given_name: 'Blocked',
  blocked: true,
};

const federatedUser: Auth0User = {
  ...databaseUser,
  user_id: 'samlp|jit',
  email: 'jit@example.com',
  given_name: 'Federated',
  identities: [
    {
      provider: 'samlp',
      user_id: 'jit@example.com',
      connection: 'okta',
      isSocial: false,
    },
  ],
};

describe('exportAuth0PackageWithClient', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-auth0-package-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('writes a valid package with users, organizations, memberships, warnings, and skips', async () => {
    const client = new FakeAuth0Client(
      [org],
      {
        [org.id]: [
          { user_id: databaseUser.user_id },
          { user_id: blockedUser.user_id },
          { user_id: federatedUser.user_id },
        ],
      },
      {
        [databaseUser.user_id]: databaseUser,
        [blockedUser.user_id]: blockedUser,
        [federatedUser.user_id]: federatedUser,
      },
    );

    const summary = await exportAuth0PackageWithClient(client, {
      domain: 'example.us.auth0.com',
      clientId: 'client_123',
      clientSecret: 'secret',
      package: true,
      outputDir: tempRoot,
      pageSize: 100,
      rateLimit: 50,
      userFetchConcurrency: 2,
      useMetadata: false,
      quiet: true,
    });

    expect(summary).toMatchObject({
      totalUsers: 2,
      totalOrgs: 1,
      skippedUsers: 1,
    });

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.provider).toBe('auth0');
    expect(validation.manifest?.sourceTenant).toBe('example.us.auth0.com');
    expect(validation.manifest?.entitiesExported).toMatchObject({
      users: 2,
      organizations: 1,
      memberships: 2,
      warnings: 1,
      skippedUsers: 1,
    });

    const users = await readCsv(path.join(tempRoot, 'users.csv'));
    expect(users.map((row) => row.email)).toEqual(['db@example.com', 'blocked@example.com']);
    expect(users[0].org_external_id).toBe('org_abc123');
    expect(users[1].org_external_id).toBe('org_abc123');
    expect(JSON.parse(users[1].metadata).auth0_metadata_only).toBe('true');

    const organizations = await readCsv(path.join(tempRoot, 'organizations.csv'));
    expect(organizations).toMatchObject([
      {
        org_external_id: 'org_abc123',
        org_name: 'Acme',
        domains: 'acme.com,login.acme.com',
      },
    ]);

    const memberships = await readCsv(path.join(tempRoot, 'organization_memberships.csv'));
    expect(memberships).toHaveLength(2);
    expect(memberships[0]).toMatchObject({
      email: 'db@example.com',
      external_id: 'auth0|db',
      org_external_id: 'org_abc123',
    });

    const skipped = readJsonl(path.join(tempRoot, 'skipped_users.jsonl'));
    expect(skipped).toMatchObject([
      {
        user_id: 'samlp|jit',
        email: 'jit@example.com',
        reason: 'federated_user',
      },
    ]);

    const warnings = readJsonl(path.join(tempRoot, 'warnings.jsonl'));
    expect(warnings).toMatchObject([
      {
        code: 'blocked_user_metadata_only',
        user_id: 'auth0|blocked',
      },
    ]);
  });

  it('can include federated users when explicitly requested', async () => {
    const client = new FakeAuth0Client(
      [org],
      {
        [org.id]: [{ user_id: federatedUser.user_id }],
      },
      {
        [federatedUser.user_id]: federatedUser,
      },
    );

    const summary = await exportAuth0PackageWithClient(client, {
      domain: 'example.us.auth0.com',
      clientId: 'client_123',
      clientSecret: 'secret',
      package: true,
      outputDir: tempRoot,
      pageSize: 100,
      rateLimit: 50,
      userFetchConcurrency: 2,
      useMetadata: false,
      includeFederatedUsers: true,
      quiet: true,
    });

    expect(summary).toMatchObject({
      totalUsers: 1,
      skippedUsers: 0,
    });
    expect(await readCsv(path.join(tempRoot, 'users.csv'))).toHaveLength(1);
    expect(readJsonl(path.join(tempRoot, 'skipped_users.jsonl'))).toEqual([]);
  });

  it('writes package orgs, users, and memberships from metadata org discovery', async () => {
    const metadataUser: Auth0User = {
      ...databaseUser,
      user_id: 'auth0|metadata',
      email: 'metadata@example.com',
      user_metadata: {
        organization_id: 'org_metadata',
        organization_name: 'Metadata Org',
      },
    };
    const skippedUser: Auth0User = {
      ...databaseUser,
      user_id: 'auth0|no-org',
      email: 'no-org@example.com',
      user_metadata: {},
      app_metadata: {},
    };
    const client = new FakeAuth0Client(
      [],
      {},
      {
        [metadataUser.user_id]: metadataUser,
        [skippedUser.user_id]: skippedUser,
      },
    );

    const summary = await exportAuth0PackageWithClient(client, {
      domain: 'example.us.auth0.com',
      clientId: 'client_123',
      clientSecret: 'secret',
      package: true,
      outputDir: tempRoot,
      pageSize: 100,
      rateLimit: 50,
      userFetchConcurrency: 2,
      useMetadata: true,
      quiet: true,
    });

    expect(summary).toMatchObject({
      totalUsers: 1,
      totalOrgs: 1,
      skippedUsers: 1,
    });

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.entitiesExported).toMatchObject({
      users: 1,
      organizations: 1,
      memberships: 1,
      skippedUsers: 1,
    });

    expect(await readCsv(path.join(tempRoot, 'organizations.csv'))).toMatchObject([
      {
        org_external_id: 'org_metadata',
        org_name: 'Metadata Org',
      },
    ]);
    expect(await readCsv(path.join(tempRoot, 'users.csv'))).toMatchObject([
      {
        email: 'metadata@example.com',
        org_external_id: 'org_metadata',
        org_name: 'Metadata Org',
      },
    ]);
    expect(await readCsv(path.join(tempRoot, 'organization_memberships.csv'))).toMatchObject([
      {
        email: 'metadata@example.com',
        external_id: 'auth0|metadata',
        org_external_id: 'org_metadata',
      },
    ]);
    expect(readJsonl(path.join(tempRoot, 'skipped_users.jsonl'))).toMatchObject([
      {
        user_id: 'auth0|no-org',
        reason: 'no_org_in_metadata',
      },
    ]);
  });
});

async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  for await (const row of streamCSV(filePath)) {
    rows.push(row as Record<string, string>);
  }
  return rows;
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
}
