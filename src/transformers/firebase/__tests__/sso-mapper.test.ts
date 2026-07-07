import {
  mapFirebaseOidcConfig,
  mapFirebaseSamlConfig,
  type FirebaseInboundSamlConfig,
  type FirebaseOAuthIdpConfig,
} from '../sso-mapper';

const baseSaml: FirebaseInboundSamlConfig = {
  name: 'projects/acme/inboundSamlConfigs/saml.okta',
  displayName: 'Acme Okta',
  enabled: true,
  idpConfig: {
    idpEntityId: 'https://acme.okta.com/exk1',
    ssoUrl: 'https://acme.okta.com/sso/saml',
    signRequest: false,
    idpCertificates: [{ x509Certificate: 'CERTDATA' }],
  },
  spConfig: {
    spEntityId: 'https://identitytoolkit.googleapis.com/saml.okta',
    callbackUri: 'https://acme.firebaseapp.com/__/auth/handler',
  },
};

const baseOidc: FirebaseOAuthIdpConfig = {
  name: 'projects/acme/oauthIdpConfigs/oidc.azure',
  displayName: 'Acme Azure OIDC',
  enabled: true,
  clientId: 'client-id-123',
  clientSecret: 'super-secret',
  issuer: 'https://login.microsoftonline.com/tenant',
  responseType: { code: true },
};

describe('mapFirebaseSamlConfig', () => {
  it('maps a complete project-scoped config to a handoff row', () => {
    const result = mapFirebaseSamlConfig({ config: baseSaml });

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.externalId).toBe('firebase:saml.okta');
    expect(result.row).toMatchObject({
      idpEntityId: 'https://acme.okta.com/exk1',
      idpUrl: 'https://acme.okta.com/sso/saml',
      x509Cert: 'CERTDATA',
      customEntityId: 'https://identitytoolkit.googleapis.com/saml.okta',
      customAcsUrl: 'https://acme.firebaseapp.com/__/auth/handler',
      externalId: 'firebase:saml.okta',
    });
    expect(result.warnings.map((w) => w.code)).toContain('missing_domains');
  });

  it('uses tenant scope when provided', () => {
    const result = mapFirebaseSamlConfig({
      config: { ...baseSaml, name: 'projects/acme/tenants/t1/inboundSamlConfigs/saml.okta' },
      scope: { tenantId: 't1', tenantDisplayName: 'Tenant One' },
    });
    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.externalId).toBe('firebase:t1:saml.okta');
    expect(result.row.organizationExternalId).toBe('t1');
    expect(result.row.organizationName).toBe('Tenant One');
  });

  it('skips configs missing IdP entity, SSO URL, or certificates', () => {
    const result = mapFirebaseSamlConfig({
      config: {
        ...baseSaml,
        idpConfig: { idpEntityId: '', ssoUrl: '', idpCertificates: [] },
      },
    });
    expect(result.status).toBe('skipped');
    if (result.status !== 'skipped') return;
    expect(result.warnings[0].code).toBe('incomplete_connection_configuration');
    expect(result.warnings[0].details?.missingFields).toEqual(
      expect.arrayContaining([
        'idpConfig.idpEntityId',
        'idpConfig.ssoUrl',
        'idpConfig.idpCertificates',
      ]),
    );
  });

  it('emits a SP-request-signing warning when idpConfig.signRequest=true', () => {
    const result = mapFirebaseSamlConfig({
      config: {
        ...baseSaml,
        idpConfig: { ...baseSaml.idpConfig!, signRequest: true },
      },
    });
    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    const signRequestWarning = result.warnings.find(
      (w) =>
        w.code === 'incomplete_connection_configuration' &&
        (w.details?.missingFields as string[] | undefined)?.includes('sp_request_signing'),
    );
    expect(signRequestWarning).toBeDefined();
  });

  it('emits a cert-expiry warning when SP cert expires within the warning window', () => {
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = mapFirebaseSamlConfig({
      config: {
        ...baseSaml,
        spConfig: {
          ...baseSaml.spConfig!,
          spCertificates: [{ x509Certificate: 'SP-CERT', expiresAt: soon }],
        },
      },
    });
    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    const expiryWarning = result.warnings.find(
      (w) =>
        w.code === 'incomplete_connection_configuration' &&
        (w.details?.missingFields as string[] | undefined)?.includes('sp_certificate_renewal'),
    );
    expect(expiryWarning).toBeDefined();
  });

  it('does not emit a cert-expiry warning when SP cert is far in the future', () => {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const result = mapFirebaseSamlConfig({
      config: {
        ...baseSaml,
        spConfig: {
          ...baseSaml.spConfig!,
          spCertificates: [{ x509Certificate: 'SP-CERT', expiresAt: farFuture }],
        },
      },
    });
    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    const expiryWarning = result.warnings.find((w) =>
      (w.details?.missingFields as string[] | undefined)?.includes('sp_certificate_renewal'),
    );
    expect(expiryWarning).toBeUndefined();
  });
});

describe('mapFirebaseOidcConfig', () => {
  it('maps a complete config and redacts clientSecret', () => {
    const result = mapFirebaseOidcConfig({ config: baseOidc });

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.row).toMatchObject({
      clientId: 'client-id-123',
      clientSecret: '',
      discoveryEndpoint:
        'https://login.microsoftonline.com/tenant/.well-known/openid-configuration',
      externalId: 'firebase:oidc.azure',
    });
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['secrets_redacted', 'missing_domains']),
    );
    const redact = result.warnings.find((w) => w.code === 'secrets_redacted');
    expect(redact?.details).toMatchObject({
      file: 'sso/oidc_connections.csv',
      fields: ['clientSecret'],
    });
  });

  it('does not emit a secrets_redacted warning when no client secret was returned', () => {
    const result = mapFirebaseOidcConfig({ config: { ...baseOidc, clientSecret: null } });
    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.warnings.map((w) => w.code)).not.toContain('secrets_redacted');
  });

  it('does not double-append the discovery suffix if already present', () => {
    const result = mapFirebaseOidcConfig({
      config: {
        ...baseOidc,
        issuer: 'https://login.microsoftonline.com/tenant/.well-known/openid-configuration',
      },
    });
    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.row.discoveryEndpoint).toBe(
      'https://login.microsoftonline.com/tenant/.well-known/openid-configuration',
    );
  });

  it('skips configs missing clientId or issuer', () => {
    const result = mapFirebaseOidcConfig({
      config: { ...baseOidc, clientId: '', issuer: '' },
    });
    expect(result.status).toBe('skipped');
    if (result.status !== 'skipped') return;
    expect(result.warnings[0].details?.missingFields).toEqual(
      expect.arrayContaining(['clientId', 'issuer']),
    );
  });
});
