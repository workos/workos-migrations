import type { Auth0Connection, Auth0Organization } from '../../../shared/types';
import {
  AUTH0_ENTERPRISE_SSO_STRATEGIES,
  classifyAuth0ConnectionProtocol,
  mapAuth0ConnectionToSsoHandoff,
  redactAuth0ConnectionSecrets,
  inferAuth0SamlConnectionType,
} from '../sso-mapper';

const org: Auth0Organization = {
  id: 'org_acme',
  name: 'acme',
  display_name: 'Acme',
  metadata: {
    domains: ['acme.com'],
  },
};

describe('Auth0 SSO handoff mapper', () => {
  it('tracks Auth0 enterprise strategy values as SSO candidates', () => {
    expect(AUTH0_ENTERPRISE_SSO_STRATEGIES).toEqual(
      expect.arrayContaining([
        'ad',
        'adfs',
        'auth0-adldap',
        'google-apps',
        'oidc',
        'okta',
        'pingfederate',
        'samlp',
        'waad',
      ]),
    );
  });

  it('maps complete SAML enterprise connections into handoff rows', () => {
    const connection: Auth0Connection = {
      id: 'con_saml',
      name: 'okta',
      strategy: 'samlp',
      options: {
        entityId: 'https://idp.example.com/entity',
        signInEndpoint: 'https://idp.example.com/sso',
        signingCert: 'CERTDATA',
        fieldsMap: {
          email: 'mail',
          given_name: 'firstName',
          family_name: 'lastName',
          department: 'department',
        },
      },
    };

    const result = mapAuth0ConnectionToSsoHandoff({
      connection,
      domain: 'tenant.auth0.com',
      orgBindings: [{ organization: org }],
    });

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.protocol).toBe('saml');
    expect(result.samlRow).toMatchObject({
      organizationName: 'Acme',
      organizationExternalId: 'org_acme',
      domains: 'acme.com',
      idpEntityId: 'https://idp.example.com/entity',
      idpUrl: 'https://idp.example.com/sso',
      x509Cert: 'CERTDATA',
      emailAttribute: 'mail',
      firstNameAttribute: 'firstName',
      lastNameAttribute: 'lastName',
      externalId: 'okta',
    });
    expect(result.customAttributeRows).toMatchObject([
      {
        externalId: 'okta',
        organizationExternalId: 'org_acme',
        providerType: 'SAML',
        userPoolAttribute: 'department',
        idpClaim: 'department',
      },
    ]);
    expect(result.proxyRouteRow.sourceAcsUrl).toBe(
      'https://tenant.auth0.com/login/callback?connection=okta',
    );
    expect(result.warnings).toEqual([]);
  });

  it('maps OIDC enterprise connections and redacts secrets unless explicitly included', () => {
    const connection: Auth0Connection = {
      id: 'con_oidc',
      name: 'oidc-idp',
      strategy: 'oidc',
      options: {
        client_id: 'client_123',
        client_secret: 'super-secret',
        issuer: 'https://issuer.example.com',
        mapping: {
          name: 'name',
          title: 'title',
        },
      },
    };

    const result = mapAuth0ConnectionToSsoHandoff({
      connection,
      domain: 'tenant.auth0.com',
      orgBindings: [{ organization: org }],
      includeSecrets: false,
    });

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.protocol).toBe('oidc');
    expect(result.oidcRow).toMatchObject({
      clientId: 'client_123',
      clientSecret: '',
      discoveryEndpoint: 'https://issuer.example.com/.well-known/openid-configuration',
      externalId: 'oidc-idp',
    });
    expect(result.customAttributeRows).toMatchObject([
      {
        providerType: 'OIDC',
        userPoolAttribute: 'title',
        idpClaim: 'title',
      },
    ]);
    expect(result.warnings).toMatchObject([
      {
        code: 'secrets_redacted',
        externalId: 'oidc-idp',
      },
    ]);
  });

  it('maps SAML-capable enterprise strategies when SAML options are present', () => {
    const connection: Auth0Connection = {
      id: 'con_okta_saml',
      name: 'okta-saml',
      strategy: 'okta',
      options: {
        metadataUrl: 'https://okta.example.com/app/metadata',
        entityId: 'https://okta.example.com/entity',
        signInEndpoint: 'https://okta.example.com/sso/saml',
        signingCert: 'CERTDATA',
      },
    };

    expect(classifyAuth0ConnectionProtocol(connection)).toBe('saml');

    const result = mapAuth0ConnectionToSsoHandoff({
      connection,
      domain: 'tenant.auth0.com',
      orgBindings: [{ organization: org }],
    });

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.protocol).toBe('saml');
    expect(result.samlRow).toMatchObject({
      idpMetadataUrl: 'https://okta.example.com/app/metadata',
      idpEntityId: 'https://okta.example.com/entity',
      idpUrl: 'https://okta.example.com/sso/saml',
      x509Cert: 'CERTDATA',
      externalId: 'okta-saml',
    });
  });

  it('maps Azure AD enterprise strategy to OIDC when tenant and client data are present', () => {
    const connection: Auth0Connection = {
      id: 'con_waad',
      name: 'azure-ad',
      strategy: 'waad',
      options: {
        client_id: 'azure-client',
        client_secret: 'azure-secret',
        tenant_domain: 'contoso.onmicrosoft.com',
      },
    };

    expect(classifyAuth0ConnectionProtocol(connection)).toBe('oidc');

    const result = mapAuth0ConnectionToSsoHandoff({
      connection,
      domain: 'tenant.auth0.com',
      orgBindings: [{ organization: org }],
    });

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.oidcRow).toMatchObject({
      clientId: 'azure-client',
      discoveryEndpoint:
        'https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0/.well-known/openid-configuration',
      externalId: 'azure-ad',
    });
  });

  it('maps Google Workspace enterprise strategy to OIDC when client data is present', () => {
    const connection: Auth0Connection = {
      id: 'con_google_apps',
      name: 'google-workspace',
      strategy: 'google-apps',
      options: {
        client_id: 'google-client',
        client_secret: 'google-secret',
      },
    };

    expect(classifyAuth0ConnectionProtocol(connection)).toBe('oidc');

    const result = mapAuth0ConnectionToSsoHandoff({
      connection,
      domain: 'tenant.auth0.com',
      orgBindings: [{ organization: org }],
    });

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.oidcRow).toMatchObject({
      clientId: 'google-client',
      discoveryEndpoint: 'https://accounts.google.com/.well-known/openid-configuration',
      externalId: 'google-workspace',
    });
  });

  it('skips unsupported Auth0 connection strategies', () => {
    const connection: Auth0Connection = {
      id: 'con_db',
      name: 'Username-Password-Authentication',
      strategy: 'auth0',
    };

    expect(classifyAuth0ConnectionProtocol(connection)).toBe('unsupported');

    const result = mapAuth0ConnectionToSsoHandoff({
      connection,
      domain: 'tenant.auth0.com',
    });

    expect(result).toMatchObject({
      status: 'skipped',
      protocol: 'unsupported',
      reason: 'unsupported_connection_protocol',
      warnings: [
        {
          code: 'unsupported_connection_protocol',
          externalId: 'Username-Password-Authentication',
        },
      ],
    });
  });

  it('skips enterprise strategies when SAML/OIDC handoff data is absent', () => {
    const connection: Auth0Connection = {
      id: 'con_adldap',
      name: 'corp-ad',
      strategy: 'auth0-adldap',
      options: {
        domain: 'corp.example.com',
      },
    };

    expect(classifyAuth0ConnectionProtocol(connection)).toBe('unsupported');

    const result = mapAuth0ConnectionToSsoHandoff({
      connection,
      domain: 'tenant.auth0.com',
    });

    expect(result).toMatchObject({
      status: 'skipped',
      protocol: 'unsupported',
      reason: 'unsupported_connection_protocol',
      warnings: [
        {
          code: 'unsupported_connection_protocol',
          externalId: 'corp-ad',
          details: {
            reason:
              'Auth0 enterprise strategy did not expose enough SAML or OIDC handoff configuration.',
          },
        },
      ],
    });
  });

  it('skips SAML connections missing required handoff configuration', () => {
    const connection: Auth0Connection = {
      id: 'con_incomplete',
      name: 'incomplete-saml',
      strategy: 'samlp',
      options: {
        signInEndpoint: 'https://idp.example.com/sso',
      },
    };

    const result = mapAuth0ConnectionToSsoHandoff({
      connection,
      domain: 'tenant.auth0.com',
    });

    expect(result).toMatchObject({
      status: 'skipped',
      protocol: 'saml',
      reason: 'incomplete_connection_configuration',
      warnings: [
        {
          code: 'incomplete_connection_configuration',
          externalId: 'incomplete-saml',
          details: {
            missingFields: ['idpEntityId', 'x509Cert'],
          },
        },
      ],
    });
  });

  it('consolidates multi-org source connections into one handoff row with domain union', () => {
    const connection: Auth0Connection = {
      id: 'con_shared',
      name: 'shared-saml',
      strategy: 'samlp',
      options: {
        entityId: 'https://idp.example.com/entity',
        signInEndpoint: 'https://idp.example.com/sso',
        signingCert: 'CERTDATA',
      },
    };
    const otherOrg: Auth0Organization = {
      id: 'org_other',
      name: 'other',
      display_name: 'Other',
      metadata: {
        domains: ['other.com', 'acme.com'],
      },
    };

    const result = mapAuth0ConnectionToSsoHandoff({
      connection,
      domain: 'tenant.auth0.com',
      orgBindings: [{ organization: org }, { organization: otherOrg }],
    });

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.samlRow).toMatchObject({
      organizationName: 'shared-saml',
      organizationExternalId: 'con_shared',
      domains: 'acme.com,other.com',
    });
    expect(result.warnings).toMatchObject([
      {
        code: 'multi_org_connection_consolidated',
        externalId: 'shared-saml',
        details: {
          sourceOrganizationIds: ['org_acme', 'org_other'],
          domains: ['acme.com', 'other.com'],
        },
      },
    ]);
  });

  it('redacts Auth0 connection secrets without redacting public certificates or endpoints', () => {
    const redacted = redactAuth0ConnectionSecrets({
      options: {
        client_secret: 'super-secret',
        token_endpoint: 'https://issuer.example.com/oauth/token',
        signingCert: 'PUBLIC_CERT',
        private_key: 'PRIVATE_KEY',
      },
    });

    expect(redacted).toEqual({
      options: {
        client_secret: '[REDACTED]',
        token_endpoint: 'https://issuer.example.com/oauth/token',
        signingCert: 'PUBLIC_CERT',
        private_key: '[REDACTED]',
      },
    });
  });
});

describe('Connections API columns', () => {
  const acmeOrg: Auth0Organization = { id: 'org_acme', name: 'acme', display_name: 'Acme' };

  it('carries Auth0 signingKey/decryptionKey pairs into key + cert columns only with --include-secrets', () => {
    const connection: Auth0Connection = {
      id: 'con_signed',
      name: 'signed-saml',
      strategy: 'samlp',
      options: {
        entityId: 'https://acme.okta.com/entity',
        signInEndpoint: 'https://acme.okta.com/app/abc/sso/saml',
        signingCert: 'CERTDATA',
        signingKey: { key: 'REQ-KEY', cert: 'REQ-CERT' },
        decryptionKey: { key: 'DEC-KEY', cert: 'DEC-CERT' },
      },
    };

    const redacted = mapAuth0ConnectionToSsoHandoff({
      connection,
      domain: 'tenant.auth0.com',
      orgBindings: [{ organization: acmeOrg }],
    });
    expect(redacted.status).toBe('mapped');
    if (redacted.status !== 'mapped') return;
    expect(redacted.samlRow).toMatchObject({
      requestSigningKey: '',
      requestSigningCert: '',
      assertionEncryptionKey: '',
      assertionEncryptionCert: '',
      connectionType: 'OktaSAML',
    });
    const redactionWarning = redacted.warnings.find((w) => w.code === 'secrets_redacted');
    expect(redactionWarning?.details?.fields).toEqual(
      expect.arrayContaining(['signingKey', 'decryptionKey']),
    );

    const included = mapAuth0ConnectionToSsoHandoff({
      connection,
      domain: 'tenant.auth0.com',
      orgBindings: [{ organization: acmeOrg }],
      includeSecrets: true,
    });
    expect(included.status).toBe('mapped');
    if (included.status !== 'mapped') return;
    expect(included.samlRow).toMatchObject({
      requestSigningKey: 'REQ-KEY',
      requestSigningCert: 'REQ-CERT',
      assertionEncryptionKey: 'DEC-KEY',
      assertionEncryptionCert: 'DEC-CERT',
    });
  });

  it('names the connection type from the strategy or leaves it blank for generic IdPs', () => {
    expect(inferAuth0SamlConnectionType('pingfederate', {})).toBe('PingFederateSAML');
    expect(inferAuth0SamlConnectionType('adfs', {})).toBe('ADFSSAML');
    expect(
      inferAuth0SamlConnectionType('samlp', {
        idpMetadataUrl: 'https://login.microsoftonline.com/tenant/federationmetadata.xml',
      }),
    ).toBe('AzureSAML');
    expect(inferAuth0SamlConnectionType('samlp', { idpUrl: 'https://idp.customer.com/sso' })).toBe(
      '',
    );
  });

  it('redacts signingKey and decryptionKey objects in raw connection JSON', () => {
    const redacted = redactAuth0ConnectionSecrets({
      options: {
        signingKey: { key: 'k', cert: 'c' },
        decryptionKey: { key: 'k' },
        signingCert: 'CERT',
      },
    }) as { options: Record<string, unknown> };
    expect(typeof redacted.options.signingKey).toBe('string');
    expect(typeof redacted.options.decryptionKey).toBe('string');
    expect(redacted.options.signingCert).toBe('CERT');
  });
});
