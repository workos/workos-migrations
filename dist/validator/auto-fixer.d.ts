import type { CSVRow } from '../shared/types.js';
import type { AutoFixChange } from './rules.js';
/**
 * Apply auto-fixes to a CSV row, returning the fixed row and a list of changes.
 */
export declare function autoFixRow(row: CSVRow, rowNum: number): {
    fixed: CSVRow;
    changes: AutoFixChange[];
};
