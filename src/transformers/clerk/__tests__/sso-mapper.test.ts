import { mapClerkEnterpriseConnection, type ClerkEnterpriseConnection } from '../sso-mapper';

const baseSaml: ClerkEnterpriseConnection = {
  id: 'ec_01_saml',
  name: 'Acme Okta',
  active: true,
  domains: ['acme.com'],
  allow_subdomains: false,
  organization_id: 'org_acme',
  saml_connection: {
    id: 'sc_01',
    name: 'Acme Okta',
    idp_entity_id: 'https://acme.okta.com/exk1',
    idp_sso_url: 'https://acme.okta.com/sso/saml',
    idp_certificate: '-----BEGIN CERTIFICATE-----\nCERTDATA\n-----END CERTIFICATE-----',
    idp_metadata_url: 'https://acme.okta.com/metadata',
    acs_url: 'https://clerk.acme.com/v1/saml/acs/sc_01',
    sp_entity_id: 'https://clerk.acme.com/saml/sc_01',
    allow_idp_initiated: true,
    attribute_mapping: {
      user_id: 'nameid',
      email_address: 'mail',
      first_name: 'givenName',
      last_name: 'surname',
      department: 'department',
    },
  },
};

const baseOidc: ClerkEnterpriseConnection = {
  id: 'ec_02_oidc',
  name: 'Acme Azure OIDC',
  active: true,
  domains: ['oidc.acme.com'],
  organization_id: 'org_acme',
  oauth_config: {
    id: 'oc_01',
    name: 'Acme Azure OIDC',
    client_id: 'azure-client-id-123',
    discovery_url: 'https://login.microsoftonline.com/tenant/.well-known/openid-configuration',
  },
};

describe('mapClerkEnterpriseConnection — SAML', () => {
  it('maps a complete SAML enterprise connection with attribute mappings', () => {
    const result = mapClerkEnterpriseConnection({
      connection: baseSaml,
      organization: { id: 'org_acme', name: 'Acme', slug: 'acme' },
    });

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped' || result.protocol !== 'saml') return;

    expect(result.externalId).toBe('clerk:ec_01_saml');
    expect(result.samlRow).toMatchObject({
      organizationName: 'Acme',
      organizationExternalId: 'org_acme',
      domains: 'acme.com',
      idpEntityId: 'https://acme.okta.com/exk1',
      idpUrl: 'https://acme.okta.com/sso/saml',
      idpMetadataUrl: 'https://acme.okta.com/metadata',
      customEntityId: 'https://clerk.acme.com/saml/sc_01',
      customAcsUrl: 'https://clerk.acme.com/v1/saml/acs/sc_01',
      idpIdAttribute: 'nameid',
      emailAttribute: 'mail',
      firstNameAttribute: 'givenName',
      lastNameAttribute: 'surname',
      idpInitiatedEnabled: 'true',
      externalId: 'clerk:ec_01_saml',
    });
    expect(result.samlRow.x509Cert).toContain('CERTDATA');
    expect(result.customAttributeRows).toEqual([
      expect.objectContaining({
        externalId: 'clerk:ec_01_saml',
        organizationExternalId: 'org_acme',
        providerType: 'SAML',
        userPoolAttribute: 'department',
        idpClaim: 'department',
      }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('expands domains array with wildcards when allow_subdomains is true', () => {
    const result = mapClerkEnterpriseConnection({
      connection: { ...baseSaml, domains: ['acme.com', 'app.acme.com'], allow_subdomains: true },
    });
    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped' || result.protocol !== 'saml') return;
    expect(result.samlRow.domains.split(';')).toEqual(
      expect.arrayContaining(['acme.com', '*.acme.com', 'app.acme.com', '*.app.acme.com']),
    );
  });

  it('emits a missing-domains warning when domains is empty', () => {
    const result = mapClerkEnterpriseConnection({ connection: { ...baseSaml, domains: [] } });
    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped' || result.protocol !== 'saml') return;
    expect(result.samlRow.domains).toBe('');
    expect(result.warnings.map((w) => w.code)).toContain('missing_domains');
  });

  it('skips SAML when required IdP fields are missing', () => {
    const result = mapClerkEnterpriseConnection({
      connection: {
        ...baseSaml,
        saml_connection: {
          ...baseSaml.saml_connection!,
          idp_entity_id: '',
          idp_sso_url: '',
        },
      },
    });
    expect(result.status).toBe('skipped');
    if (result.status !== 'skipped') return;
    expect(result.protocol).toBe('saml');
    expect(result.warnings[0].code).toBe('incomplete_connection_configuration');
    expect(result.warnings[0].details?.missingFields).toEqual(
      expect.arrayContaining(['saml_connection.idp_entity_id', 'saml_connection.idp_sso_url']),
    );
  });

  it('accepts metadata-only SAML (no cert but metadata url present)', () => {
    const result = mapClerkEnterpriseConnection({
      connection: {
        ...baseSaml,
        saml_connection: { ...baseSaml.saml_connection!, idp_certificate: null },
      },
    });
    expect(result.status).toBe('mapped');
  });

  it('skips SAML when no certificate and no metadata source is available', () => {
    const result = mapClerkEnterpriseConnection({
      connection: {
        ...baseSaml,
        saml_connection: {
          ...baseSaml.saml_connection!,
          idp_certificate: null,
          idp_metadata_url: null,
          idp_metadata: null,
        },
      },
    });
    expect(result.status).toBe('skipped');
    if (result.status !== 'skipped') return;
    expect(result.warnings[0].details?.missingFields).toContain(
      'saml_connection.idp_certificate_or_metadata',
    );
  });
});

describe('mapClerkEnterpriseConnection — OIDC', () => {
  it('maps a complete OIDC enterprise connection with empty clientSecret', () => {
    const result = mapClerkEnterpriseConnection({
      connection: baseOidc,
      organization: { id: 'org_acme', name: 'Acme', slug: 'acme' },
    });

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped' || result.protocol !== 'oidc') return;

    expect(result.externalId).toBe('clerk:ec_02_oidc');
    expect(result.oidcRow).toMatchObject({
      organizationName: 'Acme',
      organizationExternalId: 'org_acme',
      domains: 'oidc.acme.com',
      clientId: 'azure-client-id-123',
      clientSecret: '',
      discoveryEndpoint:
        'https://login.microsoftonline.com/tenant/.well-known/openid-configuration',
      externalId: 'clerk:ec_02_oidc',
    });
    expect(result.warnings).toEqual([]);
  });

  it('skips OIDC when client_id or discovery_url is missing', () => {
    const result = mapClerkEnterpriseConnection({
      connection: {
        ...baseOidc,
        oauth_config: { ...baseOidc.oauth_config!, client_id: '', discovery_url: '' },
      },
    });
    expect(result.status).toBe('skipped');
    if (result.status !== 'skipped') return;
    expect(result.protocol).toBe('oidc');
    expect(result.warnings[0].details?.missingFields).toEqual(
      expect.arrayContaining(['oauth_config.client_id', 'oauth_config.discovery_url']),
    );
  });

  it('emits a missing-domains warning when domains is empty', () => {
    const result = mapClerkEnterpriseConnection({
      connection: { ...baseOidc, domains: [] },
    });
    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped' || result.protocol !== 'oidc') return;
    expect(result.warnings.map((w) => w.code)).toContain('missing_domains');
  });
});

describe('mapClerkEnterpriseConnection — discrimination', () => {
  it('skips connections with neither saml_connection nor oauth_config', () => {
    const result = mapClerkEnterpriseConnection({
      connection: { id: 'ec_03_empty' },
    });
    expect(result.status).toBe('skipped');
    if (result.status !== 'skipped') return;
    expect(result.protocol).toBe('unknown');
    expect(result.warnings[0].details?.missingFields).toEqual(
      expect.arrayContaining(['saml_connection', 'oauth_config']),
    );
  });

  it('prefers SAML when both sub-objects are present (saml_connection wins)', () => {
    const result = mapClerkEnterpriseConnection({
      connection: { ...baseSaml, oauth_config: baseOidc.oauth_config },
    });
    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.protocol).toBe('saml');
  });
});
