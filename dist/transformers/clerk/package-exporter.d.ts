export interface ClerkPackageExportOptions {
    /** Path to the Clerk dashboard CSV export. */
    input: string;
    /** Output directory for the package. */
    outputDir: string;
    /** Optional org mapping CSV (clerk_user_id,org_external_id,org_name). */
    orgMapping?: string;
    /** Optional role mapping CSV (clerk_user_id,role_slug). */
    roleMapping?: string;
    /** Source tenant identifier to record in the manifest. */
    sourceTenant?: string;
    /** Suppress progress output. */
    quiet?: boolean;
}
export interface ClerkPackageWarning {
    timestamp: string;
    code: string;
    message: string;
    clerk_user_id?: string;
    email?: string;
}
export interface ClerkPackageSkipped {
    timestamp: string;
    clerk_user_id?: string;
    email?: string;
    reason: string;
}
export interface ClerkPackageStats {
    totalUsers: number;
    totalOrgs: number;
    totalMemberships: number;
    roleDefinitions: number;
    userRoleAssignments: number;
    uploadUsers: number;
    uploadOrganizations: number;
    uploadMemberships: number;
    skippedUsers: number;
    warnings: ClerkPackageWarning[];
    skipped: ClerkPackageSkipped[];
}
export declare function exportClerkPackage(options: ClerkPackageExportOptions): Promise<ClerkPackageStats>;
