import fs from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { createWorkOSClient } from '../../shared/workos-client.js';
import { importPackage, planImportPackage } from '../../import-package/orchestrator.js';
import * as logger from '../../shared/logger.js';

export function registerImportPackageCommand(program: Command): void {
  program
    .command('import-package')
    .description(
      'Import a migration package into WorkOS — users, organizations, memberships, roles, and TOTP factors (SSO connections are handoff-only, never auto-created)',
    )
    .argument('<dir>', 'Migration package directory')
    .option('--dry-run', 'Validate and plan without contacting WorkOS')
    .option('--plan', 'Print the import plan only and exit')
    .option('--concurrency <n>', 'Concurrent API requests during user import', '10')
    .option('--rate-limit <n>', 'Max requests per second during user import', '50')
    .option('--errors <path>', 'Path for per-row import errors')
    .option('--summary <path>', 'Path for the workos_import_summary.json file')
    .option('--endpoint <url>', 'WorkOS API endpoint URL (overrides WORKOS_API_URL)')
    .option('--quiet', 'Suppress progress output')
    .action(async (dir, opts) => {
      try {
        if (!fs.existsSync(dir)) {
          logger.error(`Package directory not found: ${dir}`);
          process.exit(1);
        }

        if (opts.plan) {
          const plan = await planImportPackage(dir);
          console.log(chalk.cyan('\n  Import Package Plan'));
          console.log(chalk.cyan('  ' + '═'.repeat(40)));
          console.log(`  Package:                ${plan.packageDir}`);
          console.log(`  Provider:               ${plan.manifestProvider}`);
          console.log(`  users.csv has rows:     ${plan.hasUsersCsv}`);
          console.log(`  organizations.csv:      ${plan.hasOrganizationsCsv}`);
          console.log(`  memberships.csv:        ${plan.hasMembershipsCsv}`);
          console.log(`  role_definitions.csv:   ${plan.hasRoleDefinitionsCsv}`);
          console.log(`  user_role_assignments:  ${plan.hasRoleAssignmentsCsv}`);
          console.log(`  totp_secrets.csv:       ${plan.hasTotpCsv}`);
          console.log(`  sso/ files present:     ${plan.hasSso}`);
          console.log(chalk.cyan('  Counts (from manifest)'));
          for (const [entity, count] of Object.entries(plan.expectedCounts)) {
            console.log(`    ${entity.padEnd(24)} ${count}`);
          }
          if (plan.validationErrors.length > 0) {
            console.log(chalk.red('\n  Validation errors:'));
            for (const issue of plan.validationErrors) {
              console.log(`    - ${issue.message}`);
            }
          }
          if (plan.validationWarnings.length > 0) {
            console.log(chalk.yellow('\n  Validation warnings:'));
            for (const issue of plan.validationWarnings) {
              console.log(`    - ${issue.message}`);
            }
          }
          console.log();
          if (plan.hasSso) {
            console.log(
              chalk.yellow(
                '  SSO connections are handoff-only and will NOT be imported automatically.',
              ),
            );
          }
          return;
        }

        if (opts.endpoint) {
          process.env.WORKOS_API_URL = opts.endpoint;
        }

        const dryRun = Boolean(opts.dryRun);
        const workos = dryRun ? undefined : createWorkOSClient({ endpoint: opts.endpoint });
        const summary = await importPackage({
          packageDir: dir,
          dryRun,
          quiet: Boolean(opts.quiet),
          concurrency: parseInt(opts.concurrency, 10),
          rateLimit: parseInt(opts.rateLimit, 10),
          errorsPath: opts.errors,
          summaryPath: opts.summary,
          workos,
        });

        if (!opts.quiet) {
          console.log(chalk.green('\nImport package complete'));
          console.log(`  Package:           ${summary.packageDir}`);
          console.log(`  Mode:              ${dryRun ? 'DRY RUN' : 'live'}`);
          for (const [label, entity] of [
            ['Organizations', summary.organizations],
            ['Users', summary.users],
            ['Memberships', summary.memberships],
            ['Role definitions', summary.roleDefinitions],
            ['Role assignments', summary.roleAssignments],
            ['TOTP factors', summary.totpFactors],
            ['SSO connections', summary.ssoConnections],
          ] as const) {
            const counts = entity.total !== undefined ? ` total=${entity.total}` : '';
            const ok = entity.succeeded !== undefined ? ` ok=${entity.succeeded}` : '';
            const failed = entity.failed !== undefined ? ` failed=${entity.failed}` : '';
            console.log(`  ${label.padEnd(18)} ${entity.status}${counts}${ok}${failed}`);
          }
          if (summary.warnings.length > 0) {
            console.log(chalk.yellow(`  Warnings: ${summary.warnings.length}`));
          }
        }
      } catch (error: unknown) {
        logger.error(`Import package failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
