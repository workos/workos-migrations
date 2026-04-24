import type { CSVRow } from '../shared/types.js';
export interface ValidationIssue {
    row?: number;
    column?: string;
    message: string;
    severity: 'error' | 'warning';
    fixable: boolean;
}
export interface AutoFixChange {
    row: number;
    column: string;
    original: string;
    fixed: string;
    reason: string;
}
export declare function validateHeaders(headers: string[]): ValidationIssue[];
export declare function validateRow(row: CSVRow, rowNum: number): ValidationIssue[];
