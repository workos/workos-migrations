export declare const SAML_HEADERS: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "idpEntityId", "idpUrl", "x509Cert", "idpMetadataUrl", "customEntityId", "customAcsUrl", "idpIdAttribute", "emailAttribute", "firstNameAttribute", "lastNameAttribute", "name", "customAttributes", "idpInitiatedEnabled", "requestSigningKey", "assertionEncryptionKey", "nameIdEncryptionKey", "importedId"];
export declare const OIDC_HEADERS: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "clientId", "clientSecret", "discoveryEndpoint", "customRedirectUri", "name", "customAttributes", "importedId"];
export declare const CUSTOM_ATTR_HEADERS: readonly ["importedId", "organizationExternalId", "providerType", "userPoolAttribute", "idpClaim"];
export declare const PROXY_ROUTE_HEADERS: readonly ["importedId", "organizationExternalId", "provider", "protocol", "sourceAcsUrl", "sourceEntityId", "sourceRedirectUri", "customAcsUrl", "customEntityId", "customRedirectUri", "workosConnectionId", "workosAcsUrl", "cutoverState", "notes"];
export type SamlRow = Record<(typeof SAML_HEADERS)[number], string>;
export type OidcRow = Record<(typeof OIDC_HEADERS)[number], string>;
export type CustomAttrRow = Record<(typeof CUSTOM_ATTR_HEADERS)[number], string>;
export type ProxyRouteRow = Record<(typeof PROXY_ROUTE_HEADERS)[number], string>;
export type SamlRowInput = Partial<SamlRow>;
export type OidcRowInput = Partial<OidcRow>;
export type CustomAttrRowInput = Partial<CustomAttrRow>;
export type ProxyRouteRowInput = Partial<ProxyRouteRow>;
export declare function createSamlConnectionRow(input?: SamlRowInput): SamlRow;
export declare function createOidcConnectionRow(input?: OidcRowInput): OidcRow;
export declare function createCustomAttributeMappingRow(input?: CustomAttrRowInput): CustomAttrRow;
export declare function createProxyRouteRow(input?: ProxyRouteRowInput): ProxyRouteRow;
export declare function writeSamlConnectionsCsv(filePath: string, rows: SamlRowInput[]): Promise<number>;
export declare function writeOidcConnectionsCsv(filePath: string, rows: OidcRowInput[]): Promise<number>;
export declare function writeCustomAttributeMappingsCsv(filePath: string, rows: CustomAttrRowInput[]): Promise<number>;
export declare function writeProxyRoutesCsv(filePath: string, rows: ProxyRouteRowInput[]): Promise<number>;
export declare function writeCsvRows(filePath: string, headers: readonly string[], rows: Record<string, unknown>[]): Promise<number>;
/** Produce a CSV string from headers + rows. Handles commas, quotes, and newlines. */
export declare function rowsToCsv(headers: readonly string[], rows: Record<string, unknown>[]): string;
export type SsoWarningCode = 'missing_domains' | 'secrets_redacted' | 'multi_org_connection_consolidated' | 'unsupported_connection_protocol';
export interface SsoHandoffWarning {
    code: SsoWarningCode;
    message: string;
    provider?: string;
    protocol?: string;
    importedId?: string;
    organizationExternalId?: string;
    details?: Record<string, unknown>;
}
export declare function missingDomainsWarning(input: {
    provider: string;
    protocol: string;
    importedId?: string;
    organizationExternalId?: string;
    organizationName?: string;
}): SsoHandoffWarning;
export declare function redactedSecretsWarning(input: {
    provider: string;
    file?: string;
    fields: string[];
    importedId?: string;
    protocol?: string;
}): SsoHandoffWarning;
export declare function multiOrgConnectionConsolidationWarning(input: {
    provider: string;
    protocol: string;
    importedId: string;
    organizationExternalId: string;
    sourceOrganizationIds: string[];
    domains: string[];
}): SsoHandoffWarning;
export declare function unsupportedConnectionProtocolWarning(input: {
    provider: string;
    protocol: string;
    importedId?: string;
    strategy?: string;
    reason?: string;
}): SsoHandoffWarning;
