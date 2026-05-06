import path from 'node:path';
import fsp from 'node:fs/promises';
import chalk from 'chalk';
import { createMigrationPackage } from '../../package/writer.js';
import * as logger from '../../shared/logger.js';
export function registerGeneratePackageTemplateCommand(program) {
    program
        .command('generate-package-template')
        .description('Generate an empty migration package skeleton for manual or scripted population')
        .requiredOption('--output-dir <dir>', 'Output directory for the package skeleton')
        .option('--provider <name>', 'Provider name to record in the manifest', 'csv')
        .option('--entities <entities>', 'Comma-separated entities to mark as requested in the manifest', 'users,organizations,memberships')
        .option('--source-tenant <name>', 'Optional source tenant identifier to record')
        .option('--force', 'Overwrite an existing directory')
        .option('--quiet', 'Suppress progress output')
        .action(async (opts) => {
        try {
            const outputDir = path.resolve(opts.outputDir);
            if (!opts.force) {
                try {
                    const stat = await fsp.stat(outputDir);
                    if (stat.isDirectory()) {
                        const entries = await fsp.readdir(outputDir);
                        if (entries.length > 0) {
                            logger.error(`Output directory is not empty: ${outputDir}. Pass --force to overwrite.`);
                            process.exit(1);
                        }
                    }
                }
                catch {
                    // missing directory is fine
                }
            }
            const requested = opts.entities
                .split(',')
                .map((entity) => entity.trim())
                .filter(Boolean);
            await createMigrationPackage({
                provider: opts.provider,
                rootDir: outputDir,
                entitiesRequested: requested,
                sourceTenant: opts.sourceTenant,
                warnings: [],
                handoffNotes: buildTemplateHandoffNotes(),
            });
            if (!opts.quiet) {
                console.log(chalk.green(`\n  Migration package skeleton ready: ${outputDir}`));
                console.log(chalk.gray('  Next steps:'));
                console.log(chalk.gray('    1. Populate users.csv (and optionally organizations.csv,'));
                console.log(chalk.gray('       organization_memberships.csv, role_definitions.csv,'));
                console.log(chalk.gray('       user_role_assignments.csv) with the canonical headers.'));
                console.log(chalk.gray('    2. Run `workos-migrate validate-package <dir>` to confirm'));
                console.log(chalk.gray('       the package matches the contract.'));
                console.log(chalk.gray('    3. Run `workos-migrate import-package <dir>` to import.'));
            }
        }
        catch (error) {
            logger.error(`generate-package-template failed: ${error.message}`);
            process.exit(1);
        }
    });
}
function buildTemplateHandoffNotes() {
    return [
        '# SSO handoff notes',
        '',
        'This skeleton ships empty SSO handoff CSVs. Populate them only when you have',
        'enterprise SAML or OIDC connection material to hand off; otherwise leave them',
        'header-only. WorkOS SSO connections are never imported automatically.',
        '',
    ].join('\n');
}
