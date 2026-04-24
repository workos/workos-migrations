import chalk from 'chalk';
import { CognitoClient } from '../../providers/cognito/index.js';
export function registerExportCognitoCommand(program) {
    program
        .command('export-cognito')
        .description('Export users and SSO connections from AWS Cognito user pools')
        .requiredOption('--region <region>', 'AWS region (e.g. us-east-1)', process.env.AWS_REGION)
        .requiredOption('--user-pool-ids <ids>', 'Comma-separated Cognito user pool IDs', process.env.COGNITO_USER_POOL_IDS)
        .option('--entities <entities>', 'Comma-separated entities to export (connections,users)', 'connections,users')
        .option('--output-dir <dir>', 'Output directory for CSV files', '.')
        .option('--access-key-id <id>', 'AWS Access Key ID (uses default credential chain if omitted)')
        .option('--secret-access-key <secret>', 'AWS Secret Access Key')
        .option('--session-token <token>', 'AWS Session Token')
        .option('--saml-custom-acs-url-template <url>', 'Template for SAML custom ACS URL (placeholders: {provider_name}, {user_pool_id}, {region})')
        .option('--saml-custom-entity-id-template <url>', 'Template for SAML custom Entity ID (default: urn:amazon:cognito:sp:{user_pool_id})')
        .option('--oidc-custom-redirect-uri-template <url>', 'Template for OIDC custom redirect URI')
        .action(async (opts) => {
        try {
            const credentials = {
                region: opts.region,
                userPoolIds: opts.userPoolIds,
                accessKeyId: opts.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID ?? '',
                secretAccessKey: opts.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY ?? '',
                sessionToken: opts.sessionToken ?? process.env.AWS_SESSION_TOKEN ?? '',
            };
            const clientOptions = {
                userPoolIds: opts.userPoolIds.split(',').map((s) => s.trim()),
                outDir: opts.outputDir,
                proxy: {
                    samlCustomAcsUrl: opts.samlCustomAcsUrlTemplate ?? null,
                    samlCustomEntityId: opts.samlCustomEntityIdTemplate ?? null,
                    oidcCustomRedirectUri: opts.oidcCustomRedirectUriTemplate ?? null,
                },
            };
            const client = new CognitoClient(credentials, clientOptions);
            console.log(chalk.blue('Connecting to AWS Cognito...'));
            await client.authenticate();
            console.log(chalk.green('Successfully authenticated with AWS'));
            const entities = opts.entities.split(',').map((e) => e.trim());
            console.log(chalk.blue(`\nExporting entities: ${entities.join(', ')}`));
            const result = await client.exportEntities(entities);
            console.log(chalk.green('\nExport complete'));
            for (const [key, count] of Object.entries(result.summary)) {
                console.log(chalk.gray(`  ${key}: ${count}`));
            }
        }
        catch (error) {
            console.error(chalk.red(`\nExport failed: ${error.message}`));
            process.exit(1);
        }
    });
}
