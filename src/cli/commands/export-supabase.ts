import { Command } from 'commander';
import chalk from 'chalk';
import type { SupabaseExportOptions } from '../../shared/types.js';
import { exportSupabase } from '../../exporters/supabase/exporter.js';

const PHASE_1_ALLOWED_ENTITIES = ['users', 'identities'];

function parseEntities(value: string | undefined): string[] {
  if (!value) return ['users'];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function registerExportSupabaseCommand(program: Command): void {
  program
    .command('export-supabase')
    .description('Export users from Supabase Auth to a WorkOS-compatible migration package')
    .requiredOption('--url <url>', 'Supabase project URL (e.g., https://xxxx.supabase.co)')
    .requiredOption('--service-role-key <key>', 'Supabase service role JWT')
    .option('--package', 'Write a provider-neutral migration package (required in Phase 1)')
    .option('--output-dir <dir>', 'Output directory for the migration package')
    .option(
      '--entities <entities>',
      'Comma-separated entities to export (users, identities)',
      'users',
    )
    .option('--rate-limit <n>', 'Admin API requests per second', '50')
    .option('--page-size <n>', 'Admin API page size', '1000')
    .option(
      '--db-url <connection-string>',
      'Postgres connection string (accepted for forward compatibility; unused in Phase 1)',
    )
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => {
      try {
        if (!opts.package) {
          throw new Error('--package is required for Supabase export');
        }
        if (!opts.outputDir) {
          throw new Error('--output-dir is required when using --package');
        }

        const entities = parseEntities(opts.entities);
        const unsupported = entities.filter((e) => !PHASE_1_ALLOWED_ENTITIES.includes(e));
        if (unsupported.length > 0) {
          throw new Error(
            `Phase 1 supports only ${PHASE_1_ALLOWED_ENTITIES.join(', ')}. Unsupported: ${unsupported.join(
              ', ',
            )}. MFA, SSO, and organizations land in later phases.`,
          );
        }

        const options: SupabaseExportOptions = {
          url: opts.url,
          serviceRoleKey: opts.serviceRoleKey,
          dbUrl: opts.dbUrl,
          outputDir: opts.outputDir,
          entities,
          rateLimit: parseInt(opts.rateLimit, 10),
          pageSize: parseInt(opts.pageSize, 10),
          quiet: opts.quiet ?? false,
        };

        await exportSupabase(options);
      } catch (error: unknown) {
        console.error(chalk.red(`\nExport failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
