import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CUSTOM_ATTR_HEADERS,
  OIDC_HEADERS,
  PROXY_ROUTE_HEADERS,
  SAML_HEADERS,
  createCustomAttributeMappingRow,
  createOidcConnectionRow,
  createProxyRouteRow,
  createSamlConnectionRow,
  missingDomainsWarning,
  multiOrgConnectionConsolidationWarning,
  redactedSecretsWarning,
  rowsToCsv,
  unsupportedConnectionProtocolWarning,
  writeCustomAttributeMappingsCsv,
  writeOidcConnectionsCsv,
  writeProxyRoutesCsv,
  writeSamlConnectionsCsv,
} from '../handoff';

describe('SSO handoff row builders', () => {
  it('creates SAML rows with every canonical header and blank defaults', () => {
    const row = createSamlConnectionRow({
      organizationName: 'Acme',
      organizationExternalId: 'org_acme',
      idpEntityId: 'https://idp.example.com/entity',
      importedId: 'auth0:con_123',
    });

    for (const header of SAML_HEADERS) {
      expect(row).toHaveProperty(header);
      expect(typeof row[header]).toBe('string');
    }
    expect(row.organizationName).toBe('Acme');
    expect(row.organizationExternalId).toBe('org_acme');
    expect(row.idpEntityId).toBe('https://idp.example.com/entity');
    expect(row.organizationId).toBe('');
    expect(row.importedId).toBe('auth0:con_123');
  });

  it('creates OIDC rows with every canonical header and blank defaults', () => {
    const row = createOidcConnectionRow({
      clientId: 'client_123',
      discoveryEndpoint: 'https://idp.example.com/.well-known/openid-configuration',
    });

    for (const header of OIDC_HEADERS) {
      expect(row).toHaveProperty(header);
      expect(typeof row[header]).toBe('string');
    }
    expect(row.clientId).toBe('client_123');
    expect(row.clientSecret).toBe('');
  });

  it('creates custom attribute mapping rows with every canonical header', () => {
    const row = createCustomAttributeMappingRow({
      importedId: 'pool:okta',
      organizationExternalId: 'okta',
      providerType: 'SAML',
      userPoolAttribute: 'custom:department',
      idpClaim: 'department',
    });

    expect(Object.keys(row)).toEqual([...CUSTOM_ATTR_HEADERS]);
    expect(row.idpClaim).toBe('department');
  });

  it('creates proxy route rows with every canonical header', () => {
    const row = createProxyRouteRow({
      importedId: 'auth0:con_123',
      provider: 'auth0',
      protocol: 'saml',
      sourceAcsUrl: 'https://tenant.auth0.com/login/callback',
      customAcsUrl: 'https://sso.example.com/acs',
      cutoverState: 'legacy',
    });

    expect(Object.keys(row)).toEqual([...PROXY_ROUTE_HEADERS]);
    expect(row.sourceAcsUrl).toBe('https://tenant.auth0.com/login/callback');
    expect(row.workosConnectionId).toBe('');
  });
});

describe('SSO handoff CSV utilities', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-sso-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('escapes commas, quotes, and newlines in CSV output', () => {
    const csv = rowsToCsv(
      ['name', 'notes'],
      [
        {
          name: 'Acme, Inc.',
          notes: 'He said "hello"\nthen left',
        },
      ],
    );

    expect(csv).toBe('name,notes\n"Acme, Inc.","He said ""hello""\nthen left"\n');
  });

  it('writes SAML, OIDC, custom attribute, and proxy route CSV files', async () => {
    const samlPath = path.join(tempRoot, 'nested', 'saml.csv');
    const oidcPath = path.join(tempRoot, 'oidc.csv');
    const customPath = path.join(tempRoot, 'custom.csv');
    const proxyPath = path.join(tempRoot, 'proxy.csv');

    await expect(
      writeSamlConnectionsCsv(samlPath, [{ organizationName: 'Acme', importedId: 'saml-1' }]),
    ).resolves.toBe(1);
    await expect(
      writeOidcConnectionsCsv(oidcPath, [{ clientId: 'client_123', importedId: 'oidc-1' }]),
    ).resolves.toBe(1);
    await expect(
      writeCustomAttributeMappingsCsv(customPath, [
        { importedId: 'saml-1', userPoolAttribute: 'email', idpClaim: 'mail' },
      ]),
    ).resolves.toBe(1);
    await expect(
      writeProxyRoutesCsv(proxyPath, [{ importedId: 'saml-1', cutoverState: 'manual' }]),
    ).resolves.toBe(1);

    expect(fs.readFileSync(samlPath, 'utf-8')).toContain([...SAML_HEADERS].join(','));
    expect(fs.readFileSync(oidcPath, 'utf-8')).toContain([...OIDC_HEADERS].join(','));
    expect(fs.readFileSync(customPath, 'utf-8')).toContain([...CUSTOM_ATTR_HEADERS].join(','));
    expect(fs.readFileSync(proxyPath, 'utf-8')).toContain([...PROXY_ROUTE_HEADERS].join(','));
  });
});

describe('SSO handoff warning helpers', () => {
  it('builds structured warnings for common handoff conditions', () => {
    expect(
      missingDomainsWarning({
        provider: 'auth0',
        protocol: 'saml',
        importedId: 'auth0:con_123',
        organizationExternalId: 'org_acme',
      }),
    ).toMatchObject({
      code: 'missing_domains',
      provider: 'auth0',
      protocol: 'saml',
      importedId: 'auth0:con_123',
      organizationExternalId: 'org_acme',
    });

    expect(
      redactedSecretsWarning({
        provider: 'auth0',
        protocol: 'oidc',
        fields: ['clientSecret'],
        file: 'raw/auth0-connections.jsonl',
      }),
    ).toMatchObject({
      code: 'secrets_redacted',
      details: {
        fields: ['clientSecret'],
        file: 'raw/auth0-connections.jsonl',
      },
    });

    expect(
      multiOrgConnectionConsolidationWarning({
        provider: 'auth0',
        protocol: 'saml',
        importedId: 'auth0:con_123',
        organizationExternalId: 'auth0:con_123',
        sourceOrganizationIds: ['org_a', 'org_b'],
        domains: ['a.example.com', 'b.example.com'],
      }),
    ).toMatchObject({
      code: 'multi_org_connection_consolidated',
      details: {
        sourceOrganizationIds: ['org_a', 'org_b'],
        domains: ['a.example.com', 'b.example.com'],
      },
    });

    expect(
      unsupportedConnectionProtocolWarning({
        provider: 'auth0',
        protocol: 'oauth2',
        strategy: 'google-oauth2',
      }),
    ).toMatchObject({
      code: 'unsupported_connection_protocol',
      details: {
        strategy: 'google-oauth2',
      },
    });
  });
});
