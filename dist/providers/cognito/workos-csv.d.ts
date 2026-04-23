import { SAML_HEADERS, OIDC_HEADERS, USER_HEADERS, CUSTOM_ATTR_HEADERS, SamlRow, OidcRow, UserRow, CustomAttrRow, rowsToCsv } from '../../shared/csv';
export { SAML_HEADERS, OIDC_HEADERS, USER_HEADERS, CUSTOM_ATTR_HEADERS, rowsToCsv };
export type { SamlRow, OidcRow, UserRow, CustomAttrRow };
export interface CognitoProvider {
    userPoolId: string;
    providerName: string;
    providerType: string;
    region: string;
    providerDetails: Record<string, string>;
    attributeMapping: Record<string, string>;
    idpIdentifiers: string[];
}
export interface CognitoUser {
    userPoolId: string;
    /** Cognito's login identifier — can be email, phone, or sub. */
    username: string;
    /** Flattened attribute map — { email: 'x@y.com', sub: '...', given_name: 'Jane' }. */
    attributes: Record<string, string>;
    userStatus?: string;
    enabled?: boolean;
}
export interface ProxyTemplates {
    samlCustomAcsUrl?: string | null;
    samlCustomEntityId?: string | null;
    oidcCustomRedirectUri?: string | null;
}
/** Default matches the Cognito SP entity ID that customer IdPs already have configured. */
export declare const DEFAULT_SAML_CUSTOM_ENTITY_ID_TEMPLATE = "urn:amazon:cognito:sp:{user_pool_id}";
export declare function isSaml(p: CognitoProvider): boolean;
export declare function isOidc(p: CognitoProvider): boolean;
export declare function importedId(p: CognitoProvider): string;
export declare function renderTemplate(template: string | null | undefined, p: CognitoProvider): string;
/** 'custom:<name>' attribute mappings → compact JSON with the 'custom:' prefix stripped. */
export declare function buildCustomAttributesJson(attrs: Record<string, string>): string;
export declare function toUserRow(u: CognitoUser): UserRow;
export declare function toSamlRow(p: CognitoProvider, proxy?: ProxyTemplates): SamlRow;
export declare function toOidcRow(p: CognitoProvider, proxy?: ProxyTemplates): OidcRow;
export declare function toCustomAttrRows(p: CognitoProvider): CustomAttrRow[];
