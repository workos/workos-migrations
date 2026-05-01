import { Command } from 'commander';
import chalk from 'chalk';
import type { Auth0ExportOptions } from '../../shared/types.js';
import { exportAuth0 } from '../../exporters/auth0/exporter.js';

export function registerExportAuth0Command(program: Command): void {
  program
    .command('export-auth0')
    .description('Export users from Auth0 to WorkOS-compatible CSV')
    .requiredOption('--domain <domain>', 'Auth0 tenant domain')
    .requiredOption('--client-id <id>', 'M2M application Client ID')
    .requiredOption('--client-secret <secret>', 'M2M application Client Secret')
    .option('--output <path>', 'Output CSV file path')
    .option('--package', 'Write a provider-neutral migration package')
    .option('--output-dir <dir>', 'Output directory for package mode')
    .option(
      '--entities <entities>',
      'Comma-separated package entities to export (users,organizations,memberships,sso)',
      'users,organizations,memberships',
    )
    .option('--include-secrets', 'Include Auth0 SSO connection secrets in package handoff files')
    .option('--orgs <ids...>', 'Filter to specific Auth0 org IDs')
    .option('--page-size <n>', 'API pagination size (max 100)', '100')
    .option('--rate-limit <n>', 'API requests per second', '50')
    .option('--user-fetch-concurrency <n>', 'Parallel user fetch count', '10')
    .option('--use-metadata', 'Use user_metadata for org discovery instead of Organizations API')
    .option('--metadata-org-id-field <field>', 'Custom metadata field for org ID')
    .option('--metadata-org-name-field <field>', 'Custom metadata field for org name')
    .option(
      '--include-federated-users',
      'Include federated/JIT users in package mode (skipped by default)',
    )
    .option('--job-id <id>', 'Job ID for export checkpointing')
    .option('--resume [jobId]', 'Resume from export checkpoint')
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => {
      try {
        if (!opts.package && !opts.output) {
          throw new Error('--output is required unless --package is set');
        }
        if (opts.package && !opts.outputDir) {
          throw new Error('--output-dir is required when using --package');
        }

        const options: Auth0ExportOptions = {
          domain: opts.domain,
          clientId: opts.clientId,
          clientSecret: opts.clientSecret,
          output: opts.output,
          package: opts.package ?? false,
          outputDir: opts.outputDir,
          entities: parseEntities(opts.entities),
          includeSecrets: opts.includeSecrets ?? false,
          orgs: opts.orgs,
          pageSize: parseInt(opts.pageSize, 10),
          rateLimit: parseInt(opts.rateLimit, 10),
          userFetchConcurrency: parseInt(opts.userFetchConcurrency, 10),
          useMetadata: opts.useMetadata ?? false,
          metadataOrgIdField: opts.metadataOrgIdField,
          metadataOrgNameField: opts.metadataOrgNameField,
          includeFederatedUsers: opts.includeFederatedUsers ?? false,
          jobId: opts.jobId,
          resume: opts.resume ?? false,
          quiet: opts.quiet ?? false,
        };

        await exportAuth0(options);
      } catch (error: unknown) {
        console.error(chalk.red(`\nExport failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}

function parseEntities(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((entity) => entity.trim())
    .filter(Boolean);
}
