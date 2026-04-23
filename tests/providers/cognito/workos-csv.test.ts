/**
 * Cognito row builders — SAML, OIDC, user, custom-attr — across every
 * connection type and attribute-mapping shape the tool encounters in the
 * wild.
 */
import fs from 'fs';
import path from 'path';
import {
  toSamlRow,
  toOidcRow,
  toUserRow,
  toCustomAttrRows,
  buildCustomAttributesJson,
  renderTemplate,
  isSaml,
  isOidc,
  importedId,
  SAML_HEADERS,
  OIDC_HEADERS,
  USER_HEADERS,
  DEFAULT_SAML_CUSTOM_ENTITY_ID_TEMPLATE,
  type CognitoProvider,
  type CognitoUser,
} from '../../../src/providers/cognito/workos-csv';

const USER_FIXTURES = path.join(__dirname, '../../fixtures/cognito/users');
const CONN_FIXTURES = path.join(__dirname, '../../fixtures/cognito/connections');

function loadUser(name: string): CognitoUser {
  return JSON.parse(fs.readFileSync(path.join(USER_FIXTURES, name), 'utf-8'));
}

function loadProvider(name: string): CognitoProvider {
  return JSON.parse(fs.readFileSync(path.join(CONN_FIXTURES, name), 'utf-8'));
}

// ---------------------------------------------------------------------------
// SAML row builder
// ---------------------------------------------------------------------------

describe('toSamlRow', () => {
  it('returns an object with every SAML_HEADERS key', () => {
    const row = toSamlRow(loadProvider('saml-metadata-file.json'));
    for (const header of SAML_HEADERS) {
      expect(row).toHaveProperty(header);
    }
  });

  it('parses MetadataFile XML into entityId + sso URL + cert', () => {
    const row = toSamlRow(loadProvider('saml-metadata-file.json'));
    expect(row.idpEntityId).toBe('http://www.okta.com/exkabcde1234');
    expect(row.idpUrl).toBe('https://acme.okta.com/app/exkabcde1234/sso/saml');
    expect(row.x509Cert).toContain('MIIDpDCCAoygAwIBAg');
  });

  it('falls back to ProviderDetails.EntityId + SSORedirectBindingURI when no MetadataFile is set', () => {
    const row = toSamlRow(loadProvider('saml-metadata-url.json'));
    expect(row.idpEntityId).toBe('https://sts.windows.net/tenant-id/');
    expect(row.idpUrl).toBe('https://login.microsoftonline.com/tenant-id/saml2');
    expect(row.idpMetadataUrl).toBe(
      'https://login.microsoftonline.com/tenant-id/federationmetadata/2007-06/federationmetadata.xml',
    );
  });

  it('packs custom:* attributes into customAttributes JSON with the prefix stripped', () => {
    const row = toSamlRow(loadProvider('saml-name-only-mapping.json'));
    const parsed = JSON.parse(row.customAttributes);
    expect(parsed).toEqual({
      department: 'department',
      location: 'location',
      title: 'jobTitle',
      user_status: 'userStatus',
      user_type: 'userType',
    });
  });

  it('emits the `name` column when the IdP uses a full-name attribute mapping', () => {
    const row = toSamlRow(loadProvider('saml-name-only-mapping.json'));
    expect(row.name).toBe('fullName');
    expect(row.firstNameAttribute).toBe('');
    expect(row.lastNameAttribute).toBe('');
  });

  it('always writes idpInitiatedEnabled=TRUE (Cognito proxy migration default)', () => {
    const row = toSamlRow(loadProvider('saml-metadata-file.json'));
    expect(row.idpInitiatedEnabled).toBe('TRUE');
  });

  it('returns blanks when no provider details and no attribute mapping', () => {
    const row = toSamlRow(loadProvider('saml-no-metadata.json'));
    expect(row.idpEntityId).toBe('');
    expect(row.idpUrl).toBe('');
    expect(row.x509Cert).toBe('');
    expect(row.idpMetadataUrl).toBe('');
    expect(row.emailAttribute).toBe('emailAddress');
  });

  it('renders proxy templates when supplied', () => {
    const row = toSamlRow(loadProvider('saml-metadata-file.json'), {
      samlCustomAcsUrl: 'https://sso.example.com/{provider_name}/acs',
      samlCustomEntityId: DEFAULT_SAML_CUSTOM_ENTITY_ID_TEMPLATE,
    });
    expect(row.customAcsUrl).toBe('https://sso.example.com/okta-saml/acs');
    expect(row.customEntityId).toBe('urn:amazon:cognito:sp:us-east-1_AAAPOOL');
  });

  it('omits proxy fields when templates are not supplied', () => {
    const row = toSamlRow(loadProvider('saml-metadata-file.json'));
    expect(row.customAcsUrl).toBe('');
    expect(row.customEntityId).toBe('');
  });

  it('populates the importedId as <pool>:<provider_name>', () => {
    const row = toSamlRow(loadProvider('saml-metadata-file.json'));
    expect(row.importedId).toBe('us-east-1_AAAPOOL:okta-saml');
  });
});

// ---------------------------------------------------------------------------
// OIDC row builder
// ---------------------------------------------------------------------------

describe('toOidcRow', () => {
  it('returns an object with every OIDC_HEADERS key', () => {
    const row = toOidcRow(loadProvider('oidc-azure.json'));
    for (const header of OIDC_HEADERS) {
      expect(row).toHaveProperty(header);
    }
  });

  it('normalizes an Azure-style issuer into a full discovery URL', () => {
    const row = toOidcRow(loadProvider('oidc-azure.json'));
    expect(row.discoveryEndpoint).toBe(
      'https://login.microsoftonline.com/a74900dd-e48b-47b6-b212-306653d7f33d/v2.0/.well-known/openid-configuration',
    );
    expect(row.clientId).toBe('5dc7420f-de78-4033-b963-b0553f166d33');
    expect(row.clientSecret).toBe('v3.8Q-fake-secret-for-testing');
  });

  it('normalizes a Google-style issuer into a full discovery URL', () => {
    const row = toOidcRow(loadProvider('oidc-google.json'));
    expect(row.discoveryEndpoint).toBe(
      'https://accounts.google.com/.well-known/openid-configuration',
    );
  });

  it('leaves an already-normalized discovery URL untouched', () => {
    const row = toOidcRow(loadProvider('oidc-already-discovery-url.json'));
    expect(row.discoveryEndpoint).toBe(
      'https://idp.example.com/.well-known/openid-configuration',
    );
  });

  it('renders customRedirectUri when a template is supplied', () => {
    const row = toOidcRow(loadProvider('oidc-azure.json'), {
      oidcCustomRedirectUri: 'https://sso.example.com/{provider_name}/oidc-callback',
    });
    expect(row.customRedirectUri).toBe(
      'https://sso.example.com/azure-oidc/oidc-callback',
    );
  });
});

// ---------------------------------------------------------------------------
// User row builder
// ---------------------------------------------------------------------------

describe('toUserRow', () => {
  it('returns an object with every USER_HEADERS key', () => {
    const row = toUserRow(loadUser('native-database.json'));
    for (const header of USER_HEADERS) {
      expect(row).toHaveProperty(header);
    }
  });

  it('always emits empty password_hash', () => {
    const fixtures = fs.readdirSync(USER_FIXTURES).filter((f) => f.endsWith('.json'));
    for (const name of fixtures) {
      expect(toUserRow(loadUser(name)).password_hash).toBe('');
    }
  });

  describe('user types', () => {
    it('maps a native database user with given + family names', () => {
      expect(toUserRow(loadUser('native-database.json'))).toEqual({
        user_id: '5a3b2c1d-0000-4000-8000-abcdef123456',
        email: 'alice@example.com',
        email_verified: 'true',
        first_name: 'Alice',
        last_name: 'Smith',
        password_hash: '',
      });
    });

    it('maps a SAML-federated user with explicit given + family', () => {
      expect(toUserRow(loadUser('saml-federated-full.json'))).toEqual({
        user_id: '9f8e7d6c-5432-4321-8765-fedcba098765',
        email: 'bob@acme.com',
        email_verified: 'true',
        first_name: 'Bob',
        last_name: 'Chen',
        password_hash: '',
      });
    });

    it('splits `name` when a SAML-federated user has no given/family (EveryoneSocial pattern)', () => {
      // When the IdP ships only `fullName` (mapped to Cognito user pool attr `name`),
      // we synthesize first/last by whitespace-splitting the stored `name` value.
      expect(toUserRow(loadUser('saml-federated-name-only.json'))).toEqual({
        user_id: '11223344-5566-7788-99aa-bbccddeeff00',
        email: 'carol@acme.com',
        email_verified: 'true',
        first_name: 'Carol',
        last_name: 'Williams',
        password_hash: '',
      });
    });

    it('maps a SAML-federated user with every custom attribute set', () => {
      const row = toUserRow(loadUser('saml-federated-with-customs.json'));
      // row-level custom attrs don't land in users.csv — only in the connection
      // CSV's customAttributes column. But confirm basic shape.
      expect(row).toMatchObject({
        user_id: 'abc12345-6789-0abc-def1-23456789abcd',
        email: 'dave@acme.com',
        first_name: 'Dave',
        last_name: 'Wilson',
      });
    });

    it('maps an OIDC-federated user', () => {
      expect(toUserRow(loadUser('oidc-federated.json'))).toMatchObject({
        user_id: 'f0e1d2c3-b4a5-9687-7869-5a4b3c2d1e0f',
        email: 'eve@acme.com',
        first_name: 'Eve',
        last_name: 'Parker',
      });
    });

    it('maps a Google social user', () => {
      expect(toUserRow(loadUser('social-google.json'))).toMatchObject({
        user_id: '55667788-9900-aabb-ccdd-eeff00112233',
        email: 'fiona@gmail.com',
        first_name: 'Fiona',
        last_name: 'Brown',
      });
    });

    it('splits `name` for a Facebook social user that does not provide given/family', () => {
      expect(toUserRow(loadUser('social-facebook.json'))).toEqual({
        user_id: 'aa000011-2233-4455-6677-8899aabbccdd',
        email: 'gabe@example.com',
        email_verified: 'true',
        first_name: 'Gabe',
        last_name: 'Howard',
        password_hash: '',
      });
    });
  });

  describe('edge cases', () => {
    it('falls back to username when sub is missing', () => {
      expect(toUserRow(loadUser('edge-missing-sub.json'))).toMatchObject({
        user_id: 'nosub-user',
        email: 'nosub@example.com',
        first_name: 'Noah',
        last_name: 'Obenauer',
      });
    });

    it('leaves email blank when the user has no email attribute', () => {
      const row = toUserRow(loadUser('edge-missing-email.json'));
      expect(row.email).toBe('');
      expect(row.email_verified).toBe('');
      expect(row.first_name).toBe('');
      expect(row.last_name).toBe('');
    });

    it('splits `name` into first + last when no given/family is set', () => {
      expect(toUserRow(loadUser('edge-name-only-no-given.json'))).toMatchObject({
        first_name: 'Olivia',
        last_name: 'Rodriguez',
      });
    });

    it('preserves unicode characters in names', () => {
      expect(toUserRow(loadUser('edge-unicode.json'))).toMatchObject({
        first_name: 'María',
        last_name: 'García López',
      });
    });

    it('preserves multi-word last names when splitting `name`', () => {
      expect(toUserRow(loadUser('edge-multi-word-last-name.json'))).toMatchObject({
        first_name: 'Mary',
        last_name: 'Ann Jones Smith',
      });
    });
  });

  describe('email_verified serialization', () => {
    it('passes through Cognito string `true` and `false` directly', () => {
      expect(toUserRow(loadUser('native-database.json')).email_verified).toBe('true');
    });

    it('returns empty string when not set', () => {
      expect(toUserRow(loadUser('edge-missing-email.json')).email_verified).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// Supplementary custom-attribute rows
// ---------------------------------------------------------------------------

describe('toCustomAttrRows', () => {
  it('emits one row per `custom:*` attribute + the `name` attribute when present', () => {
    const rows = toCustomAttrRows(loadProvider('saml-name-only-mapping.json'));
    const attrs = rows.map((r) => r.userPoolAttribute).sort();
    expect(attrs).toEqual([
      'custom:department',
      'custom:location',
      'custom:title',
      'custom:user_status',
      'custom:user_type',
      'name',
    ]);
  });

  it('emits nothing when the IdP has no supplementary mappings', () => {
    expect(toCustomAttrRows(loadProvider('saml-metadata-file.json'))).toEqual([]);
  });

  it('populates providerType and organizationExternalId correctly', () => {
    const rows = toCustomAttrRows(loadProvider('saml-name-only-mapping.json'));
    for (const row of rows) {
      expect(row.providerType).toBe('SAML');
      expect(row.organizationExternalId).toBe('customer-tenant-01');
      expect(row.importedId).toBe('us-east-1_AAAPOOL:customer-tenant-01');
    }
  });
});

// ---------------------------------------------------------------------------
// buildCustomAttributesJson
// ---------------------------------------------------------------------------

describe('buildCustomAttributesJson', () => {
  it('sorts keys + strips the custom: prefix + emits compact JSON', () => {
    expect(
      buildCustomAttributesJson({
        'custom:title': 'jobTitle',
        'custom:department': 'department',
        email: 'email-claim', // ignored
      }),
    ).toBe('{"department":"department","title":"jobTitle"}');
  });

  it('returns an empty string when no custom attrs are present', () => {
    expect(buildCustomAttributesJson({ email: 'e' })).toBe('');
  });

  it('drops custom attrs with empty-string values', () => {
    expect(
      buildCustomAttributesJson({
        'custom:a': 'x',
        'custom:b': '',
      }),
    ).toBe('{"a":"x"}');
  });

  it('parses cleanly via JSON.parse', () => {
    const json = buildCustomAttributesJson({
      'custom:location': 'location',
      'custom:department': 'department',
    });
    expect(JSON.parse(json)).toEqual({
      location: 'location',
      department: 'department',
    });
  });
});

// ---------------------------------------------------------------------------
// renderTemplate, type predicates, importedId
// ---------------------------------------------------------------------------

describe('renderTemplate', () => {
  const p: CognitoProvider = {
    userPoolId: 'us-east-1_TESTPOOL',
    providerName: 'test-tenant',
    providerType: 'SAML',
    region: 'us-east-1',
    providerDetails: {},
    attributeMapping: {},
    idpIdentifiers: [],
  };

  it('substitutes every supported placeholder', () => {
    expect(
      renderTemplate(
        'https://{provider_name}.{region}.example.com/{user_pool_id}',
        p,
      ),
    ).toBe('https://test-tenant.us-east-1.example.com/us-east-1_TESTPOOL');
  });

  it('substitutes the same placeholder multiple times', () => {
    expect(
      renderTemplate('{provider_name}-{provider_name}-{provider_name}', p),
    ).toBe('test-tenant-test-tenant-test-tenant');
  });

  it('returns an empty string when template is null/undefined/empty', () => {
    expect(renderTemplate(null, p)).toBe('');
    expect(renderTemplate(undefined, p)).toBe('');
    expect(renderTemplate('', p)).toBe('');
  });

  it('leaves unknown placeholders in place', () => {
    expect(renderTemplate('{user_pool_id}/{unknown_var}', p)).toBe(
      'us-east-1_TESTPOOL/{unknown_var}',
    );
  });
});

describe('type predicates', () => {
  const base = {
    userPoolId: 'p',
    providerName: 'n',
    region: 'us-east-1',
    providerDetails: {},
    attributeMapping: {},
    idpIdentifiers: [],
  };

  it.each([
    ['SAML', true, false],
    ['saml', true, false],
    ['OIDC', false, true],
    ['oidc', false, true],
    ['Google', false, false],
  ])('providerType=%p → isSaml=%p, isOidc=%p', (type, saml, oidc) => {
    const p = { ...base, providerType: type };
    expect(isSaml(p)).toBe(saml);
    expect(isOidc(p)).toBe(oidc);
  });
});

describe('importedId', () => {
  it('composes pool + provider', () => {
    expect(
      importedId({
        userPoolId: 'us-east-1_X',
        providerName: 'y',
        providerType: 'SAML',
        region: 'us-east-1',
        providerDetails: {},
        attributeMapping: {},
        idpIdentifiers: [],
      }),
    ).toBe('us-east-1_X:y');
  });
});
