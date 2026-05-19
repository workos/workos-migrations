import { Command } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import { mergeSupabasePasswords } from '../../exporters/supabase/password-merger.js';

export function registerMergePasswordsSupabaseCommand(program: Command): void {
  program
    .command('merge-passwords-supabase')
    .description('Merge bcrypt password hashes from Supabase Postgres into a migration package')
    .requiredOption('--package <dir>', 'Path to a Supabase migration package directory')
    .option(
      '--db-url <connection-string>',
      'Supabase Postgres connection string (or set SUPABASE_DB_URL)',
    )
    .option('--quiet', 'Suppress output messages')
    .action(async (opts) => {
      try {
        const dbUrl = opts.dbUrl ?? process.env.SUPABASE_DB_URL;
        if (!dbUrl) {
          throw new Error('--db-url is required (or set SUPABASE_DB_URL).');
        }
        if (!fs.existsSync(opts.package)) {
          throw new Error(`Package directory not found: ${opts.package}`);
        }

        const startTime = Date.now();
        if (!opts.quiet) {
          console.log(chalk.blue(`Merging Supabase passwords into ${opts.package}...`));
        }

        const stats = await mergeSupabasePasswords({
          packageDir: opts.package,
          dbUrl,
          quiet: opts.quiet ?? false,
        });

        if (!opts.quiet) {
          const duration = Date.now() - startTime;
          console.log(chalk.green('\nPassword merge complete'));
          console.log(`  Total rows: ${stats.totalRows}`);
          console.log(`  Matched: ${stats.matched}`);
          console.log(`  Missing in DB: ${stats.missing}`);
          console.log(`  Unsupported algorithm: ${stats.unsupportedAlgo}`);
          console.log(`  Upload rows updated: ${stats.uploadRowsUpdated}`);
          console.log(`  Warnings: ${stats.warnings.length}`);
          console.log(`  Duration: ${duration}ms`);
          console.log(`  Package: ${opts.package}`);
        }
      } catch (error: unknown) {
        console.error(chalk.red(`\nMerge failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
