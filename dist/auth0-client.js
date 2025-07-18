"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Auth0Client = void 0;
const axios_1 = __importDefault(require("axios"));
class Auth0Client {
    constructor(credentials) {
        this.credentials = credentials;
        this.accessToken = null;
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
            this.httpClient.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
        }
        catch (error) {
            throw new Error(`Failed to authenticate with Auth0: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getClients() {
        if (!this.accessToken) {
            throw new Error('Not authenticated. Call authenticate() first.');
        }
        try {
            const response = await this.httpClient.get('/clients', {
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
            throw new Error(`Failed to fetch clients: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getConnections() {
        if (!this.accessToken) {
            throw new Error('Not authenticated. Call authenticate() first.');
        }
        const ssoStrategies = ['ad', 'adfs', 'saml', 'oidc', 'okta', 'ping-federate'];
        const allConnections = [];
        try {
            for (const strategy of ssoStrategies) {
                let page = 0;
                let hasMore = true;
                while (hasMore) {
                    const response = await this.httpClient.get('/connections', {
                        params: {
                            strategy: strategy,
                            per_page: 100,
                            page: page,
                            include_totals: true,
                        },
                    });
                    // When include_totals is true, the response has {connections: [...], total: number}
                    const data = response.data;
                    const connections = Array.isArray(data) ? data : data.connections || [];
                    allConnections.push(...connections);
                    hasMore = connections.length === 100;
                    page++;
                }
            }
            return allConnections;
        }
        catch (error) {
            throw new Error(`Failed to fetch connections: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
exports.Auth0Client = Auth0Client;
//# sourceMappingURL=auth0-client.js.map