export declare const SAML_HEADERS: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "idpEntityId", "idpUrl", "x509Cert", "idpMetadataUrl", "customEntityId", "customAcsUrl", "idpIdAttribute", "emailAttribute", "firstNameAttribute", "lastNameAttribute", "name", "customAttributes", "idpInitiatedEnabled", "requestSigningKey", "assertionEncryptionKey", "nameIdEncryptionKey", "importedId"];
export declare const OIDC_HEADERS: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "clientId", "clientSecret", "discoveryEndpoint", "customRedirectUri", "name", "customAttributes", "importedId"];
export declare const CUSTOM_ATTR_HEADERS: readonly ["importedId", "organizationExternalId", "providerType", "userPoolAttribute", "idpClaim"];
/**
 * WorkOS users import template. `password_hash` is intentionally written
 * blank — Cognito does not expose password hashes. Users that relied on
 * email/password in Cognito will need to reset their password after
 * migration (or rely on SSO + JIT provisioning via the migration proxy).
 */
export declare const USER_HEADERS: readonly ["user_id", "email", "email_verified", "first_name", "last_name", "password_hash"];
export interface CognitoProvider {
    userPoolId: string;
    providerName: string;
    providerType: string;
    region: string;
    providerDetails: Record<string, string>;
    attributeMapping: Record<string, string>;
    idpIdentifiers: string[];
}
export declare function isSaml(p: CognitoProvider): boolean;
export declare function isOidc(p: CognitoProvider): boolean;
export declare function importedId(p: CognitoProvider): string;
export interface ProxyTemplates {
    samlCustomAcsUrl?: string | null;
    samlCustomEntityId?: string | null;
    oidcCustomRedirectUri?: string | null;
}
/** Default pattern matches what customers' IdPs already have configured as the Cognito SP. */
export declare const DEFAULT_SAML_CUSTOM_ENTITY_ID_TEMPLATE = "urn:amazon:cognito:sp:{user_pool_id}";
export declare function renderTemplate(template: string | null | undefined, p: CognitoProvider): string;
/** Cognito 'custom:<name>' mappings -> compact JSON blob with 'custom:' prefix stripped. */
export declare function buildCustomAttributesJson(attrs: Record<string, string>): string;
export type SamlRow = Record<(typeof SAML_HEADERS)[number], string>;
export type OidcRow = Record<(typeof OIDC_HEADERS)[number], string>;
export type CustomAttrRow = Record<(typeof CUSTOM_ATTR_HEADERS)[number], string>;
export type UserRow = Record<(typeof USER_HEADERS)[number], string>;
export interface CognitoUser {
    userPoolId: string;
    /** Cognito's login identifier — can be email, phone, or sub. */
    username: string;
    /** Flattened attribute map — { email: 'x@y.com', sub: '...', given_name: 'Jane' }. */
    attributes: Record<string, string>;
    userStatus?: string;
    enabled?: boolean;
}
/**
 * Map a Cognito user into the WorkOS users.csv template.
 *
 *   user_id        → Cognito `sub` attribute (stable unique ID), falls back to username
 *   email          → Cognito `email` attribute
 *   email_verified → Cognito `email_verified` attribute (Cognito returns 'true'/'false' strings)
 *   first_name     → `given_name`, falling back to the first whitespace-split token of `name`
 *   last_name      → `family_name`, falling back to the remaining tokens of `name`
 *   password_hash  → always blank (Cognito does not export password hashes)
 */
export declare function toUserRow(u: CognitoUser): UserRow;
/** Whitespace-split a full name into first/last halves. Multi-word last names stay intact. */
export declare function splitName(name: string): {
    first: string;
    last: string;
};
export declare function toSamlRow(p: CognitoProvider, proxy?: ProxyTemplates): SamlRow;
export declare function toOidcRow(p: CognitoProvider, proxy?: ProxyTemplates): OidcRow;
export declare function toCustomAttrRows(p: CognitoProvider): CustomAttrRow[];
/** Produce a CSV string from headers + rows. Handles commas, quotes, and newlines. */
export declare function rowsToCsv(headers: readonly string[], rows: Record<string, string>[]): string;
//# sourceMappingURL=workos-csv.d.ts.map