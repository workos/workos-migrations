"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Auth0Client = void 0;
const axios_1 = __importDefault(require("axios"));
const ssoStrategies = [
    "ad",
    "adfs",
    "auth0-adldap",
    "oidc",
    "okta",
    "pingfederate",
    "samlp",
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
                grant_type: "client_credentials",
            }, {
                headers: {
                    "Content-Type": "application/json",
                },
            });
            this.accessToken = response.data.access_token;
            this.grantedScopes = response.data.scope ? response.data.scope.split(" ") : [];
            this.httpClient.defaults.headers.common["Authorization"] = `Bearer ${this.accessToken}`;
            // Validate that we have all required scopes
            this.validateScopes();
        }
        catch (error) {
            throw new Error(`Failed to authenticate with Auth0: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }
    validateScopes() {
        const missingScopes = Auth0Client.REQUIRED_SCOPES.filter(scope => !this.grantedScopes.includes(scope));
        if (missingScopes.length > 0) {
            throw new Error(`❌ Missing required Auth0 Management API scopes: ${missingScopes.join(", ")}\n\n` +
                `Required scopes for this tool:\n` +
                `${Auth0Client.REQUIRED_SCOPES.map(scope => `  • ${scope}`).join("\n")}\n\n` +
                `Please ensure your Machine-to-Machine application has these scopes enabled in the Auth0 Dashboard:\n` +
                `1. Go to Applications > [Your M2M App] > APIs > Auth0 Management API\n` +
                `2. Enable the missing scopes: ${missingScopes.join(", ")}\n` +
                `3. Save changes and try again`);
        }
    }
    async getClients() {
        if (!this.accessToken) {
            throw new Error("Not authenticated. Call authenticate() first.");
        }
        try {
            const response = await this.httpClient.get("/clients", {
                params: {
                    per_page: 100,
                    include_totals: true,
                },
            });
            // When include_totals is true, the response has {clients: [...], total: number}
            const data = response.data;
            return Array.isArray(data) ? data : data.clients || [];
        }
        catch (error) {
            throw new Error(`Failed to fetch clients: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }
    async getConnections() {
        if (!this.accessToken) {
            throw new Error("Not authenticated. Call authenticate() first.");
        }
        try {
            // First, try to fetch all connections without filtering by strategy
            const response = await this.httpClient.get("/connections", {
                params: {
                    per_page: 100,
                    include_totals: true,
                },
            });
            // When include_totals is true, the response has {connections: [...], total: number}
            const data = response.data;
            const allConnections = Array.isArray(data)
                ? data
                : data.connections || [];
            // Filter for SSO strategies
            return allConnections.filter((conn) => ssoStrategies.includes(conn.strategy.toLowerCase()));
        }
        catch (error) {
            // If that fails, try the individual strategy approach with correct strategy names
            return await this.getConnectionsByStrategy();
        }
    }
    async getConnectionsByStrategy() {
        const allConnections = [];
        for (const strategy of ssoStrategies) {
            try {
                const response = await this.httpClient.get("/connections", {
                    params: {
                        strategy: strategy,
                        per_page: 100,
                        include_totals: true,
                    },
                });
                // When include_totals is true, the response has {connections: [...], total: number}
                const data = response.data;
                const connections = Array.isArray(data) ? data : data.connections || [];
                allConnections.push(...connections);
            }
            catch (error) {
                // Skip strategies that cause errors (might not be supported in this tenant)
                console.log(`Skipping strategy ${strategy}: ${error instanceof Error ? error.message : "Unknown error"}`);
                continue;
            }
        }
        return allConnections;
    }
    async getCustomDomains() {
        if (!this.accessToken) {
            throw new Error("Not authenticated. Call authenticate() first.");
        }
        try {
            const response = await this.httpClient.get("/custom-domains");
            return Array.isArray(response.data) ? response.data : [];
        }
        catch (error) {
            throw new Error(`Failed to fetch custom domains: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }
}
exports.Auth0Client = Auth0Client;
Auth0Client.REQUIRED_SCOPES = [
    "read:clients",
    "read:connections",
    "read:connections_options",
    "read:custom_domains"
];
//# sourceMappingURL=auth0-client.js.map