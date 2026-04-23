"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clerkProvider = void 0;
exports.clerkProvider = {
    name: 'clerk',
    displayName: 'Clerk',
    credentials: [
        {
            key: 'secretKey',
            name: 'Secret Key',
            type: 'password',
            required: true,
            envVar: 'CLERK_SECRET_KEY',
        },
    ],
    entities: [
        {
            key: 'users',
            name: 'Users',
            description: 'User accounts and profiles',
            enabled: false,
        },
        {
            key: 'organizations',
            name: 'Organizations',
            description: 'Organizations and their members',
            enabled: false,
        },
    ],
};
