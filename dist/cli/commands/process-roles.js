import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { createWorkOSClient } from '../../shared/workos-client.js';
import { processRoleDefinitions, assignRolesToUsers } from '../../roles/processor.js';
export function registerProcessRolesCommand(program) {
    program
        .command('process-role-definitions')
        .description('Create roles and assign permissions in WorkOS')
        .requiredOption('--definitions <path>', 'Role definitions CSV')
        .option('--user-mapping <path>', 'User-role mapping CSV for bulk assignment')
        .option('--org-id <id>', 'Target organization ID')
        .option('--dry-run', 'Show what would be created without making changes')
        .option('--quiet', 'Suppress progress output')
        .action(async (opts) => {
        try {
            const definitionsPath = path.resolve(opts.definitions);
            if (!fs.existsSync(definitionsPath)) {
                console.error(chalk.red(`Definitions file not found: ${definitionsPath}`));
                process.exit(1);
            }
            if (opts.userMapping && !fs.existsSync(path.resolve(opts.userMapping))) {
                console.error(chalk.red(`User mapping file not found: ${opts.userMapping}`));
                process.exit(1);
            }
            if (opts.userMapping && !opts.orgId) {
                console.error(chalk.red('--org-id is required when using --user-mapping'));
                process.exit(1);
            }
            if (!opts.quiet) {
                console.log(chalk.blue('WorkOS Role Definitions Processor'));
                console.log(`  Definitions: ${definitionsPath}`);
                if (opts.orgId)
                    console.log(`  Org ID: ${opts.orgId}`);
                if (opts.userMapping)
                    console.log(`  User mapping: ${opts.userMapping}`);
                if (opts.dryRun)
                    console.log(chalk.yellow('  Mode: DRY RUN'));
                console.log();
            }
            // Process role definitions
            const summary = await processRoleDefinitions(definitionsPath, {
                orgId: opts.orgId,
                dryRun: opts.dryRun || false,
            });
            if (!opts.quiet) {
                console.log(chalk.blue('\nRole Processing Summary'));
                console.log(`  Total definitions: ${summary.total}`);
                console.log(chalk.green(`  Created: ${summary.created}`));
                console.log(`  Already exist: ${summary.alreadyExist}`);
                if (summary.skipped > 0) {
                    console.log(chalk.yellow(`  Skipped: ${summary.skipped}`));
                }
                if (summary.errors > 0) {
                    console.log(chalk.red(`  Errors: ${summary.errors}`));
                }
                if (summary.warnings.length > 0) {
                    console.log(chalk.yellow(`\nWarnings (${summary.warnings.length}):`));
                    for (const w of summary.warnings.slice(0, 10)) {
                        console.log(chalk.yellow(`  - ${w}`));
                    }
                    if (summary.warnings.length > 10) {
                        console.log(chalk.yellow(`  ... and ${summary.warnings.length - 10} more`));
                    }
                }
            }
            // Assign roles to users if mapping provided
            if (opts.userMapping) {
                if (!opts.quiet) {
                    console.log(chalk.blue('\nAssigning roles to users...'));
                }
                const workos = opts.dryRun ? createWorkOSClient('dry-run-key') : createWorkOSClient();
                const assignResult = await assignRolesToUsers(path.resolve(opts.userMapping), workos, {
                    orgId: opts.orgId,
                    dryRun: opts.dryRun || false,
                });
                if (!opts.quiet) {
                    console.log(chalk.blue('\nRole Assignment Summary'));
                    console.log(`  Total mappings: ${assignResult.totalMappings}`);
                    console.log(chalk.green(`  Assigned: ${assignResult.assigned}`));
                    if (assignResult.skipped > 0)
                        console.log(`  Skipped: ${assignResult.skipped}`);
                    if (assignResult.userNotFound > 0) {
                        console.log(chalk.yellow(`  User not found: ${assignResult.userNotFound}`));
                    }
                    if (assignResult.failures > 0) {
                        console.log(chalk.red(`  Failures: ${assignResult.failures}`));
                    }
                }
                if (assignResult.failures > 0) {
                    process.exit(1);
                }
            }
            if (summary.errors > 0) {
                process.exit(1);
            }
        }
        catch (error) {
            console.error(chalk.red(`\nRole processing failed: ${error.message}`));
            process.exit(1);
        }
    });
}
