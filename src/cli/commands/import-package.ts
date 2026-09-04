import fs from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import prompts from 'prompts';
import { createWorkOSClient } from '../../shared/workos-client.js';
import {
  importPackage,
  planImportPackage,
  type ImportPackagePlan,
} from '../../import-package/orchestrator.js';
import { loadSsoSecrets, type SsoCustomAttributeMode } from '../../import-package/sso-importer.js';
import * as logger from '../../shared/logger.js';

export function registerImportPackageCommand(program: Command): void {
  program
    .command('import-package')
    .description(
      'Import a migration package into WorkOS — users, organizations, memberships, roles, TOTP factors, and SSO connections (via the Connections API)',
    )
    .argument('<dir>', 'Migration package directory')
    .option('--dry-run', 'Validate and plan without contacting WorkOS')
    .option('--plan', 'Print the import plan only and exit')
    .option('--concurrency <n>', 'Concurrent API requests during user import', '10')
    .option('--rate-limit <n>', 'Max requests per second during user import', '50')
    .option('--errors <path>', 'Path for per-row import errors')
    .option('--summary <path>', 'Path for the workos_import_summary.json file')
    .option('--endpoint <url>', 'WorkOS API endpoint URL (overrides WORKOS_API_URL)')
    .option('--skip-sso', 'Do not create SSO connections; report sso/ files as handoff')
    .option(
      '--sso-secrets <path>',
      'JSON or CSV file of OIDC client secrets keyed by connection externalId (fills redacted clientSecret values)',
    )
    .option(
      '--sso-custom-attributes <mode>',
      'How to handle custom attribute mappings: include (custom attributes must already exist in the WorkOS dashboard) or skip',
    )
    .option('--sso-rate-limit <n>', 'Max Connections API requests per second', '5')
    .option('--quiet', 'Suppress progress output')
    .action(async (dir, opts) => {
      try {
        if (!fs.existsSync(dir)) {
          logger.error(`Package directory not found: ${dir}`);
          process.exit(1);
        }

        const plan = await planImportPackage(dir);

        if (opts.plan) {
          printPlan(plan);
          return;
        }

        if (opts.endpoint) {
          process.env.WORKOS_API_URL = opts.endpoint;
        }

        const dryRun = Boolean(opts.dryRun);
        const skipSso = Boolean(opts.skipSso);

        const ssoCustomAttributes = await resolveCustomAttributeMode({
          plan,
          skipSso,
          dryRun,
          requested: opts.ssoCustomAttributes,
          quiet: Boolean(opts.quiet),
        });
        if (ssoCustomAttributes === 'abort') {
          console.log(
            chalk.yellow(
              '\n  Import aborted. Create the custom attributes in the WorkOS dashboard (Authentication → Custom attributes), then re-run import-package.',
            ),
          );
          return;
        }

        const ssoSecrets = opts.ssoSecrets ? await loadSsoSecrets(opts.ssoSecrets) : undefined;

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
          skipSso,
          ssoSecrets,
          ssoCustomAttributes,
          ssoRateLimit: parseInt(opts.ssoRateLimit, 10),
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

          const sso = summary.ssoConnections;
          const ssoDetails = (sso.details ?? {}) as Record<string, unknown>;
          if (sso.status !== 'absent') {
            const skipped = ssoDetails.skipped;
            const notAttempted = ssoDetails.notAttempted;
            const extras = [
              typeof skipped === 'number' && skipped > 0 ? `skipped=${skipped}` : '',
              typeof notAttempted === 'number' && notAttempted > 0
                ? `not_attempted=${notAttempted}`
                : '',
            ]
              .filter(Boolean)
              .join(' ');
            if (extras) console.log(`  ${''.padEnd(18)} ${extras}`);
            if (typeof ssoDetails.resultsPath === 'string') {
              console.log(`  SSO results:       ${ssoDetails.resultsPath}`);
            }
            for (const note of sso.notes ?? []) {
              console.log(chalk.cyan(`  • ${note}`));
            }
          }

          if (summary.warnings.length > 0) {
            console.log(chalk.yellow(`  Warnings: ${summary.warnings.length}`));
          }
          const ssoWarnings = sso.warnings ?? [];
          if (ssoWarnings.length > 0) {
            console.log(chalk.yellow(`  SSO warnings: ${ssoWarnings.length}`));
            for (const warning of ssoWarnings.slice(0, 10)) {
              console.log(chalk.yellow(`    - ${warning}`));
            }
            if (ssoWarnings.length > 10) {
              console.log(
                chalk.yellow(
                  `    … ${ssoWarnings.length - 10} more in workos_import_summary.json / workos_sso_connections.csv`,
                ),
              );
            }
          }
        }
      } catch (error: unknown) {
        logger.error(`Import package failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}

function printPlan(plan: ImportPackagePlan): void {
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
  console.log(`  sso/ connections:       ${plan.hasSso}`);
  console.log(`  sso/proxy_routes.csv:   ${plan.hasProxyRoutes}`);
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
      chalk.cyan(
        '  SSO connections will be created through the WorkOS Connections API (POST /connections).',
      ),
    );
    console.log(
      chalk.gray(
        '  Requires Connections API migration capabilities to be enabled for the environment; otherwise the run falls back to handoff.',
      ),
    );
    if (plan.ssoCustomAttributeNames.length > 0) {
      console.log(
        chalk.yellow(
          `  Custom attributes referenced (must exist in the WorkOS dashboard first): ${plan.ssoCustomAttributeNames.join(', ')}`,
        ),
      );
    }
    console.log();
  }
}

async function resolveCustomAttributeMode(input: {
  plan: ImportPackagePlan;
  skipSso: boolean;
  dryRun: boolean;
  requested?: string;
  quiet: boolean;
}): Promise<SsoCustomAttributeMode | 'abort'> {
  const { plan, requested } = input;

  if (requested !== undefined) {
    if (requested !== 'include' && requested !== 'skip') {
      throw new Error(`--sso-custom-attributes must be "include" or "skip" (got "${requested}")`);
    }
    return requested;
  }

  const names = plan.ssoCustomAttributeNames;
  if (input.skipSso || !plan.hasSso || names.length === 0) {
    return 'include';
  }

  const banner = [
    '',
    `  This package maps ${names.length} custom attribute(s) onto SSO connections:`,
    `    ${names.join(', ')}`,
    '  The Connections API rejects a connection whose custom attributes are not already defined',
    '  in the WorkOS dashboard (Authentication → Custom attributes).',
    '',
  ].join('\n');

  if (input.dryRun || !process.stdin.isTTY) {
    if (!input.quiet) {
      console.log(chalk.yellow(banner));
      console.log(
        chalk.gray(
          '  Proceeding with custom attribute mappings included. Pass --sso-custom-attributes skip to omit them.\n',
        ),
      );
    }
    return 'include';
  }

  console.log(chalk.yellow(banner));
  const answer = await prompts(
    {
      type: 'select',
      name: 'mode',
      message: 'How should custom attribute mappings be handled?',
      choices: [
        {
          title: 'Include them — the custom attributes already exist in the dashboard',
          value: 'include',
        },
        {
          title: 'Continue without them — create connections now, add mappings later',
          value: 'skip',
        },
        {
          title: 'Abort — I will set up the custom attributes first',
          value: 'abort',
        },
      ],
      initial: 0,
    },
    { onCancel: () => process.exit(1) },
  );

  return (answer.mode as SsoCustomAttributeMode | 'abort' | undefined) ?? 'abort';
}
