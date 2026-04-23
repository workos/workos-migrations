"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerPrefix = exports.summarizeAuth0Users = exports.toWorkOSUserRow = exports.transformAuth0Connections = exports.Auth0Client = exports.auth0Provider = void 0;
exports.auth0Provider = {
    name: 'auth0',
    displayName: 'Auth0',
    credentials: [
        {
            key: 'clientId',
            name: 'Client ID',
            type: 'input',
            required: true,
            envVar: 'AUTH0_CLIENT_ID',
        },
        {
            key: 'clientSecret',
            name: 'Client Secret',
            type: 'password',
            required: true,
            envVar: 'AUTH0_CLIENT_SECRET',
        },
        {
            key: 'domain',
            name: 'Domain (e.g., your-tenant.auth0.com)',
            type: 'input',
            required: true,
            envVar: 'AUTH0_DOMAIN',
        },
    ],
    entities: [
        {
            key: 'users',
            name: 'Users',
            description: 'User accounts and profiles',
            enabled: true,
        },
        {
            key: 'connections',
            name: 'Connections',
            description: 'Authentication connections (SSO, LDAP, etc.)',
            enabled: true,
        },
        {
            key: 'clients',
            name: 'Applications',
            description: 'Auth0 applications and their configurations',
            enabled: true,
        },
        {
            key: 'roles',
            name: 'Roles',
            description: 'User roles and permissions',
            enabled: true,
        },
        {
            key: 'organizations',
            name: 'Organizations',
            description: 'Organizations and their members',
            enabled: true,
        },
    ],
};
var client_1 = require("./client");
Object.defineProperty(exports, "Auth0Client", { enumerable: true, get: function () { return client_1.Auth0Client; } });
var transform_1 = require("./transform");
Object.defineProperty(exports, "transformAuth0Connections", { enumerable: true, get: function () { return transform_1.transformAuth0Connections; } });
var user_1 = require("./user");
Object.defineProperty(exports, "toWorkOSUserRow", { enumerable: true, get: function () { return user_1.toWorkOSUserRow; } });
Object.defineProperty(exports, "summarizeAuth0Users", { enumerable: true, get: function () { return user_1.summarizeAuth0Users; } });
Object.defineProperty(exports, "providerPrefix", { enumerable: true, get: function () { return user_1.providerPrefix; } });
