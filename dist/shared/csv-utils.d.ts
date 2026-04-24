import type { CSVRow } from './types.js';
/**
 * Stream-parse a CSV file row by row. Returns an async iterable of CSVRow objects.
 * Memory-efficient: only one row in memory at a time.
 */
export declare function streamCSV(filePath: string): AsyncIterable<CSVRow>;
/**
 * Count the total number of data rows in a CSV file (excluding header).
 */
export declare function countCSVRows(filePath: string): Promise<number>;
/**
 * Create a streaming CSV writer. Call write() for each row, then end().
 */
export declare function createCSVWriter(filePath: string, columns: string[]): {
    write: (row: Record<string, string>) => void;
    end: () => Promise<void>;
};
/**
 * Parse a metadata JSON string into a Record<string, string>.
 * Returns undefined if the input is empty or not valid JSON.
 */
export declare function parseMetadata(raw: string | undefined): Record<string, string> | undefined;
/**
 * Parse a boolean-like CSV value. Accepts true/false/yes/no/1/0 (case-insensitive).
 */
export declare function parseBooleanField(value: string | boolean | undefined): boolean | undefined;
/**
 * Parse role slugs from a CSV field. Supports comma-separated or JSON array format.
 */
export declare function parseRoleSlugs(value: string | undefined): string[] | undefined;
/**
 * Convert a CSVRow to a UserRecord (parsed and normalized).
 */
export declare function csvRowToUserRecord(row: CSVRow): import('./types.js').UserRecord;
