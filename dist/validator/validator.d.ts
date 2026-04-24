import type { ValidationIssue } from './rules.js';
export interface ValidationResult {
    valid: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    totalRows: number;
    validRows: number;
    fixesApplied?: number;
    duplicateEmails: string[];
}
export interface ValidateOptions {
    csvPath: string;
    autoFix?: boolean;
    outputPath?: string;
    strict?: boolean;
    quiet?: boolean;
}
/**
 * 3-pass CSV validator.
 *
 * Pass 1: Header validation (required columns, unknown columns)
 * Pass 2: Row validation (email, metadata, password, boolean, org conflicts) + auto-fix
 * Pass 3: Cross-row checks (duplicate emails, duplicate email+org combos)
 */
export declare function validateCsv(options: ValidateOptions): Promise<ValidationResult>;
