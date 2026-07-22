import { Command } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import {
  duplicateEmails,
  loadPasswordHashes,
  mergePasswordsIntoCsv,
  mergePasswordsIntoPackage,
} from '../../exporters/auth0/password-merger.js';

export function registerMergePasswordsCommand(program: Command): void {
  program
    .command('merge-passwords')
    .description('Merge Auth0 password hashes from NDJSON export into a CSV or migration package')
    .requiredOption('--passwords <path>', 'Auth0 password hash NDJSON file')
    .option('--csv <path>', 'Input CSV file path (required unless --package is set)')
    .option('--output <path>', 'Output CSV file path (required unless --package is set)')
    .option('--package <dir>', 'Update users.csv and workos_upload/users.csv inside a package')
    .option('--quiet', 'Suppress output messages')
    .action(async (opts) => {
      try {
        if (!fs.existsSync(opts.passwords)) {
          console.error(chalk.red(`Password file not found: ${opts.passwords}`));
          process.exit(1);
        }

        if (opts.package) {
          if (opts.csv || opts.output) {
            console.error(
              chalk.red('--package cannot be combined with --csv or --output. Choose one mode.'),
            );
            process.exit(1);
          }
          if (!fs.existsSync(opts.package)) {
            console.error(chalk.red(`Package directory not found: ${opts.package}`));
            process.exit(1);
          }

          const startTime = Date.now();
          if (!opts.quiet) {
            console.log(chalk.blue(`Merging passwords into package at ${opts.package}...`));
          }

          const stats = await mergePasswordsIntoPackage({
            packageDir: opts.package,
            passwordsPath: opts.passwords,
          });

          if (!opts.quiet) {
            const duration = Date.now() - startTime;
            console.log(chalk.green(`\nPackage password merge complete`));
            console.log(`  Total rows: ${stats.totalRows}`);
            console.log(`  Passwords added: ${stats.passwordsAdded}`);
            console.log(`  No password found: ${stats.passwordsNotFound}`);
            console.log(`  Unsupported algorithms skipped: ${stats.passwordsRejectedAlgorithm}`);
            console.log(`  Upload rows updated: ${stats.uploadRowsUpdated}`);
            console.log(`  Duration: ${duration}ms`);
            console.log(`  Package: ${opts.package}`);
          }
          return;
        }

        if (!opts.csv || !opts.output) {
          console.error(chalk.red('Either --package, or both --csv and --output, must be set.'));
          process.exit(1);
        }
        if (!fs.existsSync(opts.csv)) {
          console.error(chalk.red(`CSV file not found: ${opts.csv}`));
          process.exit(1);
        }

        const startTime = Date.now();

        if (!opts.quiet) {
          console.log(chalk.blue('Loading password hashes from NDJSON...'));
        }

        const passwordLookup = await loadPasswordHashes(opts.passwords);
        const passwordCount = Object.keys(passwordLookup.byOid).length;

        if (!opts.quiet) {
          console.log(chalk.green(`Loaded ${passwordCount} password hashes`));
          const collidingEmails = duplicateEmails(passwordLookup);
          if (collidingEmails.length > 0) {
            console.log(
              chalk.yellow(
                `Warning: ${collidingEmails.length} email(s) appear on multiple password records. Hashes are matched by Auth0 user_id (external_id), not email.`,
              ),
            );
          }
          if (passwordLookup.recordsWithoutId > 0) {
            console.log(
              chalk.yellow(
                `Warning: ${passwordLookup.recordsWithoutId} password record(s) had no _id.$oid and were skipped (cannot be safely matched to a user).`,
              ),
            );
          }
          console.log(chalk.blue('Merging passwords into CSV...'));
        }

        const stats = await mergePasswordsIntoCsv(opts.csv, opts.output, passwordLookup);

        if (!opts.quiet) {
          const duration = Date.now() - startTime;
          console.log(chalk.green(`\nMerge complete`));
          console.log(`  Total rows: ${stats.totalRows}`);
          console.log(`  Passwords added: ${stats.passwordsAdded}`);
          console.log(`  No password found: ${stats.passwordsNotFound}`);
          console.log(`  Duration: ${duration}ms`);
          console.log(`  Output: ${opts.output}`);
        }
      } catch (error: unknown) {
        console.error(chalk.red(`\nMerge failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
