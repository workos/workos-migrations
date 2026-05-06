import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  exportAuth0PackageWithClient,
  type Auth0ExportClient,
} from '../../src/exporters/auth0/package-exporter.js';
import { mergePasswordsIntoPackage } from '../../src/exporters/auth0/password-merger.js';
import { validateMigrationPackage } from '../../src/package/validator.js';
import { planImportPackage, importPackage } from '../../src/import-package/orchestrator.js';
import { streamCSV } from '../../src/shared/csv-utils.js';
import type {
  Auth0Connection,
  Auth0Organization,
  Auth0OrganizationConnection,
  Auth0Role,
  Auth0User,
} from '../../src/shared/types.js';

// End-to-end fixture test for the Auth0 parity surface:
//   users / orgs / memberships / roles / password merge / SAML+OIDC handoff / warnings
// Runs entirely against fakes — no live Auth0 or WorkOS calls.

class FakeAuth0Client implements Auth0ExportClient {
  constructor(
    private readonly orgs: Auth0Organization[],
    private readonly membersByOrg: Record<string, Array<{ user_id: string }>>,
    private readonly usersById: Record<string, Auth0User>,
    private readonly connections: Auth0Connection[],
    private readonly orgConnections: Record<string, Auth0OrganizationConnection[]>,
    private readonly roles: Auth0Role[],
    private readonly memberRoles: Record<string, Auth0Role[]>,
  ) {}

  async getConnections(page = 0): Promise<Auth0Connection[]> {
    return page === 0 ? this.connections : [];
  }
  async getConnection(id: string): Promise<Auth0Connection> {
    const found = this.connections.find((c) => c.id === id);
    if (!found) throw new Error(`Unknown connection ${id}`);
    return found;
  }
  async getOrganizations(page = 0): Promise<Auth0Organization[]> {
    return page === 0 ? this.orgs : [];
  }
  async getOrganizationConnections(
    orgId: string,
    page = 0,
  ): Promise<Auth0OrganizationConnection[]> {
    return page === 0 ? (this.orgConnections[orgId] ?? []) : [];
  }
  async getOrganizationMembers(
    orgId: string,
    page = 0,
  ): Promise<Array<{ user_id: string }>> {
    return page === 0 ? (this.membersByOrg[orgId] ?? []) : [];
  }
  async getUser(userId: string): Promise<Auth0User | null> {
    return this.usersById[userId] ?? null;
  }
  async getUsers(page = 0): Promise<Auth0User[]> {
    return page === 0 ? Object.values(this.usersById) : [];
  }
  async getRoles(page = 0): Promise<Auth0Role[]> {
    return page === 0 ? this.roles : [];
  }
  async getMemberRoles(orgId: string, userId: string, page = 0): Promise<Auth0Role[]> {
    return page === 0 ? (this.memberRoles[`${orgId}:${userId}`] ?? []) : [];
  }
}

describe('Auth0 parity end-to-end', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-auth0-e2e-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('produces a complete, importable package and plans handoff for SSO', async () => {
    const acmeOrg: Auth0Organization = {
      id: 'org_acme',
      name: 'acme',
      display_name: 'Acme',
      metadata: { domains: ['acme.com'] },
    };

    const aliceUser: Auth0User = {
      user_id: 'auth0|alice',
      email: 'alice@example.com',
      email_verified: true,
      given_name: 'Alice',
      family_name: 'Example',
      created_at: '2026-04-29T00:00:00.000Z',
      updated_at: '2026-04-29T00:00:00.000Z',
      identities: [
        {
          provider: 'auth0',
          user_id: 'alice',
          connection: 'Username-Password-Authentication',
          isSocial: false,
        },
      ],
    };

    const bobUser: Auth0User = {
      ...aliceUser,
      user_id: 'auth0|bob',
      email: 'bob@example.com',
      given_name: 'Bob',
      family_name: 'Builder',
    };

    const blockedUser: Auth0User = {
      ...aliceUser,
      user_id: 'auth0|blocked',
      email: 'blocked@example.com',
      given_name: 'Blocked',
      family_name: 'User',
      blocked: true,
    };

    const adminRole: Auth0Role = { id: 'rol_admin', name: 'Admin' };
    const memberRole: Auth0Role = { id: 'rol_member', name: 'Member' };

    const samlConnection: Auth0Connection = {
      id: 'con_saml',
      name: 'okta',
      strategy: 'samlp',
      options: {
        entityId: 'https://idp.example.com/entity',
        signInEndpoint: 'https://idp.example.com/sso',
        signingCert: 'CERTDATA',
      },
    };

    const oidcConnection: Auth0Connection = {
      id: 'con_oidc',
      name: 'oidc-idp',
      strategy: 'oidc',
      options: {
        client_id: 'client_123',
        client_secret: 'oidc-secret',
        issuer: 'https://issuer.example.com',
      },
    };

    const client = new FakeAuth0Client(
      [acmeOrg],
      {
        [acmeOrg.id]: [
          { user_id: aliceUser.user_id },
          { user_id: bobUser.user_id },
          { user_id: blockedUser.user_id },
        ],
      },
      {
        [aliceUser.user_id]: aliceUser,
        [bobUser.user_id]: bobUser,
        [blockedUser.user_id]: blockedUser,
      },
      [samlConnection, oidcConnection],
      {
        [acmeOrg.id]: [{ connection_id: samlConnection.id }, { connection_id: oidcConnection.id }],
      },
      [adminRole, memberRole],
      {
        [`${acmeOrg.id}:${aliceUser.user_id}`]: [adminRole],
        [`${acmeOrg.id}:${bobUser.user_id}`]: [memberRole],
        [`${acmeOrg.id}:${blockedUser.user_id}`]: [],
      },
    );

    await exportAuth0PackageWithClient(client, {
      domain: 'tenant.us.auth0.com',
      clientId: 'client',
      clientSecret: 'secret',
      package: true,
      outputDir: tempRoot,
      entities: ['users', 'organizations', 'memberships', 'roles', 'sso'],
      pageSize: 100,
      rateLimit: 50,
      userFetchConcurrency: 4,
      useMetadata: false,
      quiet: true,
    });

    // Validate the package against the contract.
    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(true);

    const usersBefore = await readCsv(path.join(tempRoot, 'users.csv'));
    expect(usersBefore.map((row) => row.email)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'blocked@example.com',
    ]);
    expect(usersBefore[0].role_slugs).toBe('admin-role');
    expect(usersBefore[1].role_slugs).toBe('member-role');

    // Merge passwords against the package, with one supported and one unsupported algorithm.
    const passwordsPath = path.join(tempRoot, 'passwords.ndjson');
    fs.writeFileSync(
      passwordsPath,
      [
        JSON.stringify({ email: 'alice@example.com', passwordHash: '$2a$10$alicehash' }),
        JSON.stringify({
          email: 'bob@example.com',
          passwordHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        }),
        JSON.stringify({ email: 'missing@example.com', passwordHash: '$2a$10$nope' }),
      ].join('\n'),
    );

    const mergeStats = await mergePasswordsIntoPackage({
      packageDir: tempRoot,
      passwordsPath,
    });

    expect(mergeStats).toMatchObject({
      passwordsAdded: 1,
      passwordsRejectedAlgorithm: 1,
      uploadRowsUpdated: 1,
    });

    const usersAfter = await readCsv(path.join(tempRoot, 'users.csv'));
    expect(usersAfter.find((u) => u.email === 'alice@example.com')?.password_hash).toBe(
      '$2a$10$alicehash',
    );
    expect(usersAfter.find((u) => u.email === 'bob@example.com')?.password_hash).toBe('');

    const uploadUsers = await readCsv(path.join(tempRoot, 'workos_upload', 'users.csv'));
    expect(uploadUsers.find((u) => u.user_id === 'auth0|alice')?.password_hash).toBe(
      '$2a$10$alicehash',
    );

    // Plan the import.
    const plan = await planImportPackage(tempRoot);
    expect(plan).toMatchObject({
      manifestProvider: 'auth0',
      hasUsersCsv: true,
      hasOrganizationsCsv: true,
      hasMembershipsCsv: true,
      hasRoleDefinitionsCsv: true,
      hasRoleAssignmentsCsv: true,
      hasSso: true,
    });

    // Run the importer in dry-run mode (no WorkOS client).
    const summary = await importPackage({ packageDir: tempRoot, dryRun: true, quiet: true });
    expect(summary.users).toMatchObject({ status: 'planned', total: 3 });
    expect(summary.roleDefinitions).toMatchObject({ status: 'planned' });
    expect(summary.roleAssignments).toMatchObject({ status: 'planned' });
    expect(summary.ssoConnections).toMatchObject({ status: 'handoff' });

    // Warnings include all the expected codes.
    const warnings = readJsonl(path.join(tempRoot, 'warnings.jsonl'));
    const codes = warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(['blocked_user_metadata_only']));

    expect(fs.existsSync(path.join(tempRoot, 'sso/saml_connections.csv'))).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, 'sso/oidc_connections.csv'))).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, 'workos_import_summary.json'))).toBe(true);
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
