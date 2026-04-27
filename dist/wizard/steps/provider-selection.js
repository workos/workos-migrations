import prompts from 'prompts';
import chalk from 'chalk';
export async function selectProvider(state) {
    console.log(chalk.cyan('  Step 1: Select Provider\n'));
    const response = await prompts({
        type: 'select',
        name: 'provider',
        message: 'Which identity provider are you migrating from?',
        choices: [
            {
                title: 'Auth0',
                value: 'auth0',
                description: 'Export via Management API, bcrypt passwords',
            },
            {
                title: 'Clerk',
                value: 'clerk',
                description: 'Transform Clerk CSV export, bcrypt passwords',
            },
            {
                title: 'Firebase Auth',
                value: 'firebase',
                description: 'Transform Firebase JSON, scrypt passwords',
            },
            {
                title: 'AWS Cognito',
                value: 'cognito',
                description: 'Export users + SSO connections from Cognito user pools',
            },
            { title: 'Custom CSV', value: 'csv', description: 'Already have a WorkOS-formatted CSV' },
        ],
    }, {
        onCancel: () => {
            state.cancelled = true;
        },
    });
    if (state.cancelled)
        return state;
    state.provider = response.provider;
    console.log(chalk.green(`\n  Selected: ${state.provider}\n`));
    return state;
}
