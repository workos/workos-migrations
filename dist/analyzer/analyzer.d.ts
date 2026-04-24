import type { ErrorRecord } from '../shared/types.js';
export interface AnalysisResult {
    totalErrors: number;
    errorGroups: ErrorGroup[];
    retryableCount: number;
    nonRetryableCount: number;
    suggestions: string[];
}
export interface ErrorGroup {
    pattern: string;
    count: number;
    errorType: string;
    httpStatus?: number;
    retryable: boolean;
    suggestion: string;
    examples: ErrorRecord[];
}
/**
 * Analyze error JSONL file, grouping errors by pattern and classifying retryability.
 */
export declare function analyzeErrors(errorsPath: string): Promise<AnalysisResult>;
