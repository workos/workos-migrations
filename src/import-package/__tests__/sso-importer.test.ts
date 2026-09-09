import fs from 'node:fs';
import { jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import type { WorkOS } from '@workos-inc/node';
import { createMigrationPackage } from '../../package/writer';
import { MIGRATION_PACKAGE_CSV_HEADERS } from '../../package/manifest';
import {
  SSO_RESULTS_FILENAME,
  collectCustomAttributeNames,
  importSsoConnections,
  loadSsoSecrets,
  readCsvRows,
} from '../sso-importer';

interface FakeOrg {
  id: string;
  name: string;
  externalId?: string;
  domains: Array<{ domain: string; state: string }>;
}

function createFakeWorkOS(
  options: {
    orgs?: FakeOrg[];
    postImpl?: (body: any) => Promise<any>;
    /** Called before each outbound call, so tests can observe pacing. */
    trace?: (label: string) => void;
  } = {},
) {
  const orgs = new Map<string, FakeOrg>((options.orgs ?? []).map((org) => [org.id, org]));
  let connectionCounter = 0;

  const notFound = () => Object.assign(new Error('Not found'), { status: 404 });

  const post = jest.fn(async (_path: string, body: any) => {
    options.trace?.('post');
    if (options.postImpl) return options.postImpl(body);
    connectionCounter += 1;
    const id = `conn_${connectionCounter}`;
    const isSaml = Boolean(body.saml_options);
    return {
      data: {
        object: 'connection',
        id,
        organization_id: body.organization_id,
        connection_type: body.connection_type ?? (isSaml ? 'GenericSAML' : 'GenericOIDC'),
        name: body.name,
        state: 'validating',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        external_id: body.external_id ?? null,
        callback_endpoint: isSaml
          ? `https://api.workos.com/sso/saml/acs/${id}`
          : `https://api.workos.com/sso/oidc/${id}/callback`,
        saml_options: isSaml
          ? {
              acs_url: body.saml_options.acs_url ?? `https://api.workos.com/sso/saml/acs/${id}`,
              sp_entity_id: body.saml_options.sp_entity_id ?? `https://api.workos.com/${id}`,
            }
          : null,
        oidc_options: isSaml
          ? null
          : {
              redirect_uri:
                body.oidc_options.redirect_uri ?? `https://api.workos.com/sso/oidc/${id}/callback`,
            },
      },
    };
  });

  const organizations = {
    getOrganization: jest.fn(async (id: string) => {
      options.trace?.('getOrganization');
      const org = orgs.get(id);
      if (!org) throw notFound();
      return { ...org, object: 'organization' };
    }),
    getOrganizationByExternalId: jest.fn(async (externalId: string) => {
      options.trace?.('getOrganizationByExternalId');
      const org = [...orgs.values()].find((candidate) => candidate.externalId === externalId);
      if (!org) throw notFound();
      return { ...org, object: 'organization' };
    }),
    createOrganization: jest.fn(
      async (input: {
        name: string;
        externalId?: string;
        domainData?: Array<{ domain: string; state: string }>;
      }) => {
        options.trace?.('createOrganization');
        const id = `org_${orgs.size + 1}`;
        const org: FakeOrg = {
          id,
          name: input.name,
          externalId: input.externalId,
          domains: (input.domainData ?? []).map((d) => ({ ...d })),
        };
        orgs.set(id, org);
        return { ...org, object: 'organization' };
      },
    ),
    updateOrganization: jest.fn(
      async (input: {
        organization: string;
        domainData?: Array<{ domain: string; state: string }>;
      }) => {
        options.trace?.('updateOrganization');
        const org = orgs.get(input.organization);
        if (!org) throw notFound();
        if (input.domainData) org.domains = input.domainData.map((d) => ({ ...d }));
        return { ...org, object: 'organization' };
      },
    ),
  };

  const workos = { post, organizations } as unknown as WorkOS;
  return { workos, post, organizations, orgs };
}

const CERT = 'MIICXjCCAcegAwIBAgIBADANBgkqhkiG9w0BAQ0FADCBhzELMAkGA1UEBhMCVVMx';

describe('importSsoConnections', () => {
  let tempRoot: string;
  let pkgDir: string;

  beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-sso-import-test-'));
    pkgDir = path.join(tempRoot, 'pkg');
    await createMigrationPackage({
      provider: 'auth0',
      rootDir: pkgDir,
      entitiesRequested: ['sso'],
      entitiesExported: {
        samlConnections: 2,
        oidcConnections: 2,
        customAttributeMappings: 1,
        proxyRoutes: 2,
      },
      warnings: [],
    });
    writeRows(
      path.join(pkgDir, 'sso/saml_connections.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.samlConnections,
      [
        {
          name: 'Acme Okta',
          organizationName: 'Acme',
          organizationExternalId: 'acme',
          domains: 'acme.com;app.acme.com',
          idpEntityId: 'https://idp.acme.com/entity',
          idpUrl: 'https://idp.acme.com/sso',
          x509Cert: CERT,
          customAcsUrl: 'https://legacy.example.com/acs/acme',
          emailAttribute: 'mail',
          externalId: 'acme-okta',
          connectionType: 'OktaSAML',
        },
        {
          name: 'Globex',
          organizationName: 'Globex',
          organizationId: 'org_existing',
          domains: 'globex.com,new.globex.com',
          idpMetadataUrl: 'https://idp.globex.com/metadata',
          externalId: 'globex-saml',
        },
      ],
    );
    writeRows(
      path.join(pkgDir, 'sso/oidc_connections.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.oidcConnections,
      [
        {
          name: 'Initech Entra',
          organizationName: 'Initech',
          organizationExternalId: 'initech',
          clientId: 'client_initech',
          clientSecret: '',
          discoveryEndpoint: 'https://login.microsoftonline.com/tenant/v2.0',
          externalId: 'initech-oidc',
        },
        {
          name: 'Umbrella',
          organizationName: 'Umbrella',
          organizationExternalId: 'umbrella',
          clientId: 'client_umbrella',
          clientSecret: '',
          discoveryEndpoint: 'https://accounts.google.com',
          externalId: 'umbrella-oidc',
        },
      ],
    );
    writeRows(
      path.join(pkgDir, 'sso/custom_attribute_mappings.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.customAttributeMappings,
      [
        {
          externalId: 'acme-okta',
          organizationExternalId: 'acme',
          providerType: 'SAML',
          userPoolAttribute: 'department',
          idpClaim: 'dept',
        },
      ],
    );
    writeRows(
      path.join(pkgDir, 'sso/proxy_routes.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.proxyRoutes,
      [
        {
          externalId: 'acme-okta',
          organizationExternalId: 'acme',
          provider: 'auth0',
          protocol: 'saml',
          sourceAcsUrl: 'https://tenant.auth0.com/login/callback?connection=acme-okta',
          cutoverState: 'legacy',
        },
        {
          externalId: 'initech-oidc',
          organizationExternalId: 'initech',
          provider: 'auth0',
          protocol: 'oidc',
          sourceRedirectUri: 'https://tenant.auth0.com/login/callback',
          cutoverState: 'legacy',
        },
      ],
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('plans in dry-run mode without touching WorkOS and reports skips', async () => {
    const summary = await importSsoConnections({ packageDir: pkgDir, dryRun: true, quiet: true });

    expect(summary.status).toBe('planned');
    expect(summary.total).toBe(4);
    expect(summary.succeeded).toBe(2);
    expect(summary.skipped).toBe(2);
    expect(summary.customAttributeNames).toEqual(['department']);
    const byId = new Map(summary.results.map((result) => [result.externalId, result]));
    expect(byId.get('acme-okta')?.outcome).toBe('planned');
    expect(byId.get('initech-oidc')).toMatchObject({
      outcome: 'skipped',
      code: 'client_secret_missing',
    });
    expect(fs.existsSync(path.join(pkgDir, SSO_RESULTS_FILENAME))).toBe(false);
  });

  it('creates connections, organizations, and verified domains, then writes results and proxy routes', async () => {
    const fake = createFakeWorkOS({
      orgs: [
        {
          id: 'org_existing',
          name: 'Globex',
          externalId: 'globex',
          domains: [{ domain: 'globex.com', state: 'verified' }],
        },
      ],
    });
    const errorsPath = path.join(pkgDir, 'errors.jsonl');
    const secrets = new Map([['umbrella-oidc', 'umbrella-secret']]);

    const summary = await importSsoConnections({
      packageDir: pkgDir,
      workos: fake.workos,
      quiet: true,
      rateLimit: 1000,
      secrets,
      errorsPath,
    });

    expect(summary.status).toBe('imported');
    expect(summary).toMatchObject({
      total: 4,
      succeeded: 3,
      failed: 0,
      skipped: 1,
      apiDisabled: false,
    });

    // Acme: org created with verified domains, custom attributes + type sent.
    expect(fake.organizations.createOrganization).toHaveBeenCalledWith({
      name: 'Acme',
      externalId: 'acme',
      domainData: [
        { domain: 'acme.com', state: 'verified' },
        { domain: 'app.acme.com', state: 'verified' },
      ],
    });
    const acmeCall = fake.post.mock.calls.find(([, body]) => body.external_id === 'acme-okta');
    expect(acmeCall?.[1]).toMatchObject({
      connection_type: 'OktaSAML',
      saml_options: {
        idp_sso_url: 'https://idp.acme.com/sso',
        acs_url: 'https://legacy.example.com/acs/acme',
      },
      attribute_maps: {
        standard_attributes: { email: 'mail' },
        custom_attributes: { department: 'dept' },
      },
    });
    expect(acmeCall?.[1].saml_options.idp_signing_certs[0]).toContain(
      '-----BEGIN CERTIFICATE-----',
    );

    // Globex: existing org gets the missing domain added as verified, existing state preserved.
    expect(fake.organizations.updateOrganization).toHaveBeenCalledWith({
      organization: 'org_existing',
      domainData: [
        { domain: 'globex.com', state: 'verified' },
        { domain: 'new.globex.com', state: 'verified' },
      ],
    });

    // Umbrella: secret came from the sidecar map.
    const umbrellaCall = fake.post.mock.calls.find(
      ([, body]) => body.external_id === 'umbrella-oidc',
    );
    expect(umbrellaCall?.[1].oidc_options).toMatchObject({
      client_secret: 'umbrella-secret',
      discovery_endpoint: 'https://accounts.google.com/.well-known/openid-configuration',
    });

    // Initech: skipped, recorded in errors.
    const errors = fs
      .readFileSync(errorsPath, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(errors).toEqual([
      expect.objectContaining({
        entity: 'sso_connection',
        externalId: 'initech-oidc',
        outcome: 'skipped',
        code: 'client_secret_missing',
      }),
    ]);

    // Results CSV.
    const results = await readCsvRows(path.join(pkgDir, SSO_RESULTS_FILENAME));
    expect(results).toHaveLength(4);
    const acmeResult = results.find((row) => row.externalId === 'acme-okta');
    expect(acmeResult).toMatchObject({
      outcome: 'created',
      workosOrganizationId: 'org_2',
      workosConnectionId: 'conn_1',
      connectionType: 'OktaSAML',
      state: 'validating',
      callbackEndpoint: 'https://api.workos.com/sso/saml/acs/conn_1',
      acsUrl: 'https://legacy.example.com/acs/acme',
      domainsAdded: 'acme.com;app.acme.com',
    });

    // Proxy routes updated for the created connection only.
    const proxyRoutes = await readCsvRows(path.join(pkgDir, 'sso/proxy_routes.csv'));
    expect(proxyRoutes.find((row) => row.externalId === 'acme-okta')).toMatchObject({
      workosConnectionId: 'conn_1',
      workosAcsUrl: 'https://api.workos.com/sso/saml/acs/conn_1',
      cutoverState: 'legacy',
    });
    expect(proxyRoutes.find((row) => row.externalId === 'initech-oidc')).toMatchObject({
      workosConnectionId: '',
      workosAcsUrl: '',
    });
    expect(summary.proxyRoutesUpdated).toBe(1);
  });

  it('falls back to handoff when the Connections API is disabled', async () => {
    const fake = createFakeWorkOS({
      postImpl: async () => {
        throw Object.assign(
          new Error(
            'This endpoint is part of the Connections API migration capabilities, which are not enabled for your environment.',
          ),
          { status: 404 },
        );
      },
    });

    const summary = await importSsoConnections({
      packageDir: pkgDir,
      workos: fake.workos,
      quiet: true,
      rateLimit: 1000,
    });

    expect(summary.status).toBe('handoff');
    expect(summary.apiDisabled).toBe(true);
    expect(fake.post).toHaveBeenCalledTimes(1);
    expect(summary.notAttempted).toBe(2);
    expect(summary.skipped).toBe(2);
    expect(summary.notes.join(' ')).toContain('connections-api-migrations-capabilities-api');
  });

  it('records per-row failures with a custom attribute hint and honors customAttributes=skip', async () => {
    const existingOrg = {
      id: 'org_existing',
      name: 'Globex',
      externalId: 'globex',
      domains: [{ domain: 'globex.com', state: 'verified' }],
    };
    const failing = createFakeWorkOS({
      orgs: [existingOrg],
      postImpl: async (body) => {
        if (body.attribute_maps?.custom_attributes) {
          throw Object.assign(new Error('Unknown custom attribute "department"'), {
            status: 400,
            code: 'custom_attribute_not_found',
          });
        }
        return {
          data: {
            object: 'connection',
            id: 'conn_ok',
            state: 'validating',
            connection_type: 'GenericSAML',
          },
        };
      },
    });

    const failed = await importSsoConnections({
      packageDir: pkgDir,
      workos: failing.workos,
      quiet: true,
      rateLimit: 1000,
    });
    const acme = failed.results.find((result) => result.externalId === 'acme-okta');
    expect(acme).toMatchObject({ outcome: 'failed', code: 'custom_attribute_not_found' });
    expect(acme?.error).toContain('--sso-custom-attributes skip');
    expect(failed.failed).toBe(1);

    const skipping = createFakeWorkOS({ orgs: [existingOrg] });
    const skipped = await importSsoConnections({
      packageDir: pkgDir,
      workos: skipping.workos,
      quiet: true,
      rateLimit: 1000,
      customAttributes: 'skip',
    });
    const acmeCall = skipping.post.mock.calls.find(([, body]) => body.external_id === 'acme-okta');
    expect(acmeCall?.[1].attribute_maps.custom_attributes).toBeUndefined();
    expect(skipped.notes.join(' ')).toContain('department');
  });

  it('reports connections returned by externalId idempotency as existing and hints on one-connection-per-org', async () => {
    const fake = createFakeWorkOS({
      orgs: [
        {
          id: 'org_existing',
          name: 'Globex',
          externalId: 'globex',
          domains: [{ domain: 'globex.com', state: 'verified' }],
        },
      ],
      postImpl: async (body) => {
        if (body.external_id === 'globex-saml') {
          throw Object.assign(new Error("Organization 'org_existing' already has a Connection."), {
            status: 400,
            code: 'connection_already_exists_for_organization',
          });
        }
        return {
          data: {
            object: 'connection',
            id: 'conn_old',
            organization_id: body.organization_id,
            connection_type: 'GenericSAML',
            name: body.name,
            state: 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            external_id: body.external_id,
            callback_endpoint: 'https://api.workos.com/sso/saml/acs/conn_old',
          },
        };
      },
    });

    const summary = await importSsoConnections({
      packageDir: pkgDir,
      workos: fake.workos,
      quiet: true,
      rateLimit: 1000,
      secrets: new Map([['umbrella-oidc', 'x']]),
    });

    const acme = summary.results.find((result) => result.externalId === 'acme-okta');
    expect(acme).toMatchObject({ outcome: 'existing', connectionId: 'conn_old' });
    expect(summary.succeeded).toBe(2);
    expect(summary.notes.join(' ')).toContain('already existed');

    const globex = summary.results.find((result) => result.externalId === 'globex-saml');
    expect(globex).toMatchObject({
      outcome: 'failed',
      code: 'connection_already_exists_for_organization',
    });
    expect(globex?.error).toContain('one SSO connection per organization');

    // Existing connections still feed the proxy route write-back.
    const proxyRoutes = await readCsvRows(path.join(pkgDir, 'sso/proxy_routes.csv'));
    expect(proxyRoutes.find((row) => row.externalId === 'acme-okta')?.workosConnectionId).toBe(
      'conn_old',
    );
  });

  it('skips duplicate externalIds, honors domain modes, and refuses to rewrite non-standard domain states', async () => {
    // Duplicate the acme row under another org and give the existing org a failed domain.
    const samlPath = path.join(pkgDir, 'sso/saml_connections.csv');
    const rows = await readCsvRows(samlPath);
    rows.push({
      ...rows[0],
      name: 'Acme dup',
      organizationName: 'Acme Two',
      organizationExternalId: 'acme-two',
      domains: 'acme-two.com',
    });
    writeRows(samlPath, MIGRATION_PACKAGE_CSV_HEADERS.samlConnections, rows);

    const fake = createFakeWorkOS({
      orgs: [
        {
          id: 'org_existing',
          name: 'Globex',
          externalId: 'globex',
          domains: [
            { domain: 'globex.com', state: 'verified' },
            { domain: 'old.globex.com', state: 'failed' },
          ],
        },
      ],
    });

    const pending = await importSsoConnections({
      packageDir: pkgDir,
      workos: fake.workos,
      quiet: true,
      rateLimit: 1000,
      secrets: new Map([['umbrella-oidc', 'x']]),
      domains: 'pending',
    });

    const dup = pending.results.find((result) => result.name === 'Acme dup');
    expect(dup).toMatchObject({ outcome: 'skipped', code: 'duplicate_external_id' });
    expect(
      fake.post.mock.calls.filter(([, body]) => body.external_id === 'acme-okta'),
    ).toHaveLength(1);

    // New org created with pending domains.
    expect(fake.organizations.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'acme',
        domainData: [
          { domain: 'acme.com', state: 'pending' },
          { domain: 'app.acme.com', state: 'pending' },
        ],
      }),
    );

    // Existing org with a failed domain is left alone and no connection is created.
    expect(fake.organizations.updateOrganization).not.toHaveBeenCalled();
    const globex = pending.results.find((result) => result.externalId === 'globex-saml');
    expect(globex?.outcome).toBe('failed');
    expect(globex?.error).toContain('old.globex.com=failed');
    expect(fake.post.mock.calls.some(([, body]) => body.external_id === 'globex-saml')).toBe(false);

    // domains=skip never sends domain data.
    const skipping = createFakeWorkOS();
    await importSsoConnections({
      packageDir: pkgDir,
      workos: skipping.workos,
      quiet: true,
      rateLimit: 1000,
      domains: 'skip',
    });
    for (const [input] of skipping.organizations.createOrganization.mock.calls) {
      expect(input.domainData ?? []).toEqual([]);
    }
    expect(skipping.organizations.updateOrganization).not.toHaveBeenCalled();
  });

  it('matches proxy routes and custom attributes by organization-scoped identity', async () => {
    // Two orgs, same externalId in custom attribute + proxy rows: only the
    // organization-scoped match should receive each mapping.
    writeRows(
      path.join(pkgDir, 'sso/custom_attribute_mappings.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.customAttributeMappings,
      [
        {
          externalId: 'acme-okta',
          organizationExternalId: 'someone-else',
          providerType: 'SAML',
          userPoolAttribute: 'department',
          idpClaim: 'WRONG',
        },
        {
          externalId: 'acme-okta',
          organizationExternalId: 'acme',
          providerType: 'SAML',
          userPoolAttribute: 'department',
          idpClaim: 'RIGHT',
        },
      ],
    );
    writeRows(
      path.join(pkgDir, 'sso/proxy_routes.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.proxyRoutes,
      [
        {
          externalId: 'acme-okta',
          organizationExternalId: 'someone-else',
          provider: 'auth0',
          protocol: 'saml',
          cutoverState: 'legacy',
        },
        {
          externalId: 'acme-okta',
          organizationExternalId: 'acme',
          provider: 'auth0',
          protocol: 'saml',
          cutoverState: 'legacy',
        },
      ],
    );

    const fake = createFakeWorkOS();
    await importSsoConnections({
      packageDir: pkgDir,
      workos: fake.workos,
      quiet: true,
      rateLimit: 1000,
    });

    const acmeCall = fake.post.mock.calls.find(([, body]) => body.external_id === 'acme-okta');
    expect(acmeCall?.[1].attribute_maps.custom_attributes).toEqual({ department: 'RIGHT' });

    const proxyRoutes = await readCsvRows(path.join(pkgDir, 'sso/proxy_routes.csv'));
    expect(
      proxyRoutes.find((row) => row.organizationExternalId === 'acme')?.workosConnectionId,
    ).toBe('conn_1');
    expect(
      proxyRoutes.find((row) => row.organizationExternalId === 'someone-else')?.workosConnectionId,
    ).toBe('');
  });

  it.each(['failed', 'legacy_verified', 'api_error'])(
    'reports domain update failure (%s) without creating a connection or updating its route',
    async (state) => {
      const fake = createFakeWorkOS({
        orgs: [
          {
            id: 'org_existing',
            name: 'Globex',
            externalId: 'globex',
            domains: [{ domain: 'globex.com', state: state === 'api_error' ? 'verified' : state }],
          },
        ],
      });
      if (state === 'api_error') {
        fake.organizations.updateOrganization.mockRejectedValue(
          new Error('Domain update rejected'),
        );
      }
      const proxyPath = path.join(pkgDir, 'sso/proxy_routes.csv');
      writeRows(proxyPath, MIGRATION_PACKAGE_CSV_HEADERS.proxyRoutes, [
        {
          externalId: 'globex-saml',
          organizationExternalId: 'globex',
          protocol: 'saml',
        },
      ]);
      const errorsPath = path.join(pkgDir, 'errors.jsonl');
      const summary = await importSsoConnections({
        packageDir: pkgDir,
        workos: fake.workos,
        quiet: true,
        rateLimit: 1000,
        errorsPath,
      });

      expect(summary).toMatchObject({ succeeded: 1, failed: 1, skipped: 2, proxyRoutesUpdated: 0 });
      expect(fake.post.mock.calls.some(([, body]) => body.external_id === 'globex-saml')).toBe(
        false,
      );
      expect(fake.orgs.get('org_existing')?.domains).toEqual([
        { domain: 'globex.com', state: state === 'api_error' ? 'verified' : state },
      ]);
      const errors = fs
        .readFileSync(errorsPath, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(errors).toContainEqual(
        expect.objectContaining({
          externalId: 'globex-saml',
          outcome: 'failed',
          message: expect.stringContaining('Could not add domain(s)'),
        }),
      );
      const results = await readCsvRows(path.join(pkgDir, SSO_RESULTS_FILENAME));
      expect(results.find((row) => row.externalId === 'globex-saml')).toMatchObject({
        outcome: 'failed',
        workosConnectionId: '',
      });
      expect((await readCsvRows(proxyPath))[0].workosConnectionId).toBe('');
    },
  );

  it.each(['include', 'skip'] as const)(
    'resolves organizationId-only rows for scoped attributes (%s) and proxy routes',
    async (customAttributes) => {
      const samlPath = path.join(pkgDir, 'sso/saml_connections.csv');
      const oidcPath = path.join(pkgDir, 'sso/oidc_connections.csv');
      const saml = (await readCsvRows(samlPath))[0];
      const oidc = (await readCsvRows(oidcPath))[0];
      for (const row of [saml, oidc]) {
        row.organizationId = 'org_acme';
        row.organizationExternalId = '';
      }
      oidc.clientSecret = 'secret';
      writeRows(samlPath, MIGRATION_PACKAGE_CSV_HEADERS.samlConnections, [saml]);
      writeRows(oidcPath, MIGRATION_PACKAGE_CSV_HEADERS.oidcConnections, [oidc]);
      writeRows(
        path.join(pkgDir, 'sso/custom_attribute_mappings.csv'),
        MIGRATION_PACKAGE_CSV_HEADERS.customAttributeMappings,
        [saml, oidc].flatMap((row) => [
          {
            externalId: row.externalId,
            organizationExternalId: '',
            userPoolAttribute: 'title',
            idpClaim: 'title',
          },
          {
            externalId: row.externalId,
            organizationExternalId: 'acme',
            userPoolAttribute: 'department',
            idpClaim: 'RIGHT',
          },
          {
            externalId: row.externalId,
            organizationExternalId: 'someone-else',
            userPoolAttribute: 'department',
            idpClaim: 'WRONG',
          },
        ]),
      );
      const proxyPath = path.join(pkgDir, 'sso/proxy_routes.csv');
      writeRows(
        proxyPath,
        MIGRATION_PACKAGE_CSV_HEADERS.proxyRoutes,
        [saml, oidc].flatMap((row) => [
          { externalId: row.externalId, organizationExternalId: 'acme' },
          { externalId: row.externalId, organizationExternalId: 'someone-else' },
        ]),
      );
      const fake = createFakeWorkOS({
        orgs: [{ id: 'org_acme', name: 'Acme', externalId: 'acme', domains: [] }],
      });
      const options = {
        packageDir: pkgDir,
        workos: fake.workos,
        quiet: true,
        rateLimit: 1000,
        domains: 'skip' as const,
        customAttributes,
      };

      await importSsoConnections({ ...options, dryRun: true });
      expect(fake.organizations.getOrganization).not.toHaveBeenCalled();
      expect(fake.post).not.toHaveBeenCalled();

      const summary = await importSsoConnections(options);
      expect(summary).toMatchObject({ succeeded: 2, failed: 0, proxyRoutesUpdated: 2 });
      expect(fake.organizations.getOrganization).toHaveBeenCalledTimes(1);
      for (const [, body] of fake.post.mock.calls) {
        expect(body.organization_id).toBe('org_acme');
        expect(body.attribute_maps?.custom_attributes).toEqual(
          customAttributes === 'include' ? { title: 'title', department: 'RIGHT' } : undefined,
        );
      }
      expect(fake.post.mock.calls[0][1].attribute_maps.standard_attributes).toEqual({
        email: 'mail',
      });
      const routes = await readCsvRows(proxyPath);
      const results = await readCsvRows(path.join(pkgDir, SSO_RESULTS_FILENAME));
      for (const result of summary.results) {
        expect(result.organizationExternalId).toBe('acme');
        expect(
          routes.find(
            (row) => row.externalId === result.externalId && row.organizationExternalId === 'acme',
          ),
        ).toMatchObject({
          workosConnectionId: result.connectionId,
          workosAcsUrl: result.callbackEndpoint,
        });
        expect(
          routes.find(
            (row) =>
              row.externalId === result.externalId && row.organizationExternalId === 'someone-else',
          )?.workosConnectionId,
        ).toBe('');
        expect(
          results.find((row) => row.externalId === result.externalId)?.organizationExternalId,
        ).toBe('acme');
      }
    },
  );

  it('paces and retries organization resolution like the connection POST', async () => {
    const samlPath = path.join(pkgDir, 'sso/saml_connections.csv');
    const saml = (await readCsvRows(samlPath))[0];
    writeRows(samlPath, MIGRATION_PACKAGE_CSV_HEADERS.samlConnections, [saml]);
    writeRows(
      path.join(pkgDir, 'sso/oidc_connections.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.oidcConnections,
      [],
    );
    const timeline: Array<{ label: string; at: number }> = [];
    const fake = createFakeWorkOS({ trace: (label) => timeline.push({ label, at: Date.now() }) });
    // A 429 while resolving the organization has to be retried, not fail the row.
    fake.organizations.getOrganizationByExternalId.mockImplementationOnce(async () => {
      timeline.push({ label: 'getOrganizationByExternalId', at: Date.now() });
      throw Object.assign(new Error('Too many requests'), { status: 429, retryAfter: 0 });
    });

    const summary = await importSsoConnections({
      packageDir: pkgDir,
      workos: fake.workos,
      quiet: true,
      rateLimit: 2,
    });

    expect(summary).toMatchObject({ succeeded: 1, failed: 0 });
    expect(fake.organizations.getOrganizationByExternalId).toHaveBeenCalledTimes(2);
    expect(timeline.map((entry) => entry.label)).toEqual([
      'getOrganizationByExternalId',
      'getOrganizationByExternalId',
      'createOrganization',
      'post',
    ]);
    // retryAfter is 0, so the only source of delay is the 2/s limiter: four
    // calls from a two-token bucket take about a second.
    expect(timeline[3].at - timeline[0].at).toBeGreaterThanOrEqual(900);
  });

  it('takes a limiter token for every POST /connections attempt', async () => {
    const samlPath = path.join(pkgDir, 'sso/saml_connections.csv');
    const saml = (await readCsvRows(samlPath))[0];
    saml.organizationId = 'org_acme';
    saml.organizationExternalId = '';
    writeRows(samlPath, MIGRATION_PACKAGE_CSV_HEADERS.samlConnections, [saml]);
    writeRows(
      path.join(pkgDir, 'sso/oidc_connections.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.oidcConnections,
      [],
    );
    const timeline: Array<{ label: string; at: number }> = [];
    let attempts = 0;
    const fake = createFakeWorkOS({
      orgs: [{ id: 'org_acme', name: 'Acme', domains: [] }],
      trace: (label) => timeline.push({ label, at: Date.now() }),
      postImpl: async (body) => {
        attempts += 1;
        if (attempts <= 2) {
          throw Object.assign(new Error('Too many requests'), { status: 429, retryAfter: 0 });
        }
        return { data: connectionResponse(body, 'conn_retry') };
      },
    });

    const summary = await importSsoConnections({
      packageDir: pkgDir,
      workos: fake.workos,
      quiet: true,
      rateLimit: 2,
      domains: 'skip',
    });

    expect(attempts).toBe(3);
    expect(summary).toMatchObject({ succeeded: 1, failed: 0 });
    const posts = timeline.filter((entry) => entry.label === 'post').map((entry) => entry.at);
    expect(posts).toHaveLength(3);
    expect(posts[1] - posts[0]).toBeGreaterThanOrEqual(400);
    expect(posts[2] - posts[1]).toBeGreaterThanOrEqual(400);
  });

  it.each<[string, () => unknown]>([
    [
      'a 429 whose body is not JSON',
      () =>
        new Error(`Unexpected error: ParseError: Unexpected token '<'`, {
          cause: Object.assign(new Error(`Unexpected token '<'`), {
            name: 'ParseError',
            status: 500,
            rawStatus: 429,
            rawBody: '<html><body>429 Too Many Requests</body></html>',
          }),
        }),
    ],
    [
      'an SDK request timeout',
      () => Object.assign(new Error('Error: Request timeout'), { status: 408 }),
    ],
    [
      'a dropped socket',
      () =>
        new Error('Unexpected error: TypeError: fetch failed', {
          cause: new TypeError('fetch failed'),
        }),
    ],
  ])('retries POST /connections after %s', async (_label, makeError) => {
    const samlPath = path.join(pkgDir, 'sso/saml_connections.csv');
    const saml = (await readCsvRows(samlPath))[0];
    writeRows(samlPath, MIGRATION_PACKAGE_CSV_HEADERS.samlConnections, [saml]);
    writeRows(
      path.join(pkgDir, 'sso/oidc_connections.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.oidcConnections,
      [],
    );
    let attempts = 0;
    const fake = createFakeWorkOS({
      orgs: [{ id: 'org_acme', name: 'Acme', externalId: 'acme', domains: [] }],
      postImpl: async (body) => {
        attempts += 1;
        if (attempts === 1) throw makeError();
        return { data: connectionResponse(body, 'conn_retry') };
      },
    });

    const summary = await importSsoConnections({
      packageDir: pkgDir,
      workos: fake.workos,
      quiet: true,
      rateLimit: 1000,
      domains: 'skip',
    });

    expect(attempts).toBe(2);
    expect(summary).toMatchObject({ succeeded: 1, failed: 0 });
    expect(summary.results[0]).toMatchObject({ outcome: 'created', connectionId: 'conn_retry' });
  });

  it('warns when the connection WorkOS returns belongs to another organization', async () => {
    const samlPath = path.join(pkgDir, 'sso/saml_connections.csv');
    const saml = (await readCsvRows(samlPath))[0];
    writeRows(samlPath, MIGRATION_PACKAGE_CSV_HEADERS.samlConnections, [saml]);
    writeRows(
      path.join(pkgDir, 'sso/oidc_connections.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.oidcConnections,
      [],
    );
    const fake = createFakeWorkOS({
      orgs: [{ id: 'org_acme', name: 'Acme', externalId: 'acme', domains: [] }],
      postImpl: async (body) => ({
        data: {
          ...connectionResponse(body, 'conn_old'),
          organization_id: 'org_other',
          created_at: '2026-01-01T00:00:00.000Z',
          state: 'active',
        },
      }),
    });

    const summary = await importSsoConnections({
      packageDir: pkgDir,
      workos: fake.workos,
      quiet: true,
      rateLimit: 1000,
      domains: 'skip',
    });

    const result = summary.results[0];
    expect(result).toMatchObject({
      outcome: 'existing',
      organizationExternalId: 'acme',
      organizationId: 'org_other',
    });
    expect(result.warnings.join(' ')).toContain('organization_mismatch');
    expect(result.warnings.join(' ')).toContain('org_acme');
    expect(result.warnings.join(' ')).toContain('org_other');
    expect(summary.warnings.join(' ')).toContain(`${saml.externalId}: organization_mismatch`);
    const results = await readCsvRows(path.join(pkgDir, SSO_RESULTS_FILENAME));
    expect(results[0].warnings).toContain('organization_mismatch');
  });

  it('resolves scoped attributes and proxy routes for an organization with no external id', async () => {
    const samlPath = path.join(pkgDir, 'sso/saml_connections.csv');
    const oidcPath = path.join(pkgDir, 'sso/oidc_connections.csv');
    const saml = (await readCsvRows(samlPath))[0];
    const oidc = (await readCsvRows(oidcPath))[0];
    for (const row of [saml, oidc]) {
      row.organizationId = 'org_noext';
      row.organizationExternalId = '';
    }
    oidc.clientSecret = 'secret';
    writeRows(samlPath, MIGRATION_PACKAGE_CSV_HEADERS.samlConnections, [saml]);
    writeRows(oidcPath, MIGRATION_PACKAGE_CSV_HEADERS.oidcConnections, [oidc]);
    writeRows(
      path.join(pkgDir, 'sso/custom_attribute_mappings.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.customAttributeMappings,
      [
        {
          externalId: saml.externalId,
          organizationExternalId: '',
          userPoolAttribute: 'title',
          idpClaim: 'title',
        },
        // Keyed by the WorkOS organization id: the only identifier a row that
        // names its organization by id has.
        {
          externalId: saml.externalId,
          organizationExternalId: 'org_noext',
          userPoolAttribute: 'department',
          idpClaim: 'RIGHT',
        },
        {
          externalId: saml.externalId,
          organizationExternalId: 'someone-else',
          userPoolAttribute: 'department',
          idpClaim: 'WRONG',
        },
        {
          externalId: oidc.externalId,
          organizationExternalId: 'someone-else',
          userPoolAttribute: 'team',
          idpClaim: 'WRONG',
        },
      ],
    );
    const proxyPath = path.join(pkgDir, 'sso/proxy_routes.csv');
    writeRows(proxyPath, MIGRATION_PACKAGE_CSV_HEADERS.proxyRoutes, [
      { externalId: saml.externalId, organizationExternalId: 'org_noext' },
      { externalId: saml.externalId, organizationExternalId: 'someone-else' },
      { externalId: oidc.externalId, organizationExternalId: 'org_noext' },
    ]);
    const fake = createFakeWorkOS({
      orgs: [{ id: 'org_noext', name: 'No External Id', domains: [] }],
    });

    const summary = await importSsoConnections({
      packageDir: pkgDir,
      workos: fake.workos,
      quiet: true,
      rateLimit: 1000,
      domains: 'skip',
    });

    expect(summary).toMatchObject({ succeeded: 2, failed: 0, proxyRoutesUpdated: 2 });
    const [samlBody, oidcBody] = fake.post.mock.calls.map(([, body]) => body);
    expect(samlBody.attribute_maps.custom_attributes).toEqual({
      title: 'title',
      department: 'RIGHT',
    });
    expect(oidcBody.attribute_maps?.custom_attributes).toBeUndefined();
    const oidcResult = summary.results.find((result) => result.externalId === oidc.externalId)!;
    expect(oidcResult.warnings.join(' ')).toContain('custom_attributes_organization_mismatch');
    expect(oidcResult.warnings.join(' ')).toContain('someone-else');
    const routes = await readCsvRows(proxyPath);
    expect(
      routes
        .filter((row) => row.workosConnectionId)
        .map((row) => `${row.externalId}/${row.organizationExternalId}`),
    ).toEqual([`${saml.externalId}/org_noext`, `${oidc.externalId}/org_noext`]);
    expect(summary.notes.join(' ')).toContain(`${saml.externalId} (someone-else)`);
  });

  it('warns about wildcard domains it cannot add to the organization', async () => {
    const samlPath = path.join(pkgDir, 'sso/saml_connections.csv');
    const saml = (await readCsvRows(samlPath))[0];
    saml.domains = 'acme.com;*.acme.com';
    writeRows(samlPath, MIGRATION_PACKAGE_CSV_HEADERS.samlConnections, [saml]);
    writeRows(
      path.join(pkgDir, 'sso/oidc_connections.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.oidcConnections,
      [],
    );
    const fake = createFakeWorkOS();

    const summary = await importSsoConnections({
      packageDir: pkgDir,
      workos: fake.workos,
      quiet: true,
      rateLimit: 1000,
    });

    expect(summary.results[0].domains).toEqual(['acme.com']);
    expect(summary.warnings.join(' ')).toContain('wildcard_domains_dropped');
    expect(summary.warnings.join(' ')).toContain('*.acme.com');
    expect(fake.organizations.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ domainData: [{ domain: 'acme.com', state: 'verified' }] }),
    );
  });

  it('returns absent when the package has no SSO rows', async () => {
    const emptyDir = path.join(tempRoot, 'empty');
    await createMigrationPackage({ provider: 'csv', rootDir: emptyDir, warnings: [] });
    const summary = await importSsoConnections({ packageDir: emptyDir, dryRun: true, quiet: true });
    expect(summary.status).toBe('absent');
    expect(summary.total).toBe(0);
  });
});

describe('loadSsoSecrets', () => {
  let tempRoot: string;
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-sso-secrets-'));
  });
  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('reads JSON objects, JSON arrays, and CSV files', async () => {
    const objectPath = path.join(tempRoot, 'object.json');
    fs.writeFileSync(objectPath, JSON.stringify({ a: 'secret-a', b: '' }));
    expect(await loadSsoSecrets(objectPath)).toEqual(new Map([['a', 'secret-a']]));

    const arrayPath = path.join(tempRoot, 'array.json');
    fs.writeFileSync(arrayPath, JSON.stringify([{ externalId: 'c', client_secret: 'secret-c' }]));
    expect(await loadSsoSecrets(arrayPath)).toEqual(new Map([['c', 'secret-c']]));

    const csvPath = path.join(tempRoot, 'secrets.csv');
    fs.writeFileSync(csvPath, 'externalId,clientSecret\nd,secret-d\n');
    expect(await loadSsoSecrets(csvPath)).toEqual(new Map([['d', 'secret-d']]));
  });
});

describe('collectCustomAttributeNames', () => {
  it('returns sorted unique names', () => {
    expect(
      collectCustomAttributeNames([
        { externalId: 'a', userPoolAttribute: 'title', idpClaim: 't' },
        { externalId: 'b', userPoolAttribute: 'department', idpClaim: 'd' },
        { externalId: 'c', userPoolAttribute: 'title', idpClaim: 't2' },
      ]),
    ).toEqual(['department', 'title']);
  });
});

function connectionResponse(body: any, id: string) {
  const isSaml = Boolean(body.saml_options);
  return {
    object: 'connection',
    id,
    organization_id: body.organization_id,
    connection_type: body.connection_type ?? (isSaml ? 'GenericSAML' : 'GenericOIDC'),
    name: body.name,
    state: 'validating',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    external_id: body.external_id ?? null,
    callback_endpoint: `https://api.workos.com/sso/saml/acs/${id}`,
  };
}

function writeRows(
  filePath: string,
  headers: readonly string[],
  rows: Record<string, string>[],
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header] ?? '')).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
