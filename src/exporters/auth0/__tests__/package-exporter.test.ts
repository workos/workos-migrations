import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamCSV } from '../../../shared/csv-utils';
import type {
  Auth0Connection,
  Auth0Organization,
  Auth0OrganizationConnection,
  Auth0User,
} from '../../../shared/types';
import { validateMigrationPackage } from '../../../package/validator';
import { exportAuth0PackageWithClient, type Auth0ExportClient } from '../package-exporter';

class FakeAuth0Client implements Auth0ExportClient {
  constructor(
    private readonly organizations: Auth0Organization[],
    private readonly membersByOrg: Record<string, Array<{ user_id: string }>>,
    private readonly usersById: Record<string, Auth0User>,
    private readonly connections: Auth0Connection[] = [],
    private readonly organizationConnectionsByOrg: Record<
      string,
      Auth0OrganizationConnection[]
    > = {},
  ) {}

  async getConnections(page = 0): Promise<Auth0Connection[]> {
    return page === 0 ? this.connections : [];
  }

  async getConnection(connectionId: string): Promise<Auth0Connection> {
    const connection = this.connections.find((item) => item.id === connectionId);
    if (!connection) throw new Error(`Unknown connection ${connectionId}`);
    return connection;
  }

  async getOrganizations(page = 0): Promise<Auth0Organization[]> {
    return page === 0 ? this.organizations : [];
  }

  async getOrganizationConnections(
    orgId: string,
    page = 0,
  ): Promise<Auth0OrganizationConnection[]> {
    return page === 0 ? (this.organizationConnectionsByOrg[orgId] ?? []) : [];
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

  it('writes SSO-only handoff package files with warnings and redacted raw snapshots', async () => {
    const samlConnection: Auth0Connection = {
      id: 'con_saml',
      name: 'okta',
      strategy: 'samlp',
      options: {
        entityId: 'https://idp.example.com/entity',
        signInEndpoint: 'https://idp.example.com/sso',
        signingCert: 'CERTDATA',
        fieldsMap: {
          email: 'mail',
          department: 'department',
        },
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
        mapping: {
          title: 'title',
        },
      },
    };
    const unsupportedConnection: Auth0Connection = {
      id: 'con_db',
      name: 'Username-Password-Authentication',
      strategy: 'auth0',
    };
    const incompleteConnection: Auth0Connection = {
      id: 'con_incomplete',
      name: 'incomplete-saml',
      strategy: 'samlp',
      options: {
        signInEndpoint: 'https://idp.example.com/sso',
      },
    };
    const client = new FakeAuth0Client(
      [org],
      {},
      {},
      [samlConnection, oidcConnection, unsupportedConnection, incompleteConnection],
      {
        [org.id]: [{ connection_id: 'con_saml' }, { connection_id: 'con_oidc' }],
      },
    );

    const summary = await exportAuth0PackageWithClient(client, {
      domain: 'example.us.auth0.com',
      clientId: 'client_123',
      clientSecret: 'secret',
      package: true,
      outputDir: tempRoot,
      entities: ['sso'],
      pageSize: 100,
      rateLimit: 50,
      userFetchConcurrency: 2,
      useMetadata: false,
      quiet: true,
    });

    expect(summary).toMatchObject({
      totalUsers: 0,
      totalOrgs: 0,
      skippedUsers: 0,
    });

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.entitiesRequested).toEqual(['sso']);
    expect(validation.manifest?.entitiesExported).toMatchObject({
      users: 0,
      organizations: 0,
      memberships: 0,
      samlConnections: 1,
      oidcConnections: 1,
      customAttributeMappings: 2,
      proxyRoutes: 2,
      warnings: 3,
      skippedUsers: 0,
    });
    expect(validation.manifest?.secretRedaction).toMatchObject({
      mode: 'redacted',
      redacted: true,
    });

    expect(await readCsv(path.join(tempRoot, 'sso', 'saml_connections.csv'))).toMatchObject([
      {
        organizationName: 'Acme',
        organizationExternalId: 'org_abc123',
        domains: 'acme.com,login.acme.com',
        idpEntityId: 'https://idp.example.com/entity',
        idpUrl: 'https://idp.example.com/sso',
        x509Cert: 'CERTDATA',
        emailAttribute: 'mail',
        importedId: 'auth0:con_saml',
      },
    ]);

    expect(await readCsv(path.join(tempRoot, 'sso', 'oidc_connections.csv'))).toMatchObject([
      {
        organizationExternalId: 'org_abc123',
        clientId: 'client_123',
        clientSecret: '',
        discoveryEndpoint: 'https://issuer.example.com/.well-known/openid-configuration',
        importedId: 'auth0:con_oidc',
      },
    ]);

    expect(
      await readCsv(path.join(tempRoot, 'sso', 'custom_attribute_mappings.csv')),
    ).toMatchObject([
      {
        importedId: 'auth0:con_saml',
        userPoolAttribute: 'department',
        idpClaim: 'department',
      },
      {
        importedId: 'auth0:con_oidc',
        userPoolAttribute: 'title',
        idpClaim: 'title',
      },
    ]);
    expect(await readCsv(path.join(tempRoot, 'sso', 'proxy_routes.csv'))).toHaveLength(2);

    const warnings = readJsonl(path.join(tempRoot, 'warnings.jsonl'));
    expect(warnings.map((warning) => warning.code).sort()).toEqual([
      'incomplete_connection_configuration',
      'secrets_redacted',
      'unsupported_connection_protocol',
    ]);

    const raw = fs.readFileSync(path.join(tempRoot, 'raw', 'auth0-connections.jsonl'), 'utf-8');
    expect(raw).toContain('"client_secret":"[REDACTED]"');
    expect(raw).not.toContain('oidc-secret');
  });

  it('includes SSO secrets when explicitly requested', async () => {
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
    const client = new FakeAuth0Client([org], {}, {}, [oidcConnection], {
      [org.id]: [{ connection_id: 'con_oidc' }],
    });

    await exportAuth0PackageWithClient(client, {
      domain: 'example.us.auth0.com',
      clientId: 'client_123',
      clientSecret: 'secret',
      package: true,
      outputDir: tempRoot,
      entities: ['sso'],
      includeSecrets: true,
      pageSize: 100,
      rateLimit: 50,
      userFetchConcurrency: 2,
      useMetadata: false,
      quiet: true,
    });

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.secretRedaction).toMatchObject({
      mode: 'included',
      redacted: false,
    });
    expect(validation.manifest?.secretsRedacted).toBe(false);

    expect(await readCsv(path.join(tempRoot, 'sso', 'oidc_connections.csv'))).toMatchObject([
      {
        clientId: 'client_123',
        clientSecret: 'oidc-secret',
      },
    ]);
    expect(
      fs.readFileSync(path.join(tempRoot, 'raw', 'auth0-connections.jsonl'), 'utf-8'),
    ).toContain('oidc-secret');
    expect(readJsonl(path.join(tempRoot, 'warnings.jsonl'))).toEqual([]);
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
