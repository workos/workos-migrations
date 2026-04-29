import { type MigrationPackageManifest } from './manifest.js';
export type ValidationSeverity = 'error' | 'warning';
export interface MigrationPackageValidationIssue {
    severity: ValidationSeverity;
    code: string;
    message: string;
    file?: string;
    field?: string;
}
export interface MigrationPackageValidationResult {
    valid: boolean;
    errors: MigrationPackageValidationIssue[];
    warnings: MigrationPackageValidationIssue[];
    manifest?: MigrationPackageManifest;
}
export interface ValidateMigrationPackageOptions {
    requireFiles?: boolean;
    validateCsvHeaders?: boolean;
    validateCounts?: boolean;
}
export declare function validateMigrationPackage(rootDir: string, options?: ValidateMigrationPackageOptions): Promise<MigrationPackageValidationResult>;
export declare function validateMigrationPackageManifest(manifest: MigrationPackageManifest): MigrationPackageValidationIssue[];
export declare function assertValidMigrationPackage(rootDir: string, options?: ValidateMigrationPackageOptions): Promise<MigrationPackageManifest>;
