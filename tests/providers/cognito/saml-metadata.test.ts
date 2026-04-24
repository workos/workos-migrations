import { parseSamlMetadata } from '../../../src/providers/cognito/saml-metadata';

const CERT_A = 'AAAACERTA';
const CERT_B = 'BBBBCERTB';

function idpDescriptor({
  ssoUrl = 'https://idp.example.com/sso',
  cert = CERT_A,
}: { ssoUrl?: string; cert?: string } = {}): string {
  return `<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data><ds:X509Certificate>${cert}</ds:X509Certificate></ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
      Location="${ssoUrl}"/>
  </md:IDPSSODescriptor>`;
}

describe('parseSamlMetadata', () => {
  it('parses a single EntityDescriptor / IDPSSODescriptor', () => {
    const xml = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="https://idp.example.com/entity">
  ${idpDescriptor()}
</md:EntityDescriptor>`;

    const parsed = parseSamlMetadata(xml);
    expect(parsed.entityId).toBe('https://idp.example.com/entity');
    expect(parsed.ssoRedirectUrl).toBe('https://idp.example.com/sso');
    expect(parsed.x509Cert).toBe(CERT_A);
  });

  it('handles multiple IDPSSODescriptor elements parsed as an array', () => {
    // Multiple sibling IDPSSODescriptor elements cause fast-xml-parser to
    // return an array at `entityDescriptor.IDPSSODescriptor`. The parser must
    // select the first entry rather than treating the array as a single
    // descriptor (which silently drops the SSO URL and signing certificate).
    const xml = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="https://idp.example.com/entity">
  ${idpDescriptor({ ssoUrl: 'https://idp.example.com/sso/primary', cert: CERT_A })}
  ${idpDescriptor({ ssoUrl: 'https://idp.example.com/sso/secondary', cert: CERT_B })}
</md:EntityDescriptor>`;

    const parsed = parseSamlMetadata(xml);
    expect(parsed.entityId).toBe('https://idp.example.com/entity');
    expect(parsed.ssoRedirectUrl).toBe('https://idp.example.com/sso/primary');
    expect(parsed.x509Cert).toBe(CERT_A);
  });

  it('selects the HTTP-Redirect SingleSignOnService when multiple bindings are present', () => {
    const xml = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="https://idp.example.com/entity">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data><ds:X509Certificate>${CERT_A}</ds:X509Certificate></ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="https://idp.example.com/sso/post"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
      Location="https://idp.example.com/sso/redirect"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

    const parsed = parseSamlMetadata(xml);
    expect(parsed.ssoRedirectUrl).toBe('https://idp.example.com/sso/redirect');
  });

  it('returns empty fields on missing XML', () => {
    expect(parseSamlMetadata(undefined)).toEqual({
      entityId: null,
      ssoRedirectUrl: null,
      x509Cert: null,
    });
    expect(parseSamlMetadata('')).toEqual({
      entityId: null,
      ssoRedirectUrl: null,
      x509Cert: null,
    });
  });

  it('returns empty fields on malformed XML', () => {
    const parsed = parseSamlMetadata('<not-valid');
    expect(parsed).toEqual({
      entityId: null,
      ssoRedirectUrl: null,
      x509Cert: null,
    });
  });
});
