import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamCSV } from '../../../shared/csv-utils';
import { validateMigrationPackage } from '../../../package/validator';
import { exportCognitoPackage } from '../package-exporter';
import type { CognitoProvider, CognitoUser } from '../workos-csv';

describe('exportCognitoPackage', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-cognito-pkg-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const acmeUser: CognitoUser = {
    userPoolId: 'us-east-1_acme',
    username: 'cognito-uuid-1',
    attributes: {
      sub: 'cognito-uuid-1',
      email: 'alice@acme.com',
      email_verified: 'true',
      given_name: 'Alice',
      family_name: 'Builder',
    },
    userStatus: 'CONFIRMED',
    enabled: true,
  };

  const externalUser: CognitoUser = {
    userPoolId: 'us-east-1_acme',
    username: 'cognito-uuid-2',
    attributes: {
      sub: 'cognito-uuid-2',
      email: 'jit@acme.com',
    },
    userStatus: 'EXTERNAL_PROVIDER',
    enabled: true,
  };

  const samlProvider: CognitoProvider = {
    userPoolId: 'us-east-1_acme',
    providerName: 'AcmeOkta',
    providerType: 'SAML',
    region: 'us-east-1',
    providerDetails: {
      EntityId: 'https://idp.example.com/entity',
      SSORedirectBindingURI: 'https://idp.example.com/sso',
    },
    attributeMapping: {
      email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
      given_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
      family_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
      'custom:department': 'department',
    },
    idpIdentifiers: [],
  };

  const oidcProvider: CognitoProvider = {
    userPoolId: 'us-east-1_acme',
    providerName: 'AcmeAzure',
    providerType: 'OIDC',
    region: 'us-east-1',
    providerDetails: {
      client_id: 'azure_client',
      oidc_issuer: 'https://login.microsoftonline.com/tenant',
    },
    attributeMapping: {
      email: 'email',
    },
    idpIdentifiers: [],
  };

  it('writes a valid package with users, orgs, memberships, and skips federated users by default', async () => {
    const result = await exportCognitoPackage(
      { users: [acmeUser, externalUser], providers: [] },
      { outputDir: tempRoot, quiet: true },
    );

    expect(result.stats.totalUsers).toBe(1);
    expect(result.stats.totalOrgs).toBe(1);
    expect(result.stats.totalMemberships).toBe(1);
    expect(result.stats.skippedUsers).toBe(1);

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.provider).toBe('cognito');
    expect(validation.manifest?.entitiesExported).toMatchObject({
      users: 1,
      organizations: 1,
      memberships: 1,
      uploadUsers: 1,
      uploadOrganizations: 1,
      uploadMemberships: 1,
      skippedUsers: 1,
    });

    const users = await readCsv(path.join(tempRoot, 'users.csv'));
    expect(users).toMatchObject([
      {
        email: 'alice@acme.com',
        external_id: 'cognito-uuid-1',
        org_external_id: 'us-east-1_acme',
        first_name: 'Alice',
        last_name: 'Builder',
      },
    ]);

    const orgs = await readCsv(path.join(tempRoot, 'organizations.csv'));
    expect(orgs).toMatchObject([{ org_external_id: 'us-east-1_acme', org_name: 'us-east-1_acme' }]);

    const upload = await readCsv(path.join(tempRoot, 'workos_upload', 'users.csv'));
    expect(upload).toMatchObject([
      {
        user_id: 'cognito-uuid-1',
        email: 'alice@acme.com',
        password_hash: '',
      },
    ]);

    const skipped = readJsonl(path.join(tempRoot, 'skipped_users.jsonl'));
    expect(skipped).toMatchObject([{ username: 'cognito-uuid-2', reason: 'federated_user' }]);
  });

  it('writes SAML/OIDC handoff files and proxy routes when sso entity is requested', async () => {
    const result = await exportCognitoPackage(
      { providers: [samlProvider, oidcProvider], users: [] },
      {
        outputDir: tempRoot,
        entities: ['sso'],
        quiet: true,
      },
    );

    expect(result.stats.samlConnections).toBe(1);
    expect(result.stats.oidcConnections).toBe(1);
    expect(result.stats.proxyRoutes).toBe(2);

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.valid).toBe(true);

    const samlRows = await readCsv(path.join(tempRoot, 'sso', 'saml_connections.csv'));
    expect(samlRows).toMatchObject([
      {
        organizationName: 'AcmeOkta',
        organizationExternalId: 'AcmeOkta',
        idpEntityId: 'https://idp.example.com/entity',
        idpUrl: 'https://idp.example.com/sso',
      },
    ]);

    const oidcRows = await readCsv(path.join(tempRoot, 'sso', 'oidc_connections.csv'));
    expect(oidcRows).toMatchObject([
      {
        organizationExternalId: 'AcmeAzure',
        clientId: 'azure_client',
      },
    ]);

    const customAttr = await readCsv(path.join(tempRoot, 'sso', 'custom_attribute_mappings.csv'));
    expect(
      customAttr.some(
        (row) => row.userPoolAttribute === 'custom:department' && row.idpClaim === 'department',
      ),
    ).toBe(true);
  });

  it('redacts OIDC client secrets from handoff CSV, raw dump, and manifest attestation', async () => {
    const oidcWithSecret: CognitoProvider = {
      ...oidcProvider,
      providerName: 'AcmeAzureSecret',
      providerDetails: {
        client_id: 'azure_client',
        client_secret: 'live-enterprise-oidc-secret',
        oidc_issuer: 'https://login.microsoftonline.com/tenant',
      },
    };

    const result = await exportCognitoPackage(
      { providers: [oidcWithSecret], users: [] },
      { outputDir: tempRoot, entities: ['sso'], quiet: true },
    );

    expect(result.stats.redactedSecretFields).toEqual(['client_secret']);

    const oidcRows = await readCsv(path.join(tempRoot, 'sso', 'oidc_connections.csv'));
    expect(oidcRows).toHaveLength(1);
    expect(oidcRows[0].clientId).toBe('azure_client');
    expect(oidcRows[0].clientSecret).toBe('');

    const rawRaw = fs.readFileSync(path.join(tempRoot, 'raw', 'cognito-providers.jsonl'), 'utf-8');
    expect(rawRaw).not.toContain('live-enterprise-oidc-secret');
    const rawProviders = readJsonl(path.join(tempRoot, 'raw', 'cognito-providers.jsonl'));
    expect(
      (rawProviders[0].providerDetails as Record<string, string>).client_secret,
    ).toBe('[REDACTED]');

    const validation = await validateMigrationPackage(tempRoot);
    expect(validation.manifest?.secretsRedacted).toBe(true);
    expect(validation.manifest?.secretRedaction).toMatchObject({
      mode: 'redacted',
      redacted: true,
      redactedFields: ['client_secret'],
    });

    // The live secret must not appear anywhere in the produced package.
    const allFiles = listFilesRecursive(tempRoot);
    for (const file of allFiles) {
      expect(fs.readFileSync(file, 'utf-8')).not.toContain('live-enterprise-oidc-secret');
    }
  });

  it('warns and writes header-only memberships when org strategy is connection', async () => {
    const result = await exportCognitoPackage(
      { providers: [samlProvider], users: [acmeUser] },
      {
        outputDir: tempRoot,
        orgStrategy: 'connection',
        quiet: true,
      },
    );

    expect(result.stats.totalOrgs).toBe(1);
    // memberships rows depend on matching pool→org row; with connection strategy there is none
    expect(result.stats.totalMemberships).toBe(0);

    const warnings = readJsonl(path.join(tempRoot, 'warnings.jsonl'));
    expect(warnings.some((w) => w.code === 'connection_strategy_no_memberships')).toBe(true);
  });
});

async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  for await (const row of streamCSV(filePath)) {
    rows.push(row as Record<string, string>);
  }
  return rows;
}

function listFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(full));
    else files.push(full);
  }
  return files;
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
}
