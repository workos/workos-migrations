/**
 * Strategy-specific Auth0 → WorkOS connection transforms.
 *
 * Handles each Auth0 connection strategy — samlp, oidc, waad, adfs,
 * pingfederate, google-apps, ad, auth0-adldap — with per-strategy field
 * mapping, skip rules, and manual-setup flagging.
 *
 * Output matches the shared WorkOS import templates (see src/shared/csv.ts).
 */
import type { Auth0Connection } from './client';
export interface Auth0TransformConfig {
    /** Auth0 tenant's custom domain used in the synthesized customAcsUrl / customRedirectUri. */
    customDomain?: string;
    /** Prefix for synthesized SAML customEntityId. Example: "urn:acme:sso:" */
    entityIdPrefix?: string;
    /** Prefix applied to organizationName for migrated connections. Default: "[MIGRATED] sso-". */
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
export declare function transformAuth0Connections(connections: Auth0Connection[], config: Auth0TransformConfig): TransformResult;
export declare function ensureWellKnown(url: string): string;
export declare function ensureHttps(url: string): string;
//# sourceMappingURL=transform.d.ts.map