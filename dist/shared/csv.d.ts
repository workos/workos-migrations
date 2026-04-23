/**
 * Shared CSV helpers + column schemas for WorkOS import CSVs.
 *
 * Schemas align with the existing helpers reference repo plus the newer
 * `name` / `customAttributes` columns flagged as shipping soon.
 */
export declare const COMMON_HEADERS: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "importedId", "connectionBookmarks"];
export declare const SAML_HEADERS: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "importedId", "connectionBookmarks", "idpEntityId", "idpUrl", "x509Cert", "idpIdAttribute", "emailAttribute", "firstNameAttribute", "lastNameAttribute", "name", "customAttributes", "idpMetadataUrl", "customEntityId", "customAcsUrl", "idpInitiatedSsoEnabled", "defaultConnectionBookmarkForIdpInitiatedSso"];
export declare const OIDC_HEADERS: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "importedId", "connectionBookmarks", "clientId", "clientSecret", "discoveryEndpoint", "customRedirectUri", "name", "customAttributes"];
export declare function escapeCSVField(field: string | undefined | null): string;
export declare function createCSVRow(fields: (string | undefined | null)[]): string;
export declare function createCSV(header: readonly string[], rows: string[]): string;
/** Build a CSV from rows keyed by header name; fields missing from a row become empty strings. */
export declare function createCSVFromRecords(header: readonly string[], records: Record<string, string>[]): string;
//# sourceMappingURL=csv.d.ts.map