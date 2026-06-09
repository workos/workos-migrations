import { Command } from 'commander';
import chalk from 'chalk';
import type { Auth0ExportEngine, Auth0ExportOptions } from '../../shared/types.js';
import { exportAuth0 } from '../../exporters/auth0/exporter.js';

export function registerExportAuth0Command(program: Command): void {
  program
    .command('export-auth0')
    .description(
      'Export users, organizations, memberships, roles, password hashes + SSO handoff from Auth0 (deprecated; use "export auth0")',
    )
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
    .option(
      '--engine <engine>',
      'Auth0 user export engine: management-api or bulk-job',
      'management-api',
    )
    .option(
      '--bulk-connection-id <id>',
      'Auth0 connection ID to scope a bulk-job export to a single connection',
    )
    .option(
      '--bulk-poll-interval-ms <n>',
      'Polling interval (ms) for bulk-job status checks (default: 2000)',
    )
    .option(
      '--bulk-max-poll-attempts <n>',
      'Maximum bulk-job poll attempts before timing out (default: 150)',
    )
    .option('--job-id <id>', 'Job ID for export checkpointing')
    .option('--resume [jobId]', 'Resume from export checkpoint')
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => {
      try {
        console.error(
          chalk.yellow("⚠ 'export-auth0' is deprecated; use 'export auth0' (removed in v4.0)"),
        );
        if (!opts.package && !opts.output) {
          throw new Error('--output is required unless --package is set');
        }
        if (opts.package && !opts.outputDir) {
          throw new Error('--output-dir is required when using --package');
        }

        const engine = parseEngine(opts.engine);

        if (engine === 'bulk-job' && !opts.package) {
          throw new Error('--engine bulk-job requires --package mode');
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
          engine,
          bulkConnectionId: opts.bulkConnectionId,
          bulkPollIntervalMs: opts.bulkPollIntervalMs
            ? parseInt(opts.bulkPollIntervalMs, 10)
            : undefined,
          bulkMaxPollAttempts: opts.bulkMaxPollAttempts
            ? parseInt(opts.bulkMaxPollAttempts, 10)
            : undefined,
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

function parseEngine(value: string | undefined): Auth0ExportEngine {
  const normalized = (value ?? 'management-api').trim();
  if (normalized === 'management-api' || normalized === 'bulk-job') return normalized;
  throw new Error(`--engine must be "management-api" or "bulk-job", got "${value}"`);
}
