import chalk from 'chalk';
export function registerExportAuth0Command(program) {
    program
        .command('export-auth0')
        .description('Export users from Auth0 to WorkOS-compatible CSV')
        .requiredOption('--domain <domain>', 'Auth0 tenant domain')
        .requiredOption('--client-id <id>', 'M2M application Client ID')
        .requiredOption('--client-secret <secret>', 'M2M application Client Secret')
        .requiredOption('--output <path>', 'Output CSV file path')
        .option('--orgs <ids...>', 'Filter to specific Auth0 org IDs')
        .option('--page-size <n>', 'API pagination size (max 100)', '100')
        .option('--rate-limit <n>', 'API requests per second', '50')
        .option('--user-fetch-concurrency <n>', 'Parallel user fetch count', '10')
        .option('--use-metadata', 'Use user_metadata for org discovery instead of Organizations API')
        .option('--metadata-org-id-field <field>', 'Custom metadata field for org ID')
        .option('--metadata-org-name-field <field>', 'Custom metadata field for org name')
        .option('--job-id <id>', 'Job ID for export checkpointing')
        .option('--resume [jobId]', 'Resume from export checkpoint')
        .option('--quiet', 'Suppress progress output')
        .action(async () => {
        console.log(chalk.yellow('Export Auth0 command not yet implemented. Coming in Phase 3.'));
    });
}
