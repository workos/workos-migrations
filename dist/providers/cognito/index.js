export const cognitoProvider = {
    name: 'cognito',
    displayName: 'AWS Cognito',
    credentials: [
        {
            key: 'region',
            name: 'AWS Region',
            type: 'input',
            required: true,
            envVar: 'AWS_REGION',
        },
        {
            key: 'userPoolIds',
            name: 'User Pool IDs (comma-separated)',
            type: 'input',
            required: true,
            envVar: 'COGNITO_USER_POOL_IDS',
        },
        {
            key: 'accessKeyId',
            name: 'AWS Access Key ID (leave blank to use default credential chain)',
            type: 'input',
            required: false,
            envVar: 'AWS_ACCESS_KEY_ID',
        },
        {
            key: 'secretAccessKey',
            name: 'AWS Secret Access Key (leave blank to use default credential chain)',
            type: 'password',
            required: false,
            envVar: 'AWS_SECRET_ACCESS_KEY',
        },
        {
            key: 'sessionToken',
            name: 'AWS Session Token (optional)',
            type: 'password',
            required: false,
            envVar: 'AWS_SESSION_TOKEN',
        },
    ],
    entities: [
        {
            key: 'connections',
            name: 'Connections',
            description: 'Identity providers attached to Cognito user pools (SAML + OIDC)',
            enabled: true,
        },
        {
            key: 'users',
            name: 'Users',
            description: 'Cognito user pool users (password hashes not exportable)',
            enabled: true,
        },
    ],
};
export { CognitoClient } from './client.js';
