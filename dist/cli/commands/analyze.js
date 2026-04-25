import fs from 'node:fs';
import chalk from 'chalk';
import { analyzeErrors } from '../../analyzer/analyzer.js';
import { generateRetryCsv } from '../../analyzer/retry-generator.js';
export function registerAnalyzeCommand(program) {
    program
        .command('analyze')
        .description('Analyze import errors and generate retry plan')
        .requiredOption('--errors <path>', 'Error JSONL file from import')
        .option('--retry-csv <path>', 'Generate retry CSV for retryable errors')
        .option('--original-csv <path>', 'Original CSV (needed for --retry-csv)')
        .option('--dedupe', 'Deduplicate retry CSV by email')
        .option('--json', 'Output analysis as JSON')
        .option('--quiet', 'Suppress progress output')
        .action(async (opts) => {
        try {
            if (!fs.existsSync(opts.errors)) {
                console.error(chalk.red(`Errors file not found: ${opts.errors}`));
                process.exit(1);
            }
            if (opts.retryCsv && !opts.originalCsv) {
                console.error(chalk.red('--original-csv is required when using --retry-csv'));
                process.exit(1);
            }
            if (opts.originalCsv && !fs.existsSync(opts.originalCsv)) {
                console.error(chalk.red(`Original CSV not found: ${opts.originalCsv}`));
                process.exit(1);
            }
            const startTime = Date.now();
            if (!opts.quiet) {
                console.log(chalk.blue('Analyzing import errors...'));
            }
            const result = await analyzeErrors(opts.errors);
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            }
            else if (!opts.quiet) {
                const duration = Date.now() - startTime;
                console.log(chalk.blue(`\nError Analysis Report`));
                console.log(`  Total errors: ${result.totalErrors}`);
                console.log(chalk.green(`  Retryable: ${result.retryableCount}`));
                console.log(chalk.red(`  Non-retryable: ${result.nonRetryableCount}`));
                console.log(`  Error patterns: ${result.errorGroups.length}`);
                console.log(chalk.blue('\nError Groups:'));
                for (const group of result.errorGroups) {
                    const retryTag = group.retryable
                        ? chalk.green('[retryable]')
                        : chalk.red('[non-retryable]');
                    console.log(`\n  ${retryTag} ${group.pattern}`);
                    console.log(`    Count: ${group.count} | Type: ${group.errorType}${group.httpStatus ? ` | HTTP ${group.httpStatus}` : ''}`);
                    console.log(`    Suggestion: ${group.suggestion}`);
                }
                if (result.suggestions.length > 0) {
                    console.log(chalk.blue('\nFix Suggestions:'));
                    for (const s of result.suggestions) {
                        console.log(`  - ${s}`);
                    }
                }
                console.log(`\n  Duration: ${duration}ms`);
            }
            // Generate retry CSV if requested
            if (opts.retryCsv) {
                if (!opts.quiet) {
                    console.log(chalk.blue('\nGenerating retry CSV...'));
                }
                const retryResult = await generateRetryCsv(opts.errors, opts.originalCsv, opts.retryCsv, opts.dedupe || false);
                if (!opts.quiet) {
                    console.log(chalk.green(`Retry CSV generated: ${opts.retryCsv}`));
                    console.log(`  Retryable emails: ${retryResult.totalRetryable}`);
                    console.log(`  Rows written: ${retryResult.rowsWritten}`);
                    if (retryResult.deduplicatedCount > 0) {
                        console.log(`  Deduplicated: ${retryResult.deduplicatedCount}`);
                    }
                }
            }
        }
        catch (error) {
            console.error(chalk.red(`\nAnalysis failed: ${error.message}`));
            process.exit(1);
        }
    });
}
