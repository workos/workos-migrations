import { type CognitoProvider, type CognitoUser, type ProxyTemplates } from './workos-csv.js';
export type CognitoOrgStrategy = 'user-pool' | 'connection' | 'none';
export interface CognitoPackageExportOptions {
    outputDir: string;
    entities?: string[];
    /** Strategy for mapping Cognito users to WorkOS organizations. Default: user-pool. */
    orgStrategy?: CognitoOrgStrategy;
    /** Skip federated (EXTERNAL_PROVIDER) users. Default: true (will be JIT-provisioned by WorkOS). */
    skipExternalProviderUsers?: boolean;
    /** Proxy template overrides. */
    proxy?: ProxyTemplates;
    /** Suppress progress output. */
    quiet?: boolean;
}
export interface CognitoPackageInputs {
    /** Identity providers fetched from each user pool. Optional when only exporting users. */
    providers?: CognitoProvider[];
    /** Cognito users fetched from each user pool. Optional when only exporting SSO. */
    users?: CognitoUser[];
}
export interface CognitoPackageWarning {
    timestamp: string;
    code: string;
    message: string;
    user_pool_id?: string;
    provider_name?: string;
    email?: string;
    details?: Record<string, unknown>;
}
export interface CognitoPackageSkipped {
    timestamp: string;
    user_pool_id: string;
    username: string;
    email?: string;
    reason: string;
}
export interface CognitoPackageStats {
    totalUsers: number;
    totalOrgs: number;
    totalMemberships: number;
    samlConnections: number;
    oidcConnections: number;
    customAttributeMappings: number;
    proxyRoutes: number;
    uploadUsers: number;
    uploadOrganizations: number;
    uploadMemberships: number;
    skippedUsers: number;
    warnings: CognitoPackageWarning[];
    skipped: CognitoPackageSkipped[];
}
export interface ExportCognitoPackageResult {
    outputDir: string;
    stats: CognitoPackageStats;
}
export declare function exportCognitoPackage(inputs: CognitoPackageInputs, options: CognitoPackageExportOptions): Promise<ExportCognitoPackageResult>;
