import fs from 'node:fs';
import chalk from 'chalk';
import { validateCsv } from '../../validator/validator.js';
export function registerValidateCommand(program) {
    program
        .command('validate')
        .description('Validate a WorkOS migration CSV file')
        .requiredOption('--csv <path>', 'CSV file to validate')
        .option('--auto-fix', 'Automatically fix common issues')
        .option('--output <path>', 'Output fixed CSV (only with --auto-fix)')
        .option('--strict', 'Treat warnings as errors')
        .option('--quiet', 'Only show errors, not warnings')
        .action(async (opts) => {
        try {
            if (!fs.existsSync(opts.csv)) {
                console.error(chalk.red(`CSV file not found: ${opts.csv}`));
                process.exit(1);
            }
            const startTime = Date.now();
            if (!opts.quiet) {
                console.log(chalk.blue('Validating CSV...'));
            }
            const result = await validateCsv({
                csvPath: opts.csv,
                autoFix: opts.autoFix,
                outputPath: opts.output,
                strict: opts.strict,
                quiet: opts.quiet,
            });
            if (!opts.quiet) {
                const duration = Date.now() - startTime;
                if (result.errors.length > 0) {
                    console.log(chalk.red(`\nErrors (${result.errors.length}):`));
                    for (const err of result.errors.slice(0, 20)) {
                        const loc = err.row ? `  Row ${err.row}` : '  ';
                        console.log(chalk.red(`${loc}: ${err.message}`));
                    }
                    if (result.errors.length > 20) {
                        console.log(chalk.red(`  ... and ${result.errors.length - 20} more`));
                    }
                }
                if (result.warnings.length > 0 && !opts.quiet) {
                    console.log(chalk.yellow(`\nWarnings (${result.warnings.length}):`));
                    for (const warn of result.warnings.slice(0, 10)) {
                        const loc = warn.row ? `  Row ${warn.row}` : '  ';
                        console.log(chalk.yellow(`${loc}: ${warn.message}`));
                    }
                    if (result.warnings.length > 10) {
                        console.log(chalk.yellow(`  ... and ${result.warnings.length - 10} more`));
                    }
                }
                if (result.duplicateEmails.length > 0) {
                    console.log(chalk.yellow(`\nDuplicate emails: ${result.duplicateEmails.length}`));
                }
                if (result.fixesApplied !== undefined && result.fixesApplied > 0) {
                    console.log(chalk.green(`\nAuto-fixes applied: ${result.fixesApplied}`));
                }
                console.log(`\n${result.valid ? chalk.green('VALID') : chalk.red('INVALID')}`);
                console.log(`  Total rows: ${result.totalRows}`);
                console.log(`  Valid rows: ${result.validRows}`);
                console.log(`  Errors: ${result.errors.length}`);
                console.log(`  Warnings: ${result.warnings.length}`);
                console.log(`  Duration: ${duration}ms`);
            }
            if (!result.valid) {
                process.exit(1);
            }
        }
        catch (error) {
            console.error(chalk.red(`\nValidation failed: ${error.message}`));
            process.exit(1);
        }
    });
}
