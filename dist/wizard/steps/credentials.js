import prompts from 'prompts';
import chalk from 'chalk';
export async function enterCredentials(state) {
    console.log(chalk.cyan('  Step 2: Credentials\n'));
    // Check for WORKOS_SECRET_KEY
    if (!process.env.WORKOS_SECRET_KEY) {
        console.log(chalk.yellow('  WORKOS_SECRET_KEY is not set in environment.'));
        console.log(chalk.gray('  Set it with: export WORKOS_SECRET_KEY=sk_...\n'));
        const response = await prompts({
            type: 'password',
            name: 'workosKey',
            message: 'Enter your WorkOS Secret Key (sk_...)',
            validate: (v) => v.startsWith('sk_') || 'Must start with sk_',
        }, {
            onCancel: () => {
                state.cancelled = true;
            },
        });
        if (state.cancelled)
            return state;
        // Set for this process
        process.env.WORKOS_SECRET_KEY = response.workosKey;
        state.workosApiKey = response.workosKey;
        console.log(chalk.green('  WorkOS key set for this session.\n'));
    }
    else {
        console.log(chalk.green('  WorkOS API key found in environment.\n'));
    }
    if (state.provider === 'auth0') {
        const auth0Creds = await prompts([
            {
                type: 'text',
                name: 'domain',
                message: 'Auth0 tenant domain (e.g. my-tenant.us.auth0.com)',
                initial: process.env.AUTH0_DOMAIN || '',
                validate: (v) => v.length > 0 || 'Required',
            },
            {
                type: 'text',
                name: 'clientId',
                message: 'Auth0 M2M Client ID',
                initial: process.env.AUTH0_CLIENT_ID || '',
                validate: (v) => v.length > 0 || 'Required',
            },
            {
                type: 'password',
                name: 'clientSecret',
                message: 'Auth0 M2M Client Secret',
                initial: process.env.AUTH0_CLIENT_SECRET || '',
                validate: (v) => v.length > 0 || 'Required',
            },
        ], {
            onCancel: () => {
                state.cancelled = true;
            },
        });
        if (state.cancelled)
            return state;
        state.auth0Domain = auth0Creds.domain;
        state.auth0ClientId = auth0Creds.clientId;
        state.auth0ClientSecret = auth0Creds.clientSecret;
        console.log(chalk.green('  Auth0 credentials configured.\n'));
    }
    if (state.provider === 'cognito') {
        const cognitoCreds = await prompts([
            {
                type: 'text',
                name: 'region',
                message: 'AWS Region (e.g. us-east-1)',
                initial: process.env.AWS_REGION || '',
                validate: (v) => v.length > 0 || 'Required',
            },
            {
                type: 'text',
                name: 'userPoolIds',
                message: 'Cognito User Pool IDs (comma-separated)',
                initial: process.env.COGNITO_USER_POOL_IDS || '',
                validate: (v) => v.length > 0 || 'Required',
            },
        ], {
            onCancel: () => {
                state.cancelled = true;
            },
        });
        if (state.cancelled)
            return state;
        state.cognitoRegion = cognitoCreds.region;
        state.cognitoUserPoolIds = cognitoCreds.userPoolIds;
        console.log(chalk.green('  AWS Cognito credentials configured.\n'));
        console.log(chalk.gray('  AWS access keys will be read from the default credential chain (env, profile, IMDS).\n'));
    }
    return state;
}
