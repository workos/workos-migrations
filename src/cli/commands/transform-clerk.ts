import { Command } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import { transformClerkExport } from '../../transformers/clerk/transformer.js';

export function registerTransformClerkCommand(program: Command): void {
  program
    .command('transform-clerk')
    .description('Transform Clerk export CSV to WorkOS-compatible CSV')
    .requiredOption('--input <path>', 'Clerk export CSV file')
    .requiredOption('--output <path>', 'Output WorkOS CSV file')
    .option('--org-mapping <path>', 'Org mapping CSV (clerk_user_id,org_external_id,org_name)')
    .option('--role-mapping <path>', 'Role mapping CSV (clerk_user_id,role_slug)')
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => {
      try {
        if (!fs.existsSync(opts.input)) {
          console.error(chalk.red(`Clerk CSV file not found: ${opts.input}`));
          process.exit(1);
        }
        if (opts.orgMapping && !fs.existsSync(opts.orgMapping)) {
          console.error(chalk.red(`Org mapping file not found: ${opts.orgMapping}`));
          process.exit(1);
        }
        if (opts.roleMapping && !fs.existsSync(opts.roleMapping)) {
          console.error(chalk.red(`Role mapping file not found: ${opts.roleMapping}`));
          process.exit(1);
        }

        const startTime = Date.now();

        if (!opts.quiet) {
          console.log(chalk.blue('Transforming Clerk export...'));
        }

        const summary = await transformClerkExport({
          input: opts.input,
          output: opts.output,
          orgMapping: opts.orgMapping,
          roleMapping: opts.roleMapping,
          quiet: opts.quiet,
        });

        if (!opts.quiet) {
          const duration = Date.now() - startTime;
          console.log(chalk.green('\nTransform complete'));
          console.log(`  Total users: ${summary.totalUsers}`);
          console.log(`  Transformed: ${summary.transformedUsers}`);
          console.log(`  Skipped: ${summary.skippedUsers}`);
          console.log(`  With passwords: ${summary.usersWithPasswords}`);
          console.log(`  With org mapping: ${summary.usersWithOrgMapping}`);
          console.log(`  With role mapping: ${summary.usersWithRoleMapping}`);
          console.log(`  Duration: ${duration}ms`);
          console.log(`  Output: ${opts.output}`);
        }
      } catch (error: unknown) {
        console.error(chalk.red(`\nTransform failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
