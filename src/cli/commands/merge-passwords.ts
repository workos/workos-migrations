import { Command } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import {
  loadPasswordHashes,
  mergePasswordsIntoCsv,
} from '../../exporters/auth0/password-merger.js';

export function registerMergePasswordsCommand(program: Command): void {
  program
    .command('merge-passwords')
    .description('Merge Auth0 password hashes from NDJSON export into CSV')
    .requiredOption('--csv <path>', 'Input CSV file path')
    .requiredOption('--passwords <path>', 'Auth0 password hash NDJSON file')
    .requiredOption('--output <path>', 'Output CSV file path')
    .option('--quiet', 'Suppress output messages')
    .action(async (opts) => {
      try {
        // Validate input files exist
        if (!fs.existsSync(opts.csv)) {
          console.error(chalk.red(`CSV file not found: ${opts.csv}`));
          process.exit(1);
        }
        if (!fs.existsSync(opts.passwords)) {
          console.error(chalk.red(`Password file not found: ${opts.passwords}`));
          process.exit(1);
        }

        const startTime = Date.now();

        if (!opts.quiet) {
          console.log(chalk.blue('Loading password hashes from NDJSON...'));
        }

        const passwordLookup = await loadPasswordHashes(opts.passwords);
        const passwordCount = Object.keys(passwordLookup).length;

        if (!opts.quiet) {
          console.log(chalk.green(`Loaded ${passwordCount} password hashes`));
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
