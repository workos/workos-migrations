export const firebaseProvider = {
    name: 'firebase',
    displayName: 'Firebase Auth',
    credentials: [
        {
            key: 'projectId',
            name: 'Project ID',
            type: 'input',
            required: true,
            envVar: 'FIREBASE_PROJECT_ID',
        },
        {
            key: 'serviceAccountKey',
            name: 'Service Account Key (JSON)',
            type: 'password',
            required: true,
            envVar: 'FIREBASE_SERVICE_ACCOUNT_KEY',
        },
    ],
    entities: [
        {
            key: 'users',
            name: 'Users',
            description: 'Firebase Auth users',
            enabled: false,
        },
        {
            key: 'customClaims',
            name: 'Custom Claims',
            description: 'User custom claims and roles',
            enabled: false,
        },
    ],
};
