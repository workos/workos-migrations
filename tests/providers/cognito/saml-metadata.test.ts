import {
  parseSamlMetadata,
  normalizeDiscoveryEndpoint,
} from '../../../src/providers/cognito/saml-metadata';

describe('parseSamlMetadata', () => {
  const FULL_METADATA = `<?xml version="1.0"?>
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

  it('extracts entityID, HTTP-Redirect SSO URL, and signing cert', () => {
    const parsed = parseSamlMetadata(FULL_METADATA);
    expect(parsed).toEqual({
      entityId: 'https://idp.example.com/entity',
      ssoRedirectUrl: 'https://idp.example.com/sso/redirect',
      x509Cert: 'MIITESTCERT',
    });
  });

  it('prefers HTTP-Redirect over HTTP-POST when both are present', () => {
    const parsed = parseSamlMetadata(FULL_METADATA);
    expect(parsed.ssoRedirectUrl).toBe('https://idp.example.com/sso/redirect');
  });

  it('falls back to any SingleSignOnService when no HTTP-Redirect is present', () => {
    const postOnly = `<?xml version="1.0"?>
<md:EntityDescriptor entityID="https://idp.postonly.example.com/entity"
    xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
    xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <md:IDPSSODescriptor>
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>POSTONLYCERT</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
        Location="https://idp.postonly.example.com/sso/post"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;
    const parsed = parseSamlMetadata(postOnly);
    expect(parsed.ssoRedirectUrl).toBe('https://idp.postonly.example.com/sso/post');
  });

  it('strips whitespace from the X509Certificate text', () => {
    const withWhitespace = FULL_METADATA.replace('MIITESTCERT', '  MII\n  TEST\n  CERT  ');
    const parsed = parseSamlMetadata(withWhitespace);
    expect(parsed.x509Cert).toBe('MIITESTCERT');
  });

  it('handles metadata without IDPSSODescriptor (returns entityId only)', () => {
    const noDescriptor = `<?xml version="1.0"?>
<md:EntityDescriptor entityID="https://bare.example.com/entity"
    xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"/>`;
    const parsed = parseSamlMetadata(noDescriptor);
    expect(parsed).toEqual({
      entityId: 'https://bare.example.com/entity',
      ssoRedirectUrl: null,
      x509Cert: null,
    });
  });

  it('returns an all-null result for empty input', () => {
    expect(parseSamlMetadata('')).toEqual({
      entityId: null,
      ssoRedirectUrl: null,
      x509Cert: null,
    });
    expect(parseSamlMetadata(undefined)).toEqual({
      entityId: null,
      ssoRedirectUrl: null,
      x509Cert: null,
    });
  });

  it('returns an all-null result for malformed XML', () => {
    expect(parseSamlMetadata('<not-valid-xml>')).toEqual({
      entityId: null,
      ssoRedirectUrl: null,
      x509Cert: null,
    });
  });

  it('handles namespace prefix variations (no namespace)', () => {
    // Some IdPs produce SAML metadata without explicit namespace prefixes.
    const unprefixed = `<?xml version="1.0"?>
<EntityDescriptor entityID="https://idp.noprefix.example.com/entity"
    xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
    xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <IDPSSODescriptor>
    <KeyDescriptor use="signing">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>NOPREFIXCERT</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
        Location="https://idp.noprefix.example.com/sso"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;
    const parsed = parseSamlMetadata(unprefixed);
    expect(parsed.entityId).toBe('https://idp.noprefix.example.com/entity');
    expect(parsed.ssoRedirectUrl).toBe('https://idp.noprefix.example.com/sso');
    expect(parsed.x509Cert).toBe('NOPREFIXCERT');
  });

  it('picks the first IDPSSODescriptor when multiple are present', () => {
    const multipleDescriptors = `<?xml version="1.0"?>
<md:EntityDescriptor entityID="https://idp.multi-desc.example.com/entity"
    xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
    xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <md:IDPSSODescriptor>
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>FIRSTDESCCERT</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
        Location="https://idp.multi-desc.example.com/sso/first"/>
  </md:IDPSSODescriptor>
  <md:IDPSSODescriptor>
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>SECONDDESCCERT</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
        Location="https://idp.multi-desc.example.com/sso/second"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;
    const parsed = parseSamlMetadata(multipleDescriptors);
    expect(parsed.entityId).toBe('https://idp.multi-desc.example.com/entity');
    expect(parsed.ssoRedirectUrl).toBe('https://idp.multi-desc.example.com/sso/first');
    expect(parsed.x509Cert).toBe('FIRSTDESCCERT');
  });

  it('picks the first signing cert when multiple KeyDescriptors are present', () => {
    const multipleCerts = `<?xml version="1.0"?>
<md:EntityDescriptor entityID="https://idp.multi.example.com/entity"
    xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
    xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <md:IDPSSODescriptor>
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>FIRSTCERT</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:KeyDescriptor use="encryption">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>ENCRYPTIONCERT</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
        Location="https://idp.multi.example.com/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;
    expect(parseSamlMetadata(multipleCerts).x509Cert).toBe('FIRSTCERT');
  });
});

describe('normalizeDiscoveryEndpoint', () => {
  it.each([
    [
      'https://login.microsoftonline.com/tenant/v2.0',
      'https://login.microsoftonline.com/tenant/v2.0/.well-known/openid-configuration',
    ],
    [
      'https://login.microsoftonline.com/tenant/v2.0/',
      'https://login.microsoftonline.com/tenant/v2.0/.well-known/openid-configuration',
    ],
    [
      'https://login.microsoftonline.com/tenant/v2.0/.well-known/openid-configuration',
      'https://login.microsoftonline.com/tenant/v2.0/.well-known/openid-configuration',
    ],
    ['https://accounts.google.com', 'https://accounts.google.com/.well-known/openid-configuration'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeDiscoveryEndpoint(input)).toBe(expected);
  });

  it('returns null for null/undefined/empty', () => {
    expect(normalizeDiscoveryEndpoint(null)).toBeNull();
    expect(normalizeDiscoveryEndpoint(undefined)).toBeNull();
    expect(normalizeDiscoveryEndpoint('')).toBeNull();
  });

  it('strips multiple trailing slashes before appending', () => {
    expect(normalizeDiscoveryEndpoint('https://idp.example.com////')).toBe(
      'https://idp.example.com/.well-known/openid-configuration',
    );
  });
});
