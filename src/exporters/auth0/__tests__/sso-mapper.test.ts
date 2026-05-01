import type { Auth0Connection, Auth0Organization } from '../../../shared/types';
import {
  classifyAuth0ConnectionProtocol,
  mapAuth0ConnectionToSsoHandoff,
  redactAuth0ConnectionSecrets,
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
      importedId: 'auth0:con_saml',
    });
    expect(result.customAttributeRows).toMatchObject([
      {
        importedId: 'auth0:con_saml',
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
      name: 'name',
      importedId: 'auth0:con_oidc',
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
        importedId: 'auth0:con_oidc',
      },
    ]);
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
          importedId: 'auth0:con_db',
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
          importedId: 'auth0:con_incomplete',
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
        importedId: 'auth0:con_shared',
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
