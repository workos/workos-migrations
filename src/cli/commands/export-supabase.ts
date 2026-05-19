import { Command } from 'commander';
import chalk from 'chalk';
import type { SupabaseExportOptions } from '../../shared/types.js';
import { exportSupabase } from '../../exporters/supabase/exporter.js';
import { validateOrgSchemaFlags } from '../../exporters/supabase/org-schema.js';

const SUPPORTED_ENTITIES = ['users', 'identities', 'mfa', 'sso', 'organizations'];
const PG_ENTITIES = new Set(['mfa', 'sso', 'organizations']);

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
    .option('--package', 'Write a provider-neutral migration package (required)')
    .option('--output-dir <dir>', 'Output directory for the migration package')
    .option(
      '--entities <entities>',
      'Comma-separated entities to export (users, identities, mfa, sso, organizations)',
      'users',
    )
    .option('--rate-limit <n>', 'Admin API requests per second', '50')
    .option('--page-size <n>', 'Admin API page size', '1000')
    .option(
      '--db-url <connection-string>',
      'Postgres connection string (required for mfa, sso, organizations; or set SUPABASE_DB_URL)',
    )
    .option('--totp-issuer <name>', 'Issuer label written into totp_secrets.csv (default: Supabase)')
    .option(
      '--org-table <table>',
      'Postgres table holding organizations (e.g., public.organizations)',
    )
    .option('--org-id-column <column>', 'Column on --org-table that holds the org primary id')
    .option('--org-name-column <column>', 'Column on --org-table that holds the org display name')
    .option(
      '--org-external-id-column <column>',
      'Column on --org-table that holds the external org identifier (defaults to org-id-column)',
    )
    .option(
      '--org-domains-column <column>',
      'Column on --org-table that holds the org domain(s); string or text[] both accepted',
    )
    .option(
      '--org-members-table <table>',
      'Postgres table holding org memberships (e.g., public.org_members)',
    )
    .option(
      '--membership-user-column <column>',
      'Column on --org-members-table that holds the user UUID (joined to auth.users.id)',
    )
    .option(
      '--membership-org-column <column>',
      'Column on --org-members-table that holds the org id (joined to --org-id-column)',
    )
    .option(
      '--membership-role-column <column>',
      'Column on --org-members-table that holds the per-membership role (optional)',
    )
    .option(
      '--role-slug-map <path>',
      'JSON or CSV file mapping raw DB role values to WorkOS role slugs',
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
        const unsupported = entities.filter((e) => !SUPPORTED_ENTITIES.includes(e));
        if (unsupported.length > 0) {
          throw new Error(
            `Unsupported entities: ${unsupported.join(', ')}. Supported: ${SUPPORTED_ENTITIES.join(', ')}.`,
          );
        }

        const dbUrl = opts.dbUrl ?? process.env.SUPABASE_DB_URL;
        const pgRequested = entities.filter((e) => PG_ENTITIES.has(e));
        if (pgRequested.length > 0 && !dbUrl) {
          console.error(
            chalk.yellow(
              `Warning: ${pgRequested.join(', ')} require --db-url; they will be skipped.`,
            ),
          );
        }

        const orgSchema = validateOrgSchemaFlags({
          orgTable: opts.orgTable,
          orgIdColumn: opts.orgIdColumn,
          orgNameColumn: opts.orgNameColumn,
          orgExternalIdColumn: opts.orgExternalIdColumn,
          orgDomainsColumn: opts.orgDomainsColumn,
          membersTable: opts.orgMembersTable,
          membershipUserColumn: opts.membershipUserColumn,
          membershipOrgColumn: opts.membershipOrgColumn,
          membershipRoleColumn: opts.membershipRoleColumn,
          roleSlugMapPath: opts.roleSlugMap,
        });

        if (entities.includes('organizations') && !orgSchema) {
          console.error(
            chalk.yellow(
              'Warning: --entities includes "organizations" but no org schema flags supplied. Organizations export will be skipped.',
            ),
          );
        }

        const options: SupabaseExportOptions = {
          url: opts.url,
          serviceRoleKey: opts.serviceRoleKey,
          dbUrl,
          outputDir: opts.outputDir,
          entities,
          rateLimit: parseInt(opts.rateLimit, 10),
          pageSize: parseInt(opts.pageSize, 10),
          totpIssuer: opts.totpIssuer,
          orgSchema: orgSchema ?? undefined,
          quiet: opts.quiet ?? false,
        };

        await exportSupabase(options);
      } catch (error: unknown) {
        console.error(chalk.red(`\nExport failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
