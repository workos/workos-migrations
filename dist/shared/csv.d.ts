/**
 * Shared CSV helpers + column schemas for WorkOS import CSVs.
 *
 * Schemas match the official WorkOS import templates, with the new `name` and
 * `customAttributes` columns that WorkOS is adding as standard fields.
 */
/** SAML connections import template. */
export declare const SAML_HEADERS: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "idpEntityId", "idpUrl", "x509Cert", "idpMetadataUrl", "customEntityId", "customAcsUrl", "idpIdAttribute", "emailAttribute", "firstNameAttribute", "lastNameAttribute", "name", "customAttributes", "idpInitiatedEnabled", "requestSigningKey", "assertionEncryptionKey", "nameIdEncryptionKey", "importedId"];
/** OIDC connections import template. */
export declare const OIDC_HEADERS: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "clientId", "clientSecret", "discoveryEndpoint", "customRedirectUri", "name", "customAttributes", "importedId"];
/** Users import template. */
export declare const USER_HEADERS: readonly ["user_id", "email", "email_verified", "first_name", "last_name", "password_hash"];
/** Supplementary debug view: per-attribute mappings not covered by the main columns. */
export declare const CUSTOM_ATTR_HEADERS: readonly ["importedId", "organizationExternalId", "providerType", "userPoolAttribute", "idpClaim"];
export type SamlHeader = (typeof SAML_HEADERS)[number];
export type OidcHeader = (typeof OIDC_HEADERS)[number];
export type UserHeader = (typeof USER_HEADERS)[number];
export type CustomAttrHeader = (typeof CUSTOM_ATTR_HEADERS)[number];
export type SamlRow = Record<SamlHeader, string>;
export type OidcRow = Record<OidcHeader, string>;
export type UserRow = Record<UserHeader, string>;
export type CustomAttrRow = Record<CustomAttrHeader, string>;
export declare function escapeCSVField(field: string | undefined | null): string;
export declare function createCSVRow(fields: (string | undefined | null)[]): string;
export declare function createCSV(header: readonly string[], rows: string[]): string;
/** Render a list of records keyed by header name into a CSV string. */
export declare function rowsToCsv(headers: readonly string[], rows: Record<string, string | undefined | null>[]): string;
//# sourceMappingURL=csv.d.ts.map