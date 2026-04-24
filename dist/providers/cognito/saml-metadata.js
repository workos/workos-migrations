import { XMLParser } from 'fast-xml-parser';
const HTTP_REDIRECT = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
/**
 * Extract entityID, the HTTP-Redirect SingleSignOnService URL, and the IdP
 * signing certificate from a SAML metadata XML blob.
 */
export function parseSamlMetadata(xml) {
    const empty = {
        entityId: null,
        ssoRedirectUrl: null,
        x509Cert: null,
    };
    if (!xml)
        return empty;
    let root;
    try {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            removeNSPrefix: true,
            trimValues: true,
        });
        root = parser.parse(xml);
    }
    catch {
        return empty;
    }
    const entityDescriptor = root?.EntityDescriptor;
    if (!entityDescriptor)
        return empty;
    const idpSsoRaw = entityDescriptor.IDPSSODescriptor;
    const idpSsoDescriptor = Array.isArray(idpSsoRaw) ? idpSsoRaw[0] : idpSsoRaw;
    if (!idpSsoDescriptor) {
        return {
            entityId: entityDescriptor['@_entityID'] ?? null,
            ssoRedirectUrl: null,
            x509Cert: null,
        };
    }
    const sso = asArray(idpSsoDescriptor.SingleSignOnService);
    let ssoRedirectUrl = null;
    for (const svc of sso) {
        if (svc?.['@_Binding'] === HTTP_REDIRECT) {
            ssoRedirectUrl = svc['@_Location'] ?? null;
            break;
        }
    }
    if (!ssoRedirectUrl && sso.length > 0) {
        ssoRedirectUrl = sso[0]?.['@_Location'] ?? null;
    }
    const keyDescriptors = asArray(idpSsoDescriptor.KeyDescriptor);
    let x509Cert = null;
    for (const kd of keyDescriptors) {
        const cert = kd?.KeyInfo?.X509Data?.X509Certificate;
        if (cert) {
            const raw = typeof cert === 'string' ? cert : (cert['#text'] ?? '');
            x509Cert = raw.replace(/\s+/g, '');
            if (x509Cert)
                break;
        }
    }
    return {
        entityId: entityDescriptor['@_entityID'] ?? null,
        ssoRedirectUrl,
        x509Cert,
    };
}
/** Accept either a bare issuer URL or a full discovery URL, always return a full discovery URL. */
export function normalizeDiscoveryEndpoint(issuer) {
    if (!issuer)
        return null;
    const trimmed = issuer.replace(/\/+$/, '');
    const suffix = '/.well-known/openid-configuration';
    if (trimmed.endsWith(suffix))
        return trimmed;
    return `${trimmed}${suffix}`;
}
function asArray(value) {
    if (value === undefined || value === null)
        return [];
    return Array.isArray(value) ? value : [value];
}
