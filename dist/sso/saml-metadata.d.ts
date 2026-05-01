export interface ParsedSamlMetadata {
    entityId: string | null;
    ssoRedirectUrl: string | null;
    x509Cert: string | null;
}
/**
 * Extract entityID, the HTTP-Redirect SingleSignOnService URL, and the IdP
 * signing certificate from a SAML metadata XML blob.
 */
export declare function parseSamlMetadata(xml: string | undefined): ParsedSamlMetadata;
/** Accept either a bare issuer URL or a full discovery URL, always return a full discovery URL. */
export declare function normalizeDiscoveryEndpoint(issuer: string | undefined | null): string | null;
