import type { Auth0Connection, Auth0Organization, Auth0OrganizationConnection } from '../../shared/types.js';
import { type CustomAttrRow, type OidcRow, type ProxyRouteRow, type SamlRow, type SsoHandoffWarning } from '../../sso/handoff.js';
export type Auth0SsoProtocol = 'saml' | 'oidc';
export type Auth0SsoClassification = Auth0SsoProtocol | 'unsupported';
export interface Auth0SsoConnectionOrgBinding {
    organization: Auth0Organization;
    organizationConnection?: Auth0OrganizationConnection;
}
export interface Auth0SsoMappingInput {
    connection: Auth0Connection;
    domain: string;
    orgBindings?: Auth0SsoConnectionOrgBinding[];
    includeSecrets?: boolean;
}
export type Auth0SsoConnectionMapping = {
    status: 'mapped';
    protocol: Auth0SsoProtocol;
    importedId: string;
    samlRow?: SamlRow;
    oidcRow?: OidcRow;
    customAttributeRows: CustomAttrRow[];
    proxyRouteRow: ProxyRouteRow;
    warnings: SsoHandoffWarning[];
} | {
    status: 'skipped';
    protocol: Auth0SsoClassification;
    importedId: string;
    reason: string;
    warnings: SsoHandoffWarning[];
};
export declare const AUTH0_REDACTED_SECRET_FIELDS: readonly ["client_secret", "clientSecret", "secret", "password", "private_key", "privateKey", "requestSigningKey", "assertionEncryptionKey", "nameIdEncryptionKey", "access_token", "refresh_token", "id_token"];
export declare function classifyAuth0ConnectionProtocol(connection: Auth0Connection): Auth0SsoClassification;
export declare function buildAuth0ConnectionImportedId(connection: Auth0Connection): string;
export declare function mapAuth0ConnectionToSsoHandoff(input: Auth0SsoMappingInput): Auth0SsoConnectionMapping;
export declare function redactAuth0ConnectionSecrets(value: unknown): unknown;
