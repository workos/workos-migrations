import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamCSV } from '../../../shared/csv-utils';
import { validateMigrationPackage } from '../../../package/validator';
import { exportClerkPackage } from '../package-exporter';

describe('exportClerkPackage', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-clerk-pkg-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('writes a valid package from a Clerk dashboard CSV with org and role mappings', async () => {
    const inputCsv = path.join(tempRoot, 'clerk.csv');
    fs.writeFileSync(
      inputCsv,
      [
        'id,primary_email_address,first_name,last_name,password_hasher,password_digest,username',
        'user_alice,alice@acme.com,Alice,Builder,bcrypt,$2a$10$alicehash,alice',
        'user_bob,bob@acme.com,Bob,,scrypt,$scrypt$bobhash,bob',
        'user_no_email,,,,,,',
      ].join('\n'),
    );

    const orgMappingPath = path.join(tempRoot, 'orgs.csv');
    fs.writeFileSync(
      orgMappingPath,
      'clerk_user_id,org_external_id,org_name\nuser_alice,acme,Acme\nuser_bob,acme,Acme\n',
    );

    const roleMappingPath = path.join(tempRoot, 'roles.csv');
    fs.writeFileSync(
      roleMappingPath,
      'clerk_user_id,role_slug\nuser_alice,admin\nuser_bob,member\n',
    );

    const pkgDir = path.join(tempRoot, 'pkg');
    const stats = await exportClerkPackage({
      input: inputCsv,
      outputDir: pkgDir,
      orgMapping: orgMappingPath,
      roleMapping: roleMappingPath,
      quiet: true,
    });

    expect(stats.totalUsers).toBe(2);
    expect(stats.totalOrgs).toBe(1);
    expect(stats.totalMemberships).toBe(2);
    expect(stats.roleDefinitions).toBe(2);
    expect(stats.userRoleAssignments).toBe(2);
    expect(stats.skippedUsers).toBe(1);
    expect(stats.warnings.some((w) => w.code === 'unsupported_password_hasher')).toBe(true);

    const validation = await validateMigrationPackage(pkgDir);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.provider).toBe('clerk');

    const users = await readCsv(path.join(pkgDir, 'users.csv'));
    expect(users.find((u) => u.external_id === 'user_alice')).toMatchObject({
      email: 'alice@acme.com',
      first_name: 'Alice',
      last_name: 'Builder',
      password_hash: '$2a$10$alicehash',
      password_hash_type: 'bcrypt',
      org_external_id: 'acme',
      role_slugs: 'admin',
    });
    expect(users.find((u) => u.external_id === 'user_bob')).toMatchObject({
      email: 'bob@acme.com',
      password_hash: '',
      password_hash_type: '',
    });

    const orgs = await readCsv(path.join(pkgDir, 'organizations.csv'));
    expect(orgs).toMatchObject([{ org_external_id: 'acme', org_name: 'Acme' }]);

    const memberships = await readCsv(path.join(pkgDir, 'organization_memberships.csv'));
    expect(memberships).toHaveLength(2);

    const roles = await readCsv(path.join(pkgDir, 'role_definitions.csv'));
    expect(roles.map((r) => r.role_slug).sort()).toEqual(['admin', 'member']);

    const assignments = await readCsv(path.join(pkgDir, 'user_role_assignments.csv'));
    expect(assignments).toHaveLength(2);

    const upload = await readCsv(path.join(pkgDir, 'workos_upload', 'users.csv'));
    expect(upload).toHaveLength(2);
    expect(upload.find((u) => u.user_id === 'user_alice')?.password_hash).toBe('$2a$10$alicehash');
  });

  it('writes a package without orgs when no mapping is provided', async () => {
    const inputCsv = path.join(tempRoot, 'clerk.csv');
    fs.writeFileSync(
      inputCsv,
      'id,primary_email_address,first_name\nuser_solo,solo@acme.com,Solo\n',
    );
    const pkgDir = path.join(tempRoot, 'pkg');
    const stats = await exportClerkPackage({ input: inputCsv, outputDir: pkgDir, quiet: true });

    expect(stats.totalUsers).toBe(1);
    expect(stats.totalOrgs).toBe(0);
    expect(stats.totalMemberships).toBe(0);

    const validation = await validateMigrationPackage(pkgDir);
    expect(validation.valid).toBe(true);
  });

  it('fetches and writes enterprise connections (SAML + OIDC) when clerkSecretKey is provided', async () => {
    const inputCsv = path.join(tempRoot, 'clerk.csv');
    fs.writeFileSync(
      inputCsv,
      'id,primary_email_address,first_name\nuser_solo,solo@acme.com,Solo\n',
    );
    const pkgDir = path.join(tempRoot, 'pkg');

    const fetchImpl = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'ec_saml_okta',
                name: 'Acme Okta',
                domains: ['acme.com'],
                organization_id: 'org_acme',
                saml_connection: {
                  idp_entity_id: 'https://acme.okta.com/exk1',
                  idp_sso_url: 'https://acme.okta.com/sso/saml',
                  idp_certificate: 'CERTDATA',
                  acs_url: 'https://clerk.acme.com/acs',
                  sp_entity_id: 'https://clerk.acme.com/saml',
                  attribute_mapping: {
                    email_address: 'mail',
                    first_name: 'givenName',
                    last_name: 'surname',
                    department: 'department',
                  },
                  allow_idp_initiated: true,
                },
              },
              {
                id: 'ec_oidc_azure',
                name: 'Acme Azure',
                domains: ['azure.acme.com'],
                organization_id: 'org_acme',
                oauth_config: {
                  client_id: 'azure-client',
                  discovery_url:
                    'https://login.microsoftonline.com/tenant/.well-known/openid-configuration',
                },
              },
              {
                id: 'ec_broken_saml',
                name: 'Broken',
                domains: [],
                saml_connection: {
                  idp_entity_id: '',
                  idp_sso_url: '',
                  idp_certificate: null,
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const stats = await exportClerkPackage({
      input: inputCsv,
      outputDir: pkgDir,
      clerkSecretKey: 'sk_test_abc',
      clerkFetchImpl: fetchImpl as typeof fetch,
      quiet: true,
    });

    expect(stats.samlConnections).toBe(1);
    expect(stats.oidcConnections).toBe(1);
    expect(stats.customAttributeMappings).toBe(1);
    expect(stats.warnings.map((w) => w.code)).toContain('incomplete_connection_configuration');

    const samlRows = await readCsv(path.join(pkgDir, 'sso', 'saml_connections.csv'));
    expect(samlRows).toHaveLength(1);
    expect(samlRows[0]).toMatchObject({
      organizationExternalId: 'org_acme',
      idpEntityId: 'https://acme.okta.com/exk1',
      idpUrl: 'https://acme.okta.com/sso/saml',
      idpInitiatedEnabled: 'true',
      externalId: 'clerk:ec_saml_okta',
    });

    const oidcRows = await readCsv(path.join(pkgDir, 'sso', 'oidc_connections.csv'));
    expect(oidcRows).toHaveLength(1);
    expect(oidcRows[0]).toMatchObject({
      organizationExternalId: 'org_acme',
      clientId: 'azure-client',
      clientSecret: '',
      discoveryEndpoint:
        'https://login.microsoftonline.com/tenant/.well-known/openid-configuration',
      externalId: 'clerk:ec_oidc_azure',
    });

    const customAttrRows = await readCsv(path.join(pkgDir, 'sso', 'custom_attribute_mappings.csv'));
    expect(customAttrRows).toEqual([
      expect.objectContaining({
        externalId: 'clerk:ec_saml_okta',
        providerType: 'SAML',
        userPoolAttribute: 'department',
        idpClaim: 'department',
      }),
    ]);

    const handoff = fs.readFileSync(path.join(pkgDir, 'sso', 'handoff_notes.md'), 'utf-8');
    expect(handoff).toContain('returned 3 enterprise connection(s)');
    expect(handoff).toContain('1 SAML connection(s)');
    expect(handoff).toContain('1 OIDC connection(s)');

    const validation = await validateMigrationPackage(pkgDir);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.entitiesExported.samlConnections).toBe(1);
    expect(validation.manifest?.entitiesExported.oidcConnections).toBe(1);
    expect(validation.manifest?.entitiesRequested).toContain('sso');
  });

  it('records a warning and leaves SSO empty when the Clerk API call fails', async () => {
    const inputCsv = path.join(tempRoot, 'clerk.csv');
    fs.writeFileSync(inputCsv, 'id,primary_email_address\nuser_solo,solo@acme.com\n');
    const pkgDir = path.join(tempRoot, 'pkg');

    const fetchImpl = jest.fn(async () => new Response('forbidden', { status: 403 }));

    const stats = await exportClerkPackage({
      input: inputCsv,
      outputDir: pkgDir,
      clerkSecretKey: 'sk_test_abc',
      clerkFetchImpl: fetchImpl as typeof fetch,
      quiet: true,
    });

    expect(stats.samlConnections).toBe(0);
    expect(stats.warnings.some((w) => w.code === 'sso_fetch_failed')).toBe(true);

    const validation = await validateMigrationPackage(pkgDir);
    expect(validation.valid).toBe(true);
  });
});

async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  for await (const row of streamCSV(filePath)) {
    rows.push(row as Record<string, string>);
  }
  return rows;
}
