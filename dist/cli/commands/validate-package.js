import fs from 'node:fs';
import chalk from 'chalk';
import { validateMigrationPackage } from '../../package/validator.js';
import * as logger from '../../shared/logger.js';
export function registerValidatePackageCommand(program) {
    program
        .command('validate-package')
        .description('Validate a migration package directory against the schema contract')
        .argument('<dir>', 'Migration package directory')
        .option('--no-counts', 'Skip CSV/JSONL row count verification (manifest-only check)')
        .option('--no-headers', 'Skip CSV header verification')
        .option('--quiet', 'Suppress success messages')
        .option('--json', 'Emit machine-readable JSON output')
        .action(async (dir, opts) => {
        try {
            if (!fs.existsSync(dir)) {
                logger.error(`Package directory not found: ${dir}`);
                process.exit(1);
            }
            const validation = await validateMigrationPackage(dir, {
                requireFiles: true,
                validateCsvHeaders: opts.headers !== false,
                validateCounts: opts.counts !== false,
            });
            if (opts.json) {
                process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
                process.exit(validation.valid ? 0 : 1);
            }
            if (validation.errors.length === 0 && validation.warnings.length === 0) {
                if (!opts.quiet) {
                    console.log(chalk.green(`  ✓ Package is valid: ${dir}`));
                    if (validation.manifest) {
                        console.log(chalk.gray(`    provider:   ${validation.manifest.provider}`));
                        const counts = validation.manifest.entitiesExported ?? {};
                        for (const [entity, count] of Object.entries(counts)) {
                            console.log(chalk.gray(`    ${entity.padEnd(24)} ${count}`));
                        }
                    }
                }
                return;
            }
            if (validation.errors.length > 0) {
                console.error(chalk.red(`  ✗ Package validation failed (${validation.errors.length} error(s))`));
                for (const issue of validation.errors) {
                    console.error(chalk.red(`    [${issue.code}] ${issue.message}`));
                }
            }
            if (validation.warnings.length > 0) {
                console.warn(chalk.yellow(`  Validation warnings (${validation.warnings.length}):`));
                for (const issue of validation.warnings) {
                    console.warn(chalk.yellow(`    [${issue.code}] ${issue.message}`));
                }
            }
            process.exit(validation.errors.length === 0 ? 0 : 1);
        }
        catch (error) {
            logger.error(`validate-package failed: ${error.message}`);
            process.exit(1);
        }
    });
}
