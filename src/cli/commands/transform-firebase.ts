import { Command } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import type { FirebaseScryptConfig } from '../../shared/types.js';
import { transformFirebaseExport } from '../../transformers/firebase/transformer.js';
import { exportFirebasePackage } from '../../transformers/firebase/package-exporter.js';
import {
  createGoogleAccessTokenProvider,
  detectGoogleProjectId,
} from '../../transformers/firebase/google-auth.js';

export function registerTransformFirebaseCommand(program: Command): void {
  program
    .command('transform-firebase')
    .description(
      'Transform Firebase Auth JSON export to WorkOS-compatible CSV or migration package',
    )
    .requiredOption('--input <path>', 'Firebase Auth JSON export file')
    .option('--output <path>', 'Output WorkOS CSV file (legacy single-CSV mode)')
    .option('--package', 'Write a migration package instead of a single CSV')
    .option('--output-dir <dir>', 'Output directory when --package is set')
    .option('--source-tenant <name>', 'Optional source tenant identifier to record in the manifest')
    .option('--org-mapping <path>', 'Org mapping CSV (firebase_uid,org_external_id,org_name)')
    .option('--role-mapping <path>', 'Role mapping CSV (firebase_uid,role_slug)')
    .option('--include-disabled', 'Include disabled users (excluded by default)')
    .option(
      '--name-split <strategy>',
      'Name splitting: first-space, last-space, first-name-only',
      'first-space',
    )
    .option('--signer-key <key>', 'Firebase scrypt signer key (base64)')
    .option('--salt-separator <sep>', 'Firebase scrypt salt separator (base64)')
    .option('--rounds <n>', 'Firebase scrypt rounds', '8')
    .option('--memory-cost <n>', 'Firebase scrypt memory cost', '14')
    .option('--skip-passwords', 'Skip password hash extraction')
    .option(
      '--service-account <path>',
      'Path to a Google service account JSON key (env: GOOGLE_APPLICATION_CREDENTIALS). When set, fetches Identity Platform SAML/OIDC configs. Package mode only.',
    )
    .option(
      '--project-id <id>',
      'Google Cloud project ID (env: GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT). Required when fetching SSO configs unless inferable from credentials.',
    )
    .option(
      '--skip-tenant-sso',
      'Skip per-tenant inboundSamlConfigs/oauthIdpConfigs and export project-scoped configs only',
    )
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

        const serviceAccount = opts.serviceAccount ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;

        if (opts.package) {
          if (!opts.outputDir) {
            console.error(chalk.red('--output-dir is required when --package is set'));
            process.exit(1);
          }

          let accessTokenProvider;
          let gcpProjectId: string | undefined;
          if (serviceAccount) {
            if (!fs.existsSync(serviceAccount)) {
              console.error(chalk.red(`Service account key not found: ${serviceAccount}`));
              process.exit(1);
            }
            accessTokenProvider = createGoogleAccessTokenProvider({ keyFile: serviceAccount });
            gcpProjectId =
              opts.projectId ??
              process.env.GOOGLE_CLOUD_PROJECT ??
              process.env.GCLOUD_PROJECT ??
              (await detectGoogleProjectId({ keyFile: serviceAccount }));
            if (!gcpProjectId) {
              console.error(
                chalk.red(
                  '--project-id is required when fetching Identity Platform SSO configs (or set GOOGLE_CLOUD_PROJECT).',
                ),
              );
              process.exit(1);
            }
          }

          const stats = await exportFirebasePackage({
            input: opts.input,
            outputDir: opts.outputDir,
            scryptConfig,
            nameSplitStrategy: opts.nameSplit,
            includeDisabled: opts.includeDisabled ?? false,
            skipPasswords: opts.skipPasswords ?? false,
            orgMapping: opts.orgMapping,
            roleMapping: opts.roleMapping,
            sourceTenant: opts.sourceTenant,
            gcpProjectId,
            accessTokenProvider,
            skipTenantSsoScopes: opts.skipTenantSso ?? false,
            quiet: opts.quiet ?? false,
          });
          if (!opts.quiet) {
            console.log(chalk.green('\nFirebase package export complete'));
            console.log(`  Users:        ${stats.totalUsers}`);
            console.log(`  Orgs:         ${stats.totalOrgs}`);
            console.log(`  Memberships:  ${stats.totalMemberships}`);
            console.log(`  Roles:        ${stats.roleDefinitions}`);
            if (accessTokenProvider) {
              console.log(`  SAML connections: ${stats.samlConnections}`);
              console.log(`  OIDC connections: ${stats.oidcConnections}`);
            }
            console.log(`  Skipped:      ${stats.skippedUsers}`);
            console.log(`  Warnings:     ${stats.warnings.length}`);
          }
          return;
        }

        if (opts.serviceAccount) {
          console.error(chalk.red('--service-account is only supported in --package mode'));
          process.exit(1);
        }

        if (!opts.output) {
          console.error(chalk.red('--output is required unless --package is set'));
          process.exit(1);
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
