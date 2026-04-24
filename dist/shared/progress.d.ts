import cliProgress from 'cli-progress';
import type { ImportSummary, ProgressStats } from './types.js';
export declare function createProgressBar(total: number, label?: string): cliProgress.SingleBar;
export declare function formatDuration(ms: number): string;
export declare function printImportSummary(summary: ImportSummary): void;
export declare function printProgressUpdate(stats: ProgressStats, quiet: boolean): void;
