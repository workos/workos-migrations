import type { WorkOS } from '@workos-inc/node';
import { type MigrationPackageValidationIssue } from '../package/validator.js';
export type EntityImportStatus = 'imported' | 'skipped' | 'planned' | 'handoff' | 'unsupported' | 'absent';
export interface ImportEntityResult {
    status: EntityImportStatus;
    total?: number;
    succeeded?: number;
    failed?: number;
    warnings?: string[];
    notes?: string[];
    details?: Record<string, unknown>;
}
export interface ImportPackageOptions {
    packageDir: string;
    /** When provided, used instead of constructing a new WorkOS client. */
    workos?: WorkOS;
    /** When dryRun is true, the orchestrator only plans and does not call WorkOS. */
    dryRun?: boolean;
    /** When true, prints progress to logger. */
    quiet?: boolean;
    /** Concurrency hint forwarded to runImport. */
    concurrency?: number;
    /** Rate limit hint forwarded to runImport. */
    rateLimit?: number;
    /** Where the importer writes per-row errors. */
    errorsPath?: string;
    /** Where to write the workos_import_summary.json. Defaults to <packageDir>/workos_import_summary.json. */
    summaryPath?: string;
}
export interface ImportPackagePlan {
    packageDir: string;
    manifestProvider: string;
    hasUsersCsv: boolean;
    hasOrganizationsCsv: boolean;
    hasMembershipsCsv: boolean;
    hasRoleDefinitionsCsv: boolean;
    hasRoleAssignmentsCsv: boolean;
    hasTotpCsv: boolean;
    hasSso: boolean;
    expectedCounts: Record<string, number>;
    validationErrors: MigrationPackageValidationIssue[];
    validationWarnings: MigrationPackageValidationIssue[];
}
export interface ImportPackageSummary {
    packageDir: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    dryRun: boolean;
    manifestProvider: string;
    plan: ImportPackagePlan;
    organizations: ImportEntityResult;
    users: ImportEntityResult;
    memberships: ImportEntityResult;
    roleDefinitions: ImportEntityResult;
    roleAssignments: ImportEntityResult;
    totpFactors: ImportEntityResult;
    ssoConnections: ImportEntityResult;
    warnings: string[];
}
export declare function planImportPackage(packageDir: string): Promise<ImportPackagePlan>;
export declare function importPackage(options: ImportPackageOptions): Promise<ImportPackageSummary>;
