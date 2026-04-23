"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cognitoProvider = void 0;
exports.cognitoProvider = {
    name: 'cognito',
    displayName: 'AWS Cognito',
    credentials: [
        {
            key: 'accessKeyId',
            name: 'AWS Access Key ID',
            type: 'input',
            required: true,
            envVar: 'AWS_ACCESS_KEY_ID',
        },
        {
            key: 'secretAccessKey',
            name: 'AWS Secret Access Key',
            type: 'password',
            required: true,
            envVar: 'AWS_SECRET_ACCESS_KEY',
        },
        {
            key: 'region',
            name: 'AWS Region',
            type: 'input',
            required: true,
            envVar: 'AWS_REGION',
        },
        {
            key: 'userPoolId',
            name: 'User Pool ID',
            type: 'input',
            required: true,
            envVar: 'COGNITO_USER_POOL_ID',
        },
    ],
    entities: [
        {
            key: 'users',
            name: 'Users',
            description: 'Cognito user pool users',
            enabled: false,
        },
        {
            key: 'groups',
            name: 'Groups',
            description: 'User pool groups',
            enabled: false,
        },
    ],
};
