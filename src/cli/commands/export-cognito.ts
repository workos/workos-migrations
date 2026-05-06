import { Command } from 'commander';
import chalk from 'chalk';
import { CognitoClient, type CognitoClientOptions } from '../../providers/cognito/index.js';
import type { ProviderCredentials } from '../../shared/types.js';
import type { CognitoOrgStrategy } from '../../providers/cognito/package-exporter.js';

export function registerExportCognitoCommand(program: Command): void {
  program
    .command('export-cognito')
    .description('Export users and SSO connections from AWS Cognito user pools')
    .requiredOption('--region <region>', 'AWS region (e.g. us-east-1)', process.env.AWS_REGION)
    .requiredOption(
      '--user-pool-ids <ids>',
      'Comma-separated Cognito user pool IDs',
      process.env.COGNITO_USER_POOL_IDS,
    )
    .option(
      '--entities <entities>',
      'Comma-separated entities (loose mode: connections,users; package mode: users,organizations,memberships,sso)',
      'connections,users',
    )
    .option('--output-dir <dir>', 'Output directory for CSV files', '.')
    .option('--package', 'Write a provider-neutral migration package instead of loose CSVs')
    .option(
      '--org-strategy <strategy>',
      'Org mapping for package mode: user-pool (default), connection, or none',
      'user-pool',
    )
    .option('--access-key-id <id>', 'AWS Access Key ID (uses default credential chain if omitted)')
    .option('--secret-access-key <secret>', 'AWS Secret Access Key')
    .option('--session-token <token>', 'AWS Session Token')
    .option(
      '--saml-custom-acs-url-template <url>',
      'Template for SAML custom ACS URL (placeholders: {provider_name}, {user_pool_id}, {region})',
    )
    .option(
      '--saml-custom-entity-id-template <url>',
      'Template for SAML custom Entity ID (default: urn:amazon:cognito:sp:{user_pool_id})',
    )
    .option('--oidc-custom-redirect-uri-template <url>', 'Template for OIDC custom redirect URI')
    .option(
      '--skip-external-provider-users',
      'Skip federated Cognito users (userStatus=EXTERNAL_PROVIDER) — they will be JIT-provisioned by WorkOS on first SSO login',
    )
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => {
      try {
        const credentials: ProviderCredentials = {
          region: opts.region,
          userPoolIds: opts.userPoolIds,
          accessKeyId: opts.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID ?? '',
          secretAccessKey: opts.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY ?? '',
          sessionToken: opts.sessionToken ?? process.env.AWS_SESSION_TOKEN ?? '',
        };

        const clientOptions: CognitoClientOptions = {
          userPoolIds: opts.userPoolIds.split(',').map((s: string) => s.trim()),
          outDir: opts.outputDir,
          proxy: {
            samlCustomAcsUrl: opts.samlCustomAcsUrlTemplate ?? null,
            samlCustomEntityId: opts.samlCustomEntityIdTemplate ?? null,
            oidcCustomRedirectUri: opts.oidcCustomRedirectUriTemplate ?? null,
          },
          skipExternalProviderUsers: opts.skipExternalProviderUsers ?? false,
        };

        const client = new CognitoClient(credentials, clientOptions);

        console.log(chalk.blue('Connecting to AWS Cognito...'));
        await client.authenticate();
        console.log(chalk.green('Successfully authenticated with AWS'));

        const entities = opts.entities.split(',').map((e: string) => e.trim());

        if (opts.package) {
          const packageEntities =
            opts.entities === 'connections,users'
              ? ['users', 'organizations', 'memberships']
              : entities;
          console.log(
            chalk.blue(`\nWriting Cognito migration package: ${packageEntities.join(', ')}`),
          );
          await client.exportPackage({
            entities: packageEntities,
            outputDir: opts.outputDir,
            orgStrategy: parseOrgStrategy(opts.orgStrategy),
            quiet: opts.quiet ?? false,
          });
          return;
        }

        console.log(chalk.blue(`\nExporting entities: ${entities.join(', ')}`));
        const result = await client.exportEntities(entities);

        console.log(chalk.green('\nExport complete'));
        for (const [key, count] of Object.entries(result.summary)) {
          console.log(chalk.gray(`  ${key}: ${count}`));
        }
      } catch (error: unknown) {
        console.error(chalk.red(`\nExport failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}

function parseOrgStrategy(value: string | undefined): CognitoOrgStrategy {
  const normalized = (value ?? 'user-pool').trim();
  if (normalized === 'user-pool' || normalized === 'connection' || normalized === 'none') {
    return normalized;
  }
  throw new Error(`--org-strategy must be one of: user-pool, connection, none. Got "${value}"`);
}
