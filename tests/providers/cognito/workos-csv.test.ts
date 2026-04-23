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
  type CognitoProvider,
  type CognitoUser,
} from '../../../src/providers/cognito/workos-csv';
import { SAML_HEADERS, OIDC_HEADERS } from '../../../src/shared/csv';

function provider(overrides: Partial<CognitoProvider> = {}): CognitoProvider {
  return {
    userPoolId: 'us-east-1_TESTPOOL',
    providerName: 'test-tenant',
    providerType: 'SAML',
    region: 'us-east-1',
    providerDetails: {},
    attributeMapping: {},
    idpIdentifiers: [],
    ...overrides,
  };
}

describe('cognito row builders', () => {
  describe('toSamlRow', () => {
    it('returns an object with every SAML_HEADERS key', () => {
      const row = toSamlRow(provider());
      for (const header of SAML_HEADERS) {
        expect(row).toHaveProperty(header);
      }
    });

    it('parses MetadataFile XML into entityId + sso URL + cert', () => {
      const xml = `<?xml version="1.0"?>
<md:EntityDescriptor entityID="https://idp.example.com/entity"
    xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
    xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <md:IDPSSODescriptor>
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>MIITESTCERT</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
        Location="https://idp.example.com/sso/redirect"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
        Location="https://idp.example.com/sso/post"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;
      const row = toSamlRow(
        provider({
          providerDetails: { MetadataFile: xml },
          attributeMapping: {
            email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
          },
        }),
      );
      expect(row.idpEntityId).toBe('https://idp.example.com/entity');
      expect(row.idpUrl).toBe('https://idp.example.com/sso/redirect');
      expect(row.x509Cert).toBe('MIITESTCERT');
      expect(row.emailAttribute).toBe(
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
      );
    });

    it('packs custom:* attrs into customAttributes JSON with prefix stripped', () => {
      const row = toSamlRow(
        provider({
          attributeMapping: {
            'custom:department': 'department',
            'custom:location': 'location',
            'custom:title': 'jobTitle',
          },
        }),
      );
      const parsed = JSON.parse(row.customAttributes);
      expect(parsed).toEqual({
        department: 'department',
        location: 'location',
        title: 'jobTitle',
      });
    });

    it('writes a name-only SAML mapping into the name column', () => {
      const row = toSamlRow(
        provider({
          attributeMapping: { name: 'fullName' },
        }),
      );
      expect(row.name).toBe('fullName');
      expect(row.firstNameAttribute).toBe('');
      expect(row.lastNameAttribute).toBe('');
    });

    it('renders proxy template placeholders', () => {
      const row = toSamlRow(provider(), {
        samlCustomAcsUrl: 'https://sso.example.com/{provider_name}/acs',
        samlCustomEntityId: 'urn:amazon:cognito:sp:{user_pool_id}',
      });
      expect(row.customAcsUrl).toBe('https://sso.example.com/test-tenant/acs');
      expect(row.customEntityId).toBe('urn:amazon:cognito:sp:us-east-1_TESTPOOL');
    });

    it('always emits idpInitiatedEnabled=TRUE (Cognito proxy migration default)', () => {
      const row = toSamlRow(provider());
      expect(row.idpInitiatedEnabled).toBe('TRUE');
    });
  });

  describe('toOidcRow', () => {
    it('returns an object with every OIDC_HEADERS key', () => {
      const row = toOidcRow(provider({ providerType: 'OIDC' }));
      for (const header of OIDC_HEADERS) {
        expect(row).toHaveProperty(header);
      }
    });

    it('normalizes Cognito oidc_issuer into a full discovery URL', () => {
      const row = toOidcRow(
        provider({
          providerType: 'OIDC',
          providerDetails: {
            client_id: 'c-123',
            client_secret: 's-456',
            oidc_issuer: 'https://login.microsoftonline.com/tenant/v2.0',
          },
        }),
      );
      expect(row.clientId).toBe('c-123');
      expect(row.clientSecret).toBe('s-456');
      expect(row.discoveryEndpoint).toBe(
        'https://login.microsoftonline.com/tenant/v2.0/.well-known/openid-configuration',
      );
    });

    it('preserves a discovery URL that already has the well-known suffix', () => {
      const row = toOidcRow(
        provider({
          providerType: 'OIDC',
          providerDetails: {
            oidc_issuer: 'https://idp.example.com/.well-known/openid-configuration',
          },
        }),
      );
      expect(row.discoveryEndpoint).toBe(
        'https://idp.example.com/.well-known/openid-configuration',
      );
    });
  });

  describe('toUserRow', () => {
    function user(overrides: Partial<CognitoUser> = {}): CognitoUser {
      return {
        userPoolId: 'us-east-1_POOL',
        username: 'alice',
        attributes: {},
        ...overrides,
      };
    }

    it('maps sub → user_id when present, otherwise username', () => {
      expect(toUserRow(user({ attributes: { sub: 's-1' } })).user_id).toBe('s-1');
      expect(toUserRow(user({ username: 'bob' })).user_id).toBe('bob');
    });

    it('splits the name attribute when no given/family is set', () => {
      const row = toUserRow(user({ attributes: { name: 'Alice Smith' } }));
      expect(row.first_name).toBe('Alice');
      expect(row.last_name).toBe('Smith');
    });

    it('always emits empty password_hash', () => {
      expect(toUserRow(user()).password_hash).toBe('');
    });
  });

  describe('toCustomAttrRows', () => {
    it('emits one row per custom:* attribute + the `name` attribute', () => {
      const rows = toCustomAttrRows(
        provider({
          attributeMapping: {
            email: 'email-claim', // not in supplementary set
            name: 'fullName',
            'custom:department': 'department',
            'custom:title': 'jobTitle',
          },
        }),
      );
      expect(rows).toHaveLength(3);
      expect(rows.find((r) => r.userPoolAttribute === 'name')).toBeDefined();
      expect(rows.find((r) => r.userPoolAttribute === 'email')).toBeUndefined();
    });
  });

  describe('buildCustomAttributesJson', () => {
    it('sorts keys + strips the custom: prefix + emits compact JSON', () => {
      const json = buildCustomAttributesJson({
        'custom:title': 'jobTitle',
        'custom:department': 'department',
        email: 'email-claim', // ignored
      });
      expect(json).toBe('{"department":"department","title":"jobTitle"}');
    });

    it('returns an empty string when no custom attrs are present', () => {
      expect(buildCustomAttributesJson({ email: 'e' })).toBe('');
    });
  });

  describe('renderTemplate', () => {
    it('substitutes every supported placeholder', () => {
      expect(
        renderTemplate('https://{provider_name}.{region}.example.com/{user_pool_id}', provider()),
      ).toBe('https://test-tenant.us-east-1.example.com/us-east-1_TESTPOOL');
    });

    it('returns an empty string when template is null/undefined/empty', () => {
      expect(renderTemplate(null, provider())).toBe('');
      expect(renderTemplate(undefined, provider())).toBe('');
      expect(renderTemplate('', provider())).toBe('');
    });
  });

  describe('type predicates + importedId', () => {
    it('isSaml / isOidc are case-insensitive', () => {
      expect(isSaml(provider({ providerType: 'saml' }))).toBe(true);
      expect(isSaml(provider({ providerType: 'SAML' }))).toBe(true);
      expect(isSaml(provider({ providerType: 'OIDC' }))).toBe(false);
      expect(isOidc(provider({ providerType: 'oidc' }))).toBe(true);
    });

    it('importedId composes pool + provider', () => {
      expect(importedId(provider({ userPoolId: 'us-east-1_X', providerName: 'y' }))).toBe(
        'us-east-1_X:y',
      );
    });
  });
});
