import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamCSV } from '../../../shared/csv-utils';
import type {
  Auth0Connection,
  Auth0Job,
  Auth0Organization,
  Auth0OrganizationConnection,
  Auth0Role,
  Auth0User,
  Auth0UserExportField,
} from '../../../shared/types';
import { validateMigrationPackage } from '../../../package/validator';
import { exportAuth0PackageWithClient, type Auth0ExportClient } from '../package-exporter';

interface FakeAuth0ClientOptions {
  organizations?: Auth0Organization[];
  membersByOrg?: Record<string, Array<{ user_id: string }>>;
  usersById?: Record<string, Auth0User>;
  connections?: Auth0Connection[];
  organizationConnectionsByOrg?: Record<string, Auth0OrganizationConnection[]>;
  roles?: Auth0Role[];
  rolesByMember?: Record<string, Auth0Role[]>;
  bulkJobs?: {
    initial: Auth0Job;
    statuses: Auth0Job[];
    payload: string;
  };
}

class FakeAuth0Client implements Auth0ExportClient {
  private readonly organizations: Auth0Organization[];
  private readonly membersByOrg: Record<string, Array<{ user_id: string }>>;
  private readonly usersById: Record<string, Auth0User>;
  private readonly connections: Auth0Connection[];
  private readonly organizationConnectionsByOrg: Record<string, Auth0OrganizationConnection[]>;
  private readonly roles: Auth0Role[];
  private readonly rolesByMember: Record<string, Auth0Role[]>;
  private readonly bulkJobs?: FakeAuth0ClientOptions['bulkJobs'];
  private bulkJobStatusIndex = 0;

  constructor(options: FakeAuth0ClientOptions = {}) {
    this.organizations = options.organizations ?? [];
    this.membersByOrg = options.membersByOrg ?? {};
    this.usersById = options.usersById ?? {};
    this.connections = options.connections ?? [];
    this.organizationConnectionsByOrg = options.organizationConnectionsByOrg ?? {};
    this.roles = options.roles ?? [];
    this.rolesByMember = options.rolesByMember ?? {};
    this.bulkJobs = options.bulkJobs;
  }

  async createUserExportJob(_options?: {
    connectionId?: string;
    format?: 'json' | 'csv';
    limit?: number;
    fields?: Auth0UserExportField[];
  }): Promise<Auth0Job> {
    if (!this.bulkJobs) throw new Error('Fake client has no bulk-job fixture');
    return this.bulkJobs.initial;
  }

  async getJob(jobId: string): Promise<Auth0Job> {
    if (!this.bulkJobs) throw new Error('Fake client has no bulk-job fixture');
    const next =
      this.bulkJobs.statuses[this.bulkJobStatusIndex] ??
      this.bulkJobs.statuses[this.bulkJobs.statuses.length - 1] ??
      this.bulkJobs.initial;
    this.bulkJobStatusIndex = Math.min(
      this.bulkJobStatusIndex + 1,
      this.bulkJobs.statuses.length - 1,
    );
    expect(jobId).toBe(this.bulkJobs.initial.id);
    return next;
  }

  async downloadJobLocation(_location: string): Promise<string> {
    if (!this.bulkJobs) throw new Error('Fake client has no bulk-job fixture');
    return this.bulkJobs.payload;
  }

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

  async getRoles(page = 0): Promise<Auth0Role[]> {
    return page === 0 ? this.roles : [];
  }

  async getMemberRoles(orgId: string, userId: string, page = 0): Promise<Auth0Role[]> {
    if (page !== 0) return [];
    return this.rolesByMember[`${orgId}:${userId}`] ?? [];
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
    const client = new FakeAuth0Client({
      organizations: [org],
      membersByOrg: {
        [org.id]: [
          { user_id: databaseUser.user_id },
          { user_id: blockedUser.user_id },
          { user_id: federatedUser.user_id },
        ],
      },
      usersById: {
        [databaseUser.user_id]: databaseUser,
        [blockedUser.user_id]: blockedUser,
        [federatedUser.user_id]: federatedUser,
      },
    });

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
      uploadUsers: 2,
      uploadOrganizations: 1,
      uploadMemberships: 2,
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

    expect(await readCsv(path.join(tempRoot, 'workos_upload', 'users.csv'))).toMatchObject([
      {
        user_id: 'auth0|db',
        email: 'db@example.com',
        email_verified: 'true',
        first_name: 'Database',
        last_name: 'User',
        password_hash: '',
      },
      {
        user_id: 'auth0|blocked',
        email: 'blocked@example.com',
        email_verified: 'true',
        first_name: 'Blocked',
        last_name: 'User',
        password_hash: '',
      },
    ]);
    expect(await readCsv(path.join(tempRoot, 'workos_upload', 'organizations.csv'))).toEqual([
      {
        organization_id: 'org_abc123',
        name: 'Acme',
      },
    ]);
    expect(
      await readCsv(path.join(tempRoot, 'workos_upload', 'organization_memberships.csv')),
    ).toEqual([
      {
        organization_id: 'org_abc123',
        user_id: 'auth0|db',
      },
      {
        organization_id: 'org_abc123',
        user_id: 'auth0|blocked',
      },
    ]);

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
    const client = new FakeAuth0Client({
      organizations: [org],
      membersByOrg: {
        [org.id]: [{ user_id: federatedUser.user_id }],
      },
      usersById: {
        [federatedUser.user_id]: federatedUser,
      },
    });

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
    const client = new FakeAuth0Client({
      organizations: [],
      membersByOrg: {},
      usersById: {
        [metadataUser.user_id]: metadataUser,
        [skippedUser.user_id]: skippedUser,
      },
    });

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
      uploadUsers: 1,
      uploadOrganizations: 1,
      uploadMemberships: 1,
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
    expect(await readCsv(path.join(tempRoot, 'workos_upload', 'users.csv'))).toMatchObject([
      {
        user_id: 'auth0|metadata',
        email: 'metadata@example.com',
      },
    ]);
    expect(await readCsv(path.join(tempRoot, 'workos_upload', 'organizations.csv'))).toEqual([
      {
        organization_id: 'org_metadata',
        name: 'Metadata Org',
      },
    ]);
    expect(
      await readCsv(path.join(tempRoot, 'workos_upload', 'organization_memberships.csv')),
    ).toEqual([
      {
        organization_id: 'org_metadata',
        user_id: 'auth0|metadata',
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
    const client = new FakeAuth0Client({
      organizations: [org],
      connections: [samlConnection, oidcConnection, unsupportedConnection, incompleteConnection],
      organizationConnectionsByOrg: {
        [org.id]: [{ connection_id: 'con_saml' }, { connection_id: 'con_oidc' }],
      },
    });

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
      uploadUsers: 0,
      uploadOrganizations: 0,
      uploadMemberships: 0,
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
        importedId: 'okta',
      },
    ]);

    expect(await readCsv(path.join(tempRoot, 'sso', 'oidc_connections.csv'))).toMatchObject([
      {
        organizationExternalId: 'org_abc123',
        clientId: 'client_123',
        clientSecret: '',
        discoveryEndpoint: 'https://issuer.example.com/.well-known/openid-configuration',
        importedId: 'oidc-idp',
      },
    ]);

    expect(
      await readCsv(path.join(tempRoot, 'sso', 'custom_attribute_mappings.csv')),
    ).toMatchObject([
      {
        importedId: 'okta',
        userPoolAttribute: 'department',
        idpClaim: 'department',
      },
      {
        importedId: 'oidc-idp',
        userPoolAttribute: 'title',
        idpClaim: 'title',
      },
    ]);
    expect(await readCsv(path.join(tempRoot, 'sso', 'proxy_routes.csv'))).toHaveLength(2);
    expect(await readCsv(path.join(tempRoot, 'workos_upload', 'users.csv'))).toEqual([]);
    expect(await readCsv(path.join(tempRoot, 'workos_upload', 'organizations.csv'))).toEqual([]);
    expect(
      await readCsv(path.join(tempRoot, 'workos_upload', 'organization_memberships.csv')),
    ).toEqual([]);

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
    const client = new FakeAuth0Client({
      organizations: [org],
      connections: [oidcConnection],
      organizationConnectionsByOrg: {
        [org.id]: [{ connection_id: 'con_oidc' }],
      },
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

  it('exports role definitions and per-org user role assignments when roles entity is requested', async () => {
    const adminRole: Auth0Role = { id: 'rol_admin', name: 'Admin' };
    const memberRole: Auth0Role = { id: 'rol_member', name: 'Member' };
    const duplicateRole: Auth0Role = { id: 'rol_admin_dup', name: 'admin' };
    const emptyRole: Auth0Role = { id: 'rol_blank', name: '' };
    const multiRoleUser: Auth0User = {
      ...databaseUser,
      user_id: 'auth0|multi',
      email: 'multi@example.com',
    };

    const client = new FakeAuth0Client({
      organizations: [org],
      membersByOrg: {
        [org.id]: [{ user_id: databaseUser.user_id }, { user_id: multiRoleUser.user_id }],
      },
      usersById: {
        [databaseUser.user_id]: databaseUser,
        [multiRoleUser.user_id]: multiRoleUser,
      },
      roles: [adminRole, memberRole, duplicateRole, emptyRole],
      rolesByMember: {
        [`${org.id}:${databaseUser.user_id}`]: [adminRole, adminRole],
        [`${org.id}:${multiRoleUser.user_id}`]: [adminRole, memberRole],
      },
    });

    const summary = await exportAuth0PackageWithClient(client, {
      domain: 'example.us.auth0.com',
      clientId: 'client_123',
      clientSecret: 'secret',
      package: true,
      outputDir: tempRoot,
      entities: ['users', 'organizations', 'memberships', 'roles'],
      pageSize: 100,
      rateLimit: 50,
      userFetchConcurrency: 2,
      useMetadata: false,
      quiet: true,
    });

    expect(summary).toMatchObject({
      totalUsers: 2,
      totalOrgs: 1,
      skippedUsers: 0,
    });

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.entitiesExported).toMatchObject({
      users: 2,
      organizations: 1,
      memberships: 2,
      roleDefinitions: 4,
      userRoleAssignments: 3,
    });

    const roleDefinitions = await readCsv(path.join(tempRoot, 'role_definitions.csv'));
    expect(roleDefinitions).toMatchObject([
      { role_slug: 'admin-role', role_name: 'Admin', role_type: 'environment' },
      { role_slug: 'member-role', role_name: 'Member' },
      { role_slug: 'admin-role-2', role_name: 'admin' },
      { role_slug: expect.stringMatching(/^auth0-role-/) },
    ]);

    const assignments = await readCsv(path.join(tempRoot, 'user_role_assignments.csv'));
    expect(assignments).toEqual([
      {
        email: 'db@example.com',
        user_id: '',
        external_id: 'auth0|db',
        role_slug: 'admin-role',
        org_id: '',
        org_external_id: 'org_abc123',
      },
      {
        email: 'multi@example.com',
        user_id: '',
        external_id: 'auth0|multi',
        role_slug: 'admin-role',
        org_id: '',
        org_external_id: 'org_abc123',
      },
      {
        email: 'multi@example.com',
        user_id: '',
        external_id: 'auth0|multi',
        role_slug: 'member-role',
        org_id: '',
        org_external_id: 'org_abc123',
      },
    ]);

    const users = await readCsv(path.join(tempRoot, 'users.csv'));
    expect(users.find((row) => row.external_id === 'auth0|db')?.role_slugs).toBe('admin-role');
    expect(users.find((row) => row.external_id === 'auth0|multi')?.role_slugs).toBe(
      'admin-role,member-role',
    );

    const memberships = await readCsv(path.join(tempRoot, 'organization_memberships.csv'));
    expect(memberships.find((row) => row.external_id === 'auth0|multi')?.role_slugs).toBe(
      'admin-role,member-role',
    );

    const warnings = readJsonl(path.join(tempRoot, 'warnings.jsonl'));
    const codes = warnings.map((warning) => warning.code).sort();
    expect(codes).toContain('duplicate_role_slug');
    expect(codes).toContain('unmappable_role_name');

    expect(await readCsv(path.join(tempRoot, 'workos_upload', 'users.csv'))).toHaveLength(2);
  });

  it('skips role assignments and warns when using metadata-based org discovery', async () => {
    const metadataUser: Auth0User = {
      ...databaseUser,
      user_id: 'auth0|metadata-roles',
      email: 'metadata@example.com',
      user_metadata: {
        organization_id: 'org_metadata',
        organization_name: 'Metadata Org',
      },
    };
    const adminRole: Auth0Role = { id: 'rol_admin', name: 'Admin' };

    const client = new FakeAuth0Client({
      organizations: [],
      membersByOrg: {},
      usersById: {
        [metadataUser.user_id]: metadataUser,
      },
      roles: [adminRole],
    });

    await exportAuth0PackageWithClient(client, {
      domain: 'example.us.auth0.com',
      clientId: 'client_123',
      clientSecret: 'secret',
      package: true,
      outputDir: tempRoot,
      entities: ['users', 'organizations', 'memberships', 'roles'],
      pageSize: 100,
      rateLimit: 50,
      userFetchConcurrency: 2,
      useMetadata: true,
      quiet: true,
    });

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.entitiesExported).toMatchObject({
      users: 1,
      roleDefinitions: 1,
      userRoleAssignments: 0,
    });
    const warnings = readJsonl(path.join(tempRoot, 'warnings.jsonl'));
    expect(warnings.map((warning) => warning.code)).toContain(
      'role_assignments_unavailable_metadata_mode',
    );
  });

  it('exports users via bulk-job engine with no org membership', async () => {
    const bulkUser: Auth0User = {
      ...databaseUser,
      user_id: 'auth0|bulk',
      email: 'bulk@example.com',
      given_name: 'Bulk',
      family_name: 'User',
    };
    const initial: Auth0Job = {
      id: 'job_bulk',
      type: 'users_export',
      status: 'pending',
    };

    const client = new FakeAuth0Client({
      bulkJobs: {
        initial,
        statuses: [
          { ...initial, status: 'processing' },
          {
            ...initial,
            status: 'completed',
            location: 'https://example.com/users.ndjson',
          },
        ],
        payload: `${JSON.stringify(bulkUser)}\n`,
      },
    });

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
      engine: 'bulk-job',
      bulkPollIntervalMs: 1,
      bulkMaxPollAttempts: 5,
      quiet: true,
    });

    expect(summary).toMatchObject({
      totalUsers: 1,
      totalOrgs: 0,
    });

    const users = await readCsv(path.join(tempRoot, 'users.csv'));
    expect(users).toMatchObject([
      {
        email: 'bulk@example.com',
        external_id: 'auth0|bulk',
        org_external_id: '',
      },
    ]);

    const uploadUsers = await readCsv(path.join(tempRoot, 'workos_upload', 'users.csv'));
    expect(uploadUsers).toMatchObject([
      {
        user_id: 'auth0|bulk',
        email: 'bulk@example.com',
      },
    ]);

    const warnings = readJsonl(path.join(tempRoot, 'warnings.jsonl'));
    expect(warnings.map((warning) => warning.code)).toContain('bulk_export_no_org_membership');
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
