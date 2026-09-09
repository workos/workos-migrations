import {
  buildOidcConnectionRequest,
  buildSamlConnectionRequest,
  groupCustomAttributeMappings,
  indexCustomAttributeMappings,
  parseDomainList,
  toPemCertificate,
  toPemPrivateKey,
} from '../connection-request-mapper';
import { createOidcConnectionRow, createSamlConnectionRow } from '../handoff';

const BARE_CERT = 'MIICXjCCAcegAwIBAgIBADANBgkqhkiG9w0BAQ0FADCBhzELMAkGA1UEBhMCVVMx'.repeat(2);

describe('toPemCertificate', () => {
  it('wraps bare base64 into a 64-column PEM block', () => {
    const pem = toPemCertificate(BARE_CERT);
    const lines = pem.split('\n');
    expect(lines[0]).toBe('-----BEGIN CERTIFICATE-----');
    expect(lines[lines.length - 1]).toBe('-----END CERTIFICATE-----');
    for (const line of lines.slice(1, -1)) {
      expect(line.length).toBeLessThanOrEqual(64);
    }
    expect(lines.slice(1, -1).join('')).toBe(BARE_CERT);
  });

  it('normalizes PEM with escaped newlines and stray whitespace', () => {
    const escaped = `-----BEGIN CERTIFICATE-----\\n${BARE_CERT.slice(0, 64)}\\n${BARE_CERT.slice(64)}\\n-----END CERTIFICATE-----`;
    expect(toPemCertificate(escaped)).toBe(toPemCertificate(BARE_CERT));
    expect(toPemCertificate(`  ${toPemCertificate(BARE_CERT)}\r\n`)).toBe(
      toPemCertificate(BARE_CERT),
    );
  });

  it('preserves the PEM label of private keys', () => {
    const rsa = '-----BEGIN RSA PRIVATE KEY-----\\nAAAA\\n-----END RSA PRIVATE KEY-----';
    expect(toPemPrivateKey(rsa)).toBe(
      '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----',
    );
    expect(toPemPrivateKey('AAAA')).toBe(
      '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----',
    );
  });
});

describe('parseDomainList', () => {
  it('splits on commas and semicolons, lowercases, dedupes, and drops wildcards', () => {
    expect(parseDomainList('Acme.com; app.acme.com,acme.com,*.acme.com, ')).toEqual([
      'acme.com',
      'app.acme.com',
    ]);
    expect(parseDomainList('')).toEqual([]);
    expect(parseDomainList(undefined)).toEqual([]);
  });
});

describe('groupCustomAttributeMappings', () => {
  it('groups rows by externalId into attribute -> claim records', () => {
    const grouped = groupCustomAttributeMappings([
      { externalId: 'okta', userPoolAttribute: 'department', idpClaim: 'dept' },
      { externalId: 'okta', userPoolAttribute: 'title', idpClaim: 'jobTitle' },
      { externalId: 'azure', userPoolAttribute: 'department', idpClaim: 'department' },
      { externalId: '', userPoolAttribute: 'ignored', idpClaim: 'x' },
    ]);
    expect(grouped.get('okta')).toEqual({ department: 'dept', title: 'jobTitle' });
    expect(grouped.get('azure')).toEqual({ department: 'department' });
    expect(grouped.size).toBe(2);
  });
});

describe('buildSamlConnectionRequest', () => {
  it('builds a manual-IdP request with PEM certs, legacy overrides, attribute maps, and type', () => {
    const row = createSamlConnectionRow({
      name: 'Acme Okta',
      organizationName: 'Acme',
      organizationExternalId: 'org_acme',
      idpEntityId: 'https://idp.example.com/entity',
      idpUrl: 'https://idp.example.com/sso',
      x509Cert: BARE_CERT,
      customAcsUrl: 'https://legacy.example.com/acs',
      customEntityId: 'urn:legacy:sp',
      idpIdAttribute: 'nameId',
      emailAttribute: 'mail',
      firstNameAttribute: 'givenName',
      lastNameAttribute: 'sn',
      nameAttribute: 'displayName',
      externalId: 'okta',
      connectionType: 'oktasaml',
    });

    const result = buildSamlConnectionRequest({
      row,
      organizationId: 'org_01',
      customAttributes: { department: 'dept' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.request).toEqual({
      organization_id: 'org_01',
      name: 'Acme Okta',
      external_id: 'okta',
      connection_type: 'OktaSAML',
      saml_options: {
        idp_entity_id: 'https://idp.example.com/entity',
        idp_sso_url: 'https://idp.example.com/sso',
        idp_signing_certs: [toPemCertificate(BARE_CERT)],
        acs_url: 'https://legacy.example.com/acs',
        sp_entity_id: 'urn:legacy:sp',
      },
      attribute_maps: {
        standard_attributes: {
          idp_id: 'nameId',
          email: 'mail',
          first_name: 'givenName',
          last_name: 'sn',
          name: 'displayName',
        },
        custom_attributes: { department: 'dept' },
      },
    });
  });

  it('prefers idp_metadata_url and warns that manual fields are ignored', () => {
    const row = createSamlConnectionRow({
      organizationName: 'Acme',
      organizationExternalId: 'org_acme',
      idpMetadataUrl: 'https://idp.example.com/metadata',
      idpUrl: 'https://idp.example.com/sso',
      x509Cert: BARE_CERT,
      externalId: 'okta',
    });
    const result = buildSamlConnectionRequest({ row, organizationId: 'org_01' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.saml_options).toEqual({
      idp_metadata_url: 'https://idp.example.com/metadata',
    });
    expect(result.request.name).toBe('Acme');
    expect(result.request.attribute_maps).toBeUndefined();
    expect(result.warnings.map((w) => w.code)).toEqual(['manual_idp_fields_ignored']);
  });

  it('skips rows without metadata URL or SSO URL + certificate', () => {
    const row = createSamlConnectionRow({
      organizationExternalId: 'org_acme',
      idpEntityId: 'https://idp.example.com/entity',
      externalId: 'broken',
    });
    const result = buildSamlConnectionRequest({ row, organizationId: 'org_01' });
    expect(result).toMatchObject({
      ok: false,
      code: 'incomplete_saml_configuration',
    });
    if (result.ok) return;
    expect(result.message).toContain('idpUrl');
    expect(result.message).toContain('x509Cert');
  });

  it('sends BYO SP key pairs only when both halves are present and warns otherwise', () => {
    const complete = buildSamlConnectionRequest({
      organizationId: 'org_01',
      row: createSamlConnectionRow({
        organizationExternalId: 'org_acme',
        idpUrl: 'https://idp.example.com/sso',
        x509Cert: BARE_CERT,
        requestSigningKey: 'KEYDATA',
        requestSigningCert: BARE_CERT,
        assertionEncryptionKey: '-----BEGIN PRIVATE KEY-----\\nENC\\n-----END PRIVATE KEY-----',
        assertionEncryptionCert: BARE_CERT,
        externalId: 'signed',
      }),
    });
    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    expect(complete.request.saml_options?.sp_signing_key_pair).toEqual({
      key: '-----BEGIN PRIVATE KEY-----\nKEYDATA\n-----END PRIVATE KEY-----',
      cert: toPemCertificate(BARE_CERT),
    });
    expect(complete.request.saml_options?.sp_encryption_key_pairs).toEqual([
      {
        key: '-----BEGIN PRIVATE KEY-----\nENC\n-----END PRIVATE KEY-----',
        cert: toPemCertificate(BARE_CERT),
      },
    ]);
    expect(complete.warnings).toEqual([]);

    const incomplete = buildSamlConnectionRequest({
      organizationId: 'org_01',
      row: createSamlConnectionRow({
        organizationExternalId: 'org_acme',
        idpUrl: 'https://idp.example.com/sso',
        x509Cert: BARE_CERT,
        requestSigningKey: 'KEYDATA',
        assertionEncryptionKey: 'ENC',
        nameIdEncryptionKey: 'NAMEID',
        idpInitiatedEnabled: 'TRUE',
        externalId: 'partial',
      }),
    });
    expect(incomplete.ok).toBe(true);
    if (!incomplete.ok) return;
    expect(incomplete.request.saml_options?.sp_signing_key_pair).toBeUndefined();
    expect(incomplete.request.saml_options?.sp_encryption_key_pairs).toBeUndefined();
    expect(incomplete.warnings.map((w) => w.code).sort()).toEqual(
      [
        'idp_initiated_sso_not_configurable',
        'name_id_encryption_key_unsupported',
        'sp_encryption_key_pair_incomplete',
        'sp_signing_key_pair_incomplete',
      ].sort(),
    );
  });

  it('drops unknown or protocol-mismatched connection types with a warning', () => {
    const unknown = buildSamlConnectionRequest({
      organizationId: 'org_01',
      row: createSamlConnectionRow({
        organizationExternalId: 'org_acme',
        idpUrl: 'https://idp.example.com/sso',
        x509Cert: BARE_CERT,
        externalId: 'typed-unknown',
        connectionType: 'NotARealType',
      }),
    });
    expect(unknown.ok).toBe(true);
    if (!unknown.ok) return;
    expect(unknown.request.connection_type).toBeUndefined();
    expect(unknown.warnings[0].code).toBe('unknown_connection_type');

    const mismatched = buildSamlConnectionRequest({
      organizationId: 'org_01',
      row: createSamlConnectionRow({
        organizationExternalId: 'org_acme',
        idpUrl: 'https://idp.example.com/sso',
        x509Cert: BARE_CERT,
        externalId: 'typed-mismatch',
        connectionType: 'GenericOIDC',
      }),
    });
    expect(mismatched.ok).toBe(true);
    if (!mismatched.ok) return;
    expect(mismatched.request.connection_type).toBeUndefined();
    expect(mismatched.warnings[0].code).toBe('connection_type_protocol_mismatch');
  });
});

describe('buildOidcConnectionRequest', () => {
  it('builds an OIDC request and normalizes the discovery endpoint', () => {
    const result = buildOidcConnectionRequest({
      organizationId: 'org_01',
      customAttributes: { department: 'dept' },
      row: createOidcConnectionRow({
        name: 'Acme Entra',
        organizationExternalId: 'org_acme',
        clientId: 'client_123',
        clientSecret: 'shh',
        discoveryEndpoint: 'https://login.microsoftonline.com/tenant/v2.0',
        customRedirectUri: 'https://legacy.example.com/callback',
        externalId: 'entra',
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).toEqual({
      organization_id: 'org_01',
      name: 'Acme Entra',
      external_id: 'entra',
      oidc_options: {
        discovery_endpoint:
          'https://login.microsoftonline.com/tenant/v2.0/.well-known/openid-configuration',
        client_id: 'client_123',
        client_secret: 'shh',
        redirect_uri: 'https://legacy.example.com/callback',
      },
      attribute_maps: { custom_attributes: { department: 'dept' } },
    });
  });

  it('uses the sidecar client secret over the CSV value and skips when neither exists', () => {
    const row = createOidcConnectionRow({
      organizationExternalId: 'org_acme',
      clientId: 'client_123',
      discoveryEndpoint: 'https://accounts.google.com/.well-known/openid-configuration',
      externalId: 'google',
    });

    const skipped = buildOidcConnectionRequest({ row, organizationId: 'org_01' });
    expect(skipped).toMatchObject({ ok: false, code: 'client_secret_missing' });

    const withSecret = buildOidcConnectionRequest({
      row,
      organizationId: 'org_01',
      clientSecret: 'from-sidecar',
    });
    expect(withSecret.ok).toBe(true);
    if (!withSecret.ok) return;
    expect(withSecret.request.oidc_options?.client_secret).toBe('from-sidecar');
  });

  it('skips rows missing clientId or discoveryEndpoint', () => {
    const result = buildOidcConnectionRequest({
      organizationId: 'org_01',
      row: createOidcConnectionRow({
        organizationExternalId: 'org_acme',
        clientSecret: 'x',
        externalId: 'oidc-incomplete',
      }),
    });
    expect(result).toMatchObject({ ok: false, code: 'incomplete_oidc_configuration' });
  });
});

describe('externalId requirement', () => {
  it('skips SAML and OIDC rows without an externalId so re-runs stay idempotent', () => {
    const saml = buildSamlConnectionRequest({
      organizationId: 'org_01',
      row: createSamlConnectionRow({
        organizationExternalId: 'org_acme',
        idpUrl: 'https://idp.example.com/sso',
        x509Cert: BARE_CERT,
      }),
    });
    expect(saml).toMatchObject({ ok: false, code: 'missing_external_id' });

    const oidc = buildOidcConnectionRequest({
      organizationId: 'org_01',
      row: createOidcConnectionRow({
        organizationExternalId: 'org_acme',
        clientId: 'c',
        clientSecret: 's',
        discoveryEndpoint: 'https://accounts.google.com',
      }),
    });
    expect(oidc).toMatchObject({ ok: false, code: 'missing_external_id' });
  });
});

describe('indexCustomAttributeMappings', () => {
  it('scopes mappings by organization when the mapping row names one', () => {
    const index = indexCustomAttributeMappings([
      {
        externalId: 'okta',
        organizationExternalId: 'org_a',
        userPoolAttribute: 'department',
        idpClaim: 'deptA',
      },
      {
        externalId: 'okta',
        organizationExternalId: 'org_b',
        userPoolAttribute: 'department',
        idpClaim: 'deptB',
      },
      {
        externalId: 'okta',
        organizationExternalId: '',
        userPoolAttribute: 'title',
        idpClaim: 'jobTitle',
      },
    ]);
    expect(index.lookup('okta', 'org_a')).toEqual({ department: 'deptA', title: 'jobTitle' });
    expect(index.lookup('okta', 'org_b')).toEqual({ department: 'deptB', title: 'jobTitle' });
    expect(index.lookup('okta', 'org_c')).toEqual({ title: 'jobTitle' });
    expect(index.lookup('other', 'org_a')).toBeUndefined();
    expect(index.names()).toEqual(['department', 'title']);
  });

  it('takes the first matching scope and reports the scopes it holds', () => {
    const index = indexCustomAttributeMappings([
      {
        externalId: 'okta',
        organizationExternalId: 'org_a',
        userPoolAttribute: 'department',
        idpClaim: 'deptA',
      },
    ]);
    // A row can name its organization by external id or by WorkOS id, so the
    // importer passes both and the first that matches wins.
    expect(index.lookup('okta', ['acme', 'org_a'])).toEqual({ department: 'deptA' });
    expect(index.lookup('okta', ['acme', 'org_b'])).toBeUndefined();
    expect(index.organizationScopes('okta')).toEqual(['org_a']);
    expect(index.organizationScopes('other')).toEqual([]);
  });
});
