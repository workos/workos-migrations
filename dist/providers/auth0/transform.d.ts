/**
 * Strategy-specific Auth0 → WorkOS connection transforms.
 *
 * Handles each Auth0 connection strategy — samlp, oidc, waad, adfs,
 * pingfederate, google-apps, ad, auth0-adldap — with per-strategy field
 * mapping, skip rules, and manual-setup flagging.
 */
import type { Auth0Connection, Auth0Client as Auth0AppClient } from './client';
export interface Auth0TransformConfig {
    /** Auth0 tenant's custom domain used in the synthesized customAcsUrl / customRedirectUri. */
    customDomain?: string;
    /** Prefix for synthesized SAML customEntityId. Example: "urn:acme:sso:" */
    entityIdPrefix?: string;
    /** Map of Auth0 client_id → WorkOS bookmark slug. Used for connectionBookmarks column. */
    bookmarkSlugMap?: Record<string, string>;
    /** Prefix applied to organizationName for migrated connections. Default: "[MIGRATED] sso-" */
    organizationNamePrefix?: string;
}
export interface SkippedConnection {
    connectionName: string;
    reason: string;
    type: 'SAML' | 'OIDC';
}
export interface ManualSetupConnection {
    connectionName: string;
    strategy: string;
    reason: string;
}
export interface TransformResult {
    samlCsv: string;
    oidcCsv: string;
    samlCount: number;
    oidcCount: number;
    skipped: SkippedConnection[];
    manualSetup: ManualSetupConnection[];
    samlIdpInitiatedDisabled: string[];
}
export declare function transformAuth0Connections(connections: Auth0Connection[], clients: Auth0AppClient[] | undefined, config: Auth0TransformConfig): TransformResult;
//# sourceMappingURL=transform.d.ts.map