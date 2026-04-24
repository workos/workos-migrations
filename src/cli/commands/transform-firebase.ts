import { Command } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import type { FirebaseScryptConfig } from '../../shared/types.js';
import { transformFirebaseExport } from '../../transformers/firebase/transformer.js';

export function registerTransformFirebaseCommand(program: Command): void {
  program
    .command('transform-firebase')
    .description('Transform Firebase Auth JSON export to WorkOS-compatible CSV')
    .requiredOption('--input <path>', 'Firebase Auth JSON export file')
    .requiredOption('--output <path>', 'Output WorkOS CSV file')
    .option('--org-mapping <path>', 'Org mapping CSV (firebase_uid,org_external_id,org_name)')
    .option('--role-mapping <path>', 'Role mapping CSV (firebase_uid,role_slug)')
    .option('--include-disabled', 'Include disabled users (excluded by default)')
    .option('--name-split <strategy>', 'Name splitting: first-space, last-space, first-name-only', 'first-space')
    .option('--signer-key <key>', 'Firebase scrypt signer key (base64)')
    .option('--salt-separator <sep>', 'Firebase scrypt salt separator (base64)')
    .option('--rounds <n>', 'Firebase scrypt rounds', '8')
    .option('--memory-cost <n>', 'Firebase scrypt memory cost', '14')
    .option('--skip-passwords', 'Skip password hash extraction')
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => {
      try {
        if (!fs.existsSync(opts.input)) {
          console.error(chalk.red(`Firebase JSON file not found: ${opts.input}`));
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

        // Build scrypt config if signer key provided
        let scryptConfig: FirebaseScryptConfig | undefined;
        if (opts.signerKey && !opts.skipPasswords) {
          scryptConfig = {
            signerKey: opts.signerKey,
            saltSeparator: opts.saltSeparator || '',
            rounds: parseInt(opts.rounds, 10),
            memoryCost: parseInt(opts.memoryCost, 10),
          };
        }

        const startTime = Date.now();

        if (!opts.quiet) {
          console.log(chalk.blue('Transforming Firebase export...'));
        }

        const summary = await transformFirebaseExport({
          input: opts.input,
          output: opts.output,
          scryptConfig,
          nameSplitStrategy: opts.nameSplit,
          includeDisabled: opts.includeDisabled,
          skipPasswords: opts.skipPasswords,
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
