"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Auth0Client = void 0;
const axios_1 = __importDefault(require("axios"));
const SSO_STRATEGIES = [
    'ad',
    'adfs',
    'auth0-adldap',
    'oidc',
    'okta',
    'pingfederate',
    'samlp',
];
class Auth0Client {
    constructor(credentials) {
        this.credentials = credentials;
        this.accessToken = null;
        this.grantedScopes = [];
        this.httpClient = axios_1.default.create({
            baseURL: `https://${credentials.domain}/api/v2`,
            timeout: 30000,
        });
    }
    async authenticate() {
        try {
            const response = await axios_1.default.post(`https://${this.credentials.domain}/oauth/token`, {
                client_id: this.credentials.clientId,
                client_secret: this.credentials.clientSecret,
                audience: `https://${this.credentials.domain}/api/v2/`,
                grant_type: 'client_credentials',
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            this.accessToken = response.data.access_token;
            this.grantedScopes = response.data.scope ? response.data.scope.split(' ') : [];
            this.httpClient.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
        }
        catch (error) {
            throw new Error(`Failed to authenticate with Auth0: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async validateCredentials() {
        await this.authenticate();
    }
    getScopes() {
        return this.grantedScopes;
    }
    async getAvailableEntities() {
        const baseEntities = [
            {
                key: 'users',
                name: 'Users',
                description: 'User accounts and profiles',
                enabled: this.hasRequiredScopes('users'),
            },
            {
                key: 'connections',
                name: 'Connections',
                description: 'Authentication connections (SSO, LDAP, etc.)',
                enabled: this.hasRequiredScopes('connections'),
            },
            {
                key: 'clients',
                name: 'Applications',
                description: 'Auth0 applications and their configurations',
                enabled: this.hasRequiredScopes('clients'),
            },
            {
                key: 'roles',
                name: 'Roles',
                description: 'User roles and permissions',
                enabled: this.hasRequiredScopes('roles'),
            },
            {
                key: 'organizations',
                name: 'Organizations',
                description: 'Organizations and their members',
                enabled: this.hasRequiredScopes('organizations'),
            },
        ];
        return baseEntities;
    }
    hasRequiredScopes(entityType) {
        const requiredScopes = Auth0Client.SCOPE_REQUIREMENTS[entityType] || [];
        return requiredScopes.every((scope) => this.grantedScopes.includes(scope));
    }
    async exportEntities(entityTypes) {
        if (!this.accessToken) {
            throw new Error('Not authenticated. Call authenticate() first.');
        }
        const entities = {};
        const summary = {};
        for (const entityType of entityTypes) {
            try {
                switch (entityType) {
                    case 'users':
                        entities.users = await this.getUsers();
                        break;
                    case 'connections':
                        entities.connections = await this.getConnections();
                        break;
                    case 'clients':
                        entities.clients = await this.getClients();
                        break;
                    case 'roles':
                        entities.roles = await this.getRoles();
                        break;
                    case 'organizations':
                        entities.organizations = await this.getOrganizations();
                        break;
                }
                summary[entityType] = entities[entityType]?.length || 0;
            }
            catch (error) {
                console.warn(`Failed to export ${entityType}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                entities[entityType] = [];
                summary[entityType] = 0;
            }
        }
        return {
            timestamp: new Date().toISOString(),
            provider: 'auth0',
            entities,
            summary,
        };
    }
    async getUsers() {
        const response = await this.httpClient.get('/users', {
            params: {
                per_page: 100,
                include_totals: true,
            },
        });
        const data = response.data;
        return Array.isArray(data) ? data : data.users || [];
    }
    async getConnections() {
        const response = await this.httpClient.get('/connections', {
            params: {
                per_page: 100,
                include_totals: true,
            },
        });
        const data = response.data;
        const allConnections = Array.isArray(data) ? data : data.connections || [];
        // Filter for SSO strategies
        return allConnections.filter((conn) => SSO_STRATEGIES.includes(conn.strategy.toLowerCase()));
    }
    async getClients() {
        const response = await this.httpClient.get('/clients', {
            params: {
                per_page: 100,
                include_totals: true,
            },
        });
        const data = response.data;
        return Array.isArray(data) ? data : data.clients || [];
    }
    async getRoles() {
        const response = await this.httpClient.get('/roles', {
            params: {
                per_page: 100,
                include_totals: true,
            },
        });
        const data = response.data;
        return Array.isArray(data) ? data : data.roles || [];
    }
    async getOrganizations() {
        try {
            const response = await this.httpClient.get('/organizations', {
                params: {
                    per_page: 100,
                    include_totals: true,
                },
            });
            const data = response.data;
            return Array.isArray(data) ? data : data.organizations || [];
        }
        catch (error) {
            // Organizations might not be available in all Auth0 plans
            return [];
        }
    }
}
exports.Auth0Client = Auth0Client;
Auth0Client.SCOPE_REQUIREMENTS = {
    users: ['read:users'],
    connections: ['read:connections', 'read:connections_options'],
    clients: ['read:clients'],
    roles: ['read:roles'],
    organizations: ['read:organizations'],
    permissions: ['read:resource_servers'],
};
//# sourceMappingURL=client.js.map