"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Auth0Client = void 0;
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const transform_1 = require("./transform");
const user_1 = require("./user");
const csv_1 = require("../../shared/csv");
class Auth0Client {
    constructor(credentials, transformConfig = {}, outputDir) {
        this.credentials = credentials;
        this.transformConfig = transformConfig;
        this.outputDir = outputDir;
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
        const outputFiles = [];
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
        // Run the connection transform whenever connections were fetched.
        // Writes SAML + OIDC CSVs alongside the raw JSON dump.
        if (Array.isArray(entities.connections) && entities.connections.length > 0) {
            const transformResult = (0, transform_1.transformAuth0Connections)(entities.connections, this.transformConfig);
            outputFiles.push(...this.writeTransformOutputs(transformResult));
            this.printTransformSummary(transformResult);
            entities.transform_summary = [
                {
                    samlCount: transformResult.samlCount,
                    oidcCount: transformResult.oidcCount,
                    skipped: transformResult.skipped,
                    manualSetup: transformResult.manualSetup,
                    samlIdpInitiatedDisabled: transformResult.samlIdpInitiatedDisabled,
                },
            ];
        }
        // Users transform → workos_users.csv matching the shared users template.
        if (Array.isArray(entities.users) && entities.users.length > 0) {
            const userRows = entities.users.map(user_1.toWorkOSUserRow);
            const userSummary = (0, user_1.summarizeAuth0Users)(entities.users, userRows);
            outputFiles.push(this.writeUsersCsv(userRows));
            this.printUserSummary(userSummary);
            entities.user_transform_summary = [userSummary];
        }
        if (outputFiles.length > 0)
            entities.output_files = outputFiles;
        return {
            timestamp: new Date().toISOString(),
            provider: 'auth0',
            entities,
            summary,
        };
    }
    writeUsersCsv(rows) {
        const outDir = this.outputDir ?? process.cwd();
        fs_1.default.mkdirSync(outDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const usersPath = path_1.default.join(outDir, `auth0_users_${timestamp}.csv`);
        fs_1.default.writeFileSync(usersPath, (0, csv_1.rowsToCsv)(csv_1.USER_HEADERS, rows));
        return usersPath;
    }
    printUserSummary(summary) {
        console.log(chalk_1.default.blue('\n  Auth0 → WorkOS users transform summary:'));
        console.log(chalk_1.default.gray(`    Total rows: ${summary.total}`));
        for (const [provider, count] of Object.entries(summary.byProvider).sort()) {
            console.log(chalk_1.default.gray(`      • ${provider}: ${count}`));
        }
        if (summary.missingEmail > 0) {
            console.log(chalk_1.default.yellow(`    [warn] ${summary.missingEmail} user(s) have no email — likely phone-only passwordless accounts`));
        }
        if (summary.missingName > 0) {
            console.log(chalk_1.default.yellow(`    [warn] ${summary.missingName} user(s) have no first/last name`));
        }
        if (summary.total > 0) {
            console.log(chalk_1.default.yellow(`    [note] password_hash is blank for all users — Auth0 Management API does not expose hashes. ` +
                `Affected users will need to reset passwords, or use the Auth0 users-export extension for a bulk hash dump.`));
        }
    }
    writeTransformOutputs(result) {
        const outDir = this.outputDir ?? process.cwd();
        fs_1.default.mkdirSync(outDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const samlPath = path_1.default.join(outDir, `auth0_saml_${timestamp}.csv`);
        const oidcPath = path_1.default.join(outDir, `auth0_oidc_${timestamp}.csv`);
        fs_1.default.writeFileSync(samlPath, result.samlCsv);
        fs_1.default.writeFileSync(oidcPath, result.oidcCsv);
        return [samlPath, oidcPath];
    }
    printTransformSummary(result) {
        console.log(chalk_1.default.blue('\n  Auth0 → WorkOS transform summary:'));
        console.log(chalk_1.default.gray(`    SAML rows: ${result.samlCount}`));
        console.log(chalk_1.default.gray(`    OIDC rows: ${result.oidcCount}`));
        if (result.samlIdpInitiatedDisabled.length > 0) {
            console.log(chalk_1.default.yellow(`    [warn] ${result.samlIdpInitiatedDisabled.length} SAML connection(s) have IdP-initiated SSO disabled`));
        }
        const skippedSaml = result.skipped.filter((s) => s.type === 'SAML');
        const skippedOidc = result.skipped.filter((s) => s.type === 'OIDC');
        if (skippedSaml.length > 0 || skippedOidc.length > 0) {
            console.log(chalk_1.default.yellow(`    [warn] skipped: ${skippedSaml.length} SAML / ${skippedOidc.length} OIDC`));
            for (const s of result.skipped) {
                console.log(chalk_1.default.gray(`      • ${s.connectionName} [${s.type}] — ${s.reason}`));
            }
        }
        if (result.manualSetup.length > 0) {
            console.log(chalk_1.default.yellow(`    [warn] ${result.manualSetup.length} connection(s) need manual setup in WorkOS:`));
            for (const m of result.manualSetup) {
                console.log(chalk_1.default.gray(`      • ${m.connectionName} [${m.strategy}] — ${m.reason}`));
            }
        }
        if (result.outOfScope.length > 0) {
            const byCategory = result.outOfScope.reduce((acc, c) => {
                acc[c.category] = (acc[c.category] ?? 0) + 1;
                return acc;
            }, {});
            const breakdown = Object.entries(byCategory)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ');
            console.log(chalk_1.default.gray(`    [info] ${result.outOfScope.length} connection(s) filtered out as non-SSO (${breakdown}) — ` +
                `social connections reconfigure in the WorkOS dashboard; database connections migrate via users.csv.`));
        }
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
        // Filter to the enterprise strategies the transform layer knows how to
        // process. Kept in lockstep with `MIGRATABLE_STRATEGIES` so every strategy
        // with a dedicated processor — SAML (samlp, adfs, pingfederate), OIDC
        // (oidc, waad, google-apps, okta), and manual-setup (ad, auth0-adldap) —
        // reaches the transform. Out-of-scope connections (social, database,
        // passwordless) are filtered here to keep the raw export dump small.
        return allConnections.filter((conn) => typeof conn.strategy === 'string' &&
            transform_1.MIGRATABLE_STRATEGIES.has(conn.strategy.toLowerCase()));
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
