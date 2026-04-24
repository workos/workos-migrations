export interface RetryResult {
    totalRetryable: number;
    rowsWritten: number;
    deduplicatedCount: number;
}
/**
 * Generate a retry CSV containing only rows that had retryable errors.
 *
 * Reads the error JSONL to find retryable emails, then filters the original CSV
 * to include only those rows.
 */
export declare function generateRetryCsv(errorsPath: string, originalCsvPath: string, outputCsvPath: string, dedupe: boolean): Promise<RetryResult>;
