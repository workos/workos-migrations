import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamCSV } from '../../../shared/csv-utils';
import { validateMigrationPackage } from '../../../package/validator';
import { exportFirebasePackage } from '../package-exporter';

describe('exportFirebasePackage', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-firebase-pkg-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('writes a valid package and skips disabled + missing-email users by default', async () => {
    const inputJson = path.join(tempRoot, 'firebase.json');
    fs.writeFileSync(
      inputJson,
      JSON.stringify({
        users: [
          {
            localId: 'fb_alice',
            email: 'alice@acme.com',
            displayName: 'Alice Builder',
            emailVerified: true,
          },
          {
            localId: 'fb_disabled',
            email: 'sleeper@acme.com',
            displayName: 'Disabled',
            disabled: true,
          },
          {
            localId: 'fb_no_email',
            displayName: 'No Email',
          },
        ],
      }),
    );

    const orgMapping = path.join(tempRoot, 'orgs.csv');
    fs.writeFileSync(orgMapping, 'firebase_uid,org_external_id,org_name\nfb_alice,acme,Acme\n');

    const roleMapping = path.join(tempRoot, 'roles.csv');
    fs.writeFileSync(roleMapping, 'firebase_uid,role_slug\nfb_alice,admin\n');

    const pkgDir = path.join(tempRoot, 'pkg');
    const stats = await exportFirebasePackage({
      input: inputJson,
      outputDir: pkgDir,
      nameSplitStrategy: 'first-space',
      orgMapping,
      roleMapping,
      quiet: true,
    });

    expect(stats.totalUsers).toBe(1);
    expect(stats.skippedUsers).toBe(2);
    expect(stats.totalOrgs).toBe(1);
    expect(stats.totalMemberships).toBe(1);
    expect(stats.roleDefinitions).toBe(1);
    expect(stats.userRoleAssignments).toBe(1);

    const validation = await validateMigrationPackage(pkgDir);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.provider).toBe('firebase');

    const users = await readCsv(path.join(pkgDir, 'users.csv'));
    expect(users).toMatchObject([
      {
        email: 'alice@acme.com',
        first_name: 'Alice',
        last_name: 'Builder',
        external_id: 'fb_alice',
        org_external_id: 'acme',
        role_slugs: 'admin',
      },
    ]);

    const skipped = readJsonl(path.join(pkgDir, 'skipped_users.jsonl'));
    expect(skipped.map((s) => s.reason).sort()).toEqual(['disabled_user', 'no_email']);
  });

  it('warns when scrypt parameters are missing for users with passwords', async () => {
    const inputJson = path.join(tempRoot, 'firebase.json');
    fs.writeFileSync(
      inputJson,
      JSON.stringify({
        users: [
          {
            localId: 'fb_user',
            email: 'user@acme.com',
            passwordHash: 'aGFzaA==',
            salt: 'c2FsdA==',
          },
        ],
      }),
    );
    const pkgDir = path.join(tempRoot, 'pkg');
    const stats = await exportFirebasePackage({
      input: inputJson,
      outputDir: pkgDir,
      nameSplitStrategy: 'first-space',
      quiet: true,
    });
    expect(stats.totalUsers).toBe(1);
    expect(stats.warnings.some((w) => w.code === 'missing_scrypt_parameters')).toBe(true);
  });

  it('preserves mfaInfo, createdAt, and lastSignedInAt in user metadata', async () => {
    const inputJson = path.join(tempRoot, 'firebase.json');
    fs.writeFileSync(
      inputJson,
      JSON.stringify({
        users: [
          {
            localId: 'fb_meta',
            email: 'meta@acme.com',
            displayName: 'Meta User',
            emailVerified: true,
            createdAt: '1700000000000',
            lastSignedInAt: '1700100000000',
            mfaInfo: [
              {
                mfaEnrollmentId: 'mfa_123',
                phoneInfo: '+15551234567',
                enrolledAt: '2023-11-15T00:00:00Z',
              },
            ],
          },
        ],
      }),
    );
    const pkgDir = path.join(tempRoot, 'pkg');
    await exportFirebasePackage({
      input: inputJson,
      outputDir: pkgDir,
      nameSplitStrategy: 'first-space',
      quiet: true,
    });

    const users = await readCsv(path.join(pkgDir, 'users.csv'));
    expect(users).toHaveLength(1);
    const metadata = JSON.parse(users[0].metadata) as Record<string, unknown>;
    expect(metadata.created_at).toBe(new Date(1700000000000).toISOString());
    expect(metadata.last_signed_in_at).toBe(new Date(1700100000000).toISOString());
    expect(metadata.mfa_info).toEqual([
      {
        mfaEnrollmentId: 'mfa_123',
        phoneInfo: '+15551234567',
        enrolledAt: '2023-11-15T00:00:00Z',
      },
    ]);
  });

  it('respects include-disabled', async () => {
    const inputJson = path.join(tempRoot, 'firebase.json');
    fs.writeFileSync(
      inputJson,
      JSON.stringify({
        users: [
          { localId: 'fb_a', email: 'a@x.com', disabled: true },
          { localId: 'fb_b', email: 'b@x.com' },
        ],
      }),
    );
    const pkgDir = path.join(tempRoot, 'pkg');
    const stats = await exportFirebasePackage({
      input: inputJson,
      outputDir: pkgDir,
      nameSplitStrategy: 'first-space',
      includeDisabled: true,
      quiet: true,
    });
    expect(stats.totalUsers).toBe(2);
  });

  it('fetches Identity Platform SAML+OIDC configs when accessTokenProvider is provided', async () => {
    const inputJson = path.join(tempRoot, 'firebase.json');
    fs.writeFileSync(
      inputJson,
      JSON.stringify({ users: [{ localId: 'fb_u', email: 'u@acme.com' }] }),
    );
    const pkgDir = path.join(tempRoot, 'pkg');

    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/tenants?')) {
        return new Response(
          JSON.stringify({
            tenants: [{ name: 'projects/acme/tenants/t1', displayName: 'Tenant One' }],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/tenants/t1/inboundSamlConfigs')) {
        return new Response(
          JSON.stringify({
            inboundSamlConfigs: [
              {
                name: 'projects/acme/tenants/t1/inboundSamlConfigs/saml.okta',
                displayName: 'Tenant One Okta',
                idpConfig: {
                  idpEntityId: 'https://okta.example/exk',
                  ssoUrl: 'https://okta.example/sso',
                  idpCertificates: [{ x509Certificate: 'TENANT-CERT' }],
                },
                spConfig: {
                  spEntityId: 'sp-entity',
                  callbackUri: 'https://callback',
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/tenants/t1/oauthIdpConfigs')) {
        return new Response(
          JSON.stringify({
            oauthIdpConfigs: [
              {
                name: 'projects/acme/tenants/t1/oauthIdpConfigs/oidc.azure',
                displayName: 'Tenant One Azure',
                clientId: 'cid',
                clientSecret: 'super-secret',
                issuer: 'https://login.example/tenant',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/inboundSamlConfigs')) {
        return new Response(
          JSON.stringify({
            inboundSamlConfigs: [
              {
                name: 'projects/acme/inboundSamlConfigs/saml.project',
                displayName: 'Project SAML',
                idpConfig: {
                  idpEntityId: 'https://proj-idp/exk',
                  ssoUrl: 'https://proj-idp/sso',
                  idpCertificates: [{ x509Certificate: 'PROJ-CERT' }],
                },
                spConfig: { spEntityId: 'sp-proj', callbackUri: 'https://proj-callback' },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/oauthIdpConfigs')) {
        return new Response(JSON.stringify({ oauthIdpConfigs: [] }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const stats = await exportFirebasePackage({
      input: inputJson,
      outputDir: pkgDir,
      nameSplitStrategy: 'first-space',
      quiet: true,
      gcpProjectId: 'acme',
      accessTokenProvider: { getAccessToken: async () => 'token' },
      identityPlatformFetchImpl: fetchImpl as typeof fetch,
    });

    expect(stats.samlConnections).toBe(2);
    expect(stats.oidcConnections).toBe(1);
    expect(stats.warnings.some((w) => w.code === 'secrets_redacted')).toBe(true);

    const samlRows = await readCsv(path.join(pkgDir, 'sso', 'saml_connections.csv'));
    expect(samlRows).toHaveLength(2);
    const tenantRow = samlRows.find((r) => r.externalId === 'firebase:t1:saml.okta');
    expect(tenantRow).toMatchObject({
      organizationExternalId: 't1',
      organizationName: 'Tenant One',
      idpEntityId: 'https://okta.example/exk',
    });

    const oidcRows = await readCsv(path.join(pkgDir, 'sso', 'oidc_connections.csv'));
    expect(oidcRows).toHaveLength(1);
    expect(oidcRows[0].clientSecret).toBe('');
    expect(oidcRows[0].discoveryEndpoint).toBe(
      'https://login.example/tenant/.well-known/openid-configuration',
    );

    const validation = await validateMigrationPackage(pkgDir);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.entitiesExported.samlConnections).toBe(2);
    expect(validation.manifest?.entitiesExported.oidcConnections).toBe(1);
    expect(validation.manifest?.entitiesRequested).toContain('sso');
    expect(validation.manifest?.secretRedaction?.mode).toBe('redacted');

    const handoff = fs.readFileSync(path.join(pkgDir, 'sso', 'handoff_notes.md'), 'utf-8');
    expect(handoff).toContain('Identity Platform admin API returned 3 provider config(s)');
    expect(handoff).toContain('OIDC client secrets are redacted');
  });

  it('respects skipTenantSsoScopes (project-only)', async () => {
    const inputJson = path.join(tempRoot, 'firebase.json');
    fs.writeFileSync(inputJson, JSON.stringify({ users: [{ localId: 'u', email: 'u@x.com' }] }));
    const pkgDir = path.join(tempRoot, 'pkg');

    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/tenants')) {
        throw new Error('tenants endpoint should not be called when skipTenantSsoScopes=true');
      }
      if (url.includes('/inboundSamlConfigs')) {
        return new Response(JSON.stringify({ inboundSamlConfigs: [] }), { status: 200 });
      }
      if (url.includes('/oauthIdpConfigs')) {
        return new Response(JSON.stringify({ oauthIdpConfigs: [] }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const stats = await exportFirebasePackage({
      input: inputJson,
      outputDir: pkgDir,
      nameSplitStrategy: 'first-space',
      quiet: true,
      gcpProjectId: 'acme',
      accessTokenProvider: { getAccessToken: async () => 'token' },
      identityPlatformFetchImpl: fetchImpl as typeof fetch,
      skipTenantSsoScopes: true,
    });

    expect(stats.samlConnections).toBe(0);
    expect(stats.oidcConnections).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('records a warning when an Identity Platform call fails', async () => {
    const inputJson = path.join(tempRoot, 'firebase.json');
    fs.writeFileSync(inputJson, JSON.stringify({ users: [{ localId: 'u', email: 'u@x.com' }] }));
    const pkgDir = path.join(tempRoot, 'pkg');

    const fetchImpl = jest.fn(async () => new Response('permission denied', { status: 403 }));

    const stats = await exportFirebasePackage({
      input: inputJson,
      outputDir: pkgDir,
      nameSplitStrategy: 'first-space',
      quiet: true,
      gcpProjectId: 'acme',
      accessTokenProvider: { getAccessToken: async () => 'token' },
      identityPlatformFetchImpl: fetchImpl as typeof fetch,
      skipTenantSsoScopes: true,
    });

    expect(stats.warnings.filter((w) => w.code === 'sso_fetch_failed').length).toBeGreaterThan(0);
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

function readJsonl(filePath: string): Array<Record<string, unknown>> {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
}
