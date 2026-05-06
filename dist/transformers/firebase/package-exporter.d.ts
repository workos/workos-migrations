import type { FirebaseScryptConfig, NameSplitStrategy } from '../../shared/types.js';
export interface FirebasePackageExportOptions {
    input: string;
    outputDir: string;
    scryptConfig?: FirebaseScryptConfig;
    nameSplitStrategy: NameSplitStrategy;
    includeDisabled?: boolean;
    skipPasswords?: boolean;
    orgMapping?: string;
    roleMapping?: string;
    sourceTenant?: string;
    quiet?: boolean;
}
export interface FirebasePackageWarning {
    timestamp: string;
    code: string;
    message: string;
    firebase_uid?: string;
    email?: string;
}
export interface FirebasePackageSkipped {
    timestamp: string;
    firebase_uid?: string;
    email?: string;
    reason: string;
}
export interface FirebasePackageStats {
    totalUsers: number;
    totalOrgs: number;
    totalMemberships: number;
    roleDefinitions: number;
    userRoleAssignments: number;
    uploadUsers: number;
    uploadOrganizations: number;
    uploadMemberships: number;
    skippedUsers: number;
    warnings: FirebasePackageWarning[];
    skipped: FirebasePackageSkipped[];
}
export declare function exportFirebasePackage(options: FirebasePackageExportOptions): Promise<FirebasePackageStats>;
