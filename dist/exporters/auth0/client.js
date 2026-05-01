import { RateLimiter } from '../../shared/rate-limiter.js';
export class Auth0ApiError extends Error {
    statusCode;
    body;
    path;
    constructor(statusCode, body, path) {
        super(`Auth0 API error (${statusCode}): ${body}`);
        this.name = 'Auth0ApiError';
        this.statusCode = statusCode;
        this.body = body;
        this.path = path;
    }
}
export function isMissingConnectionOptionsScopeError(error) {
    if (!(error instanceof Auth0ApiError))
        return false;
    if (error.statusCode !== 403)
        return false;
    const body = error.body.toLowerCase();
    return (body.includes('read:connections_options') ||
        (body.includes('connection') && body.includes('option') && body.includes('scope')));
}
export class Auth0Client {
    domain;
    clientId;
    clientSecret;
    rateLimiter;
    accessToken;
    tokenExpiry;
    constructor(options) {
        this.domain = options.domain;
        this.clientId = options.clientId;
        this.clientSecret = options.clientSecret;
        this.rateLimiter = new RateLimiter(options.rateLimit ?? 50);
    }
    async getAccessToken() {
        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }
        const tokenUrl = `https://${this.domain}/oauth/token`;
        const audience = `https://${this.domain}/api/v2/`;
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                audience,
                grant_type: 'client_credentials',
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to get Auth0 access token: ${error}`);
        }
        const data = (await response.json());
        if (!data.access_token) {
            throw new Error('No access token in Auth0 response');
        }
        this.accessToken = data.access_token;
        const expiresIn = data.expires_in ?? 86400;
        this.tokenExpiry = Date.now() + (expiresIn - 300) * 1000;
        return this.accessToken;
    }
    async apiCall(path, init = {}) {
        return this.retryWithRateLimit(async () => {
            const token = await this.getAccessToken();
            const url = `https://${this.domain}${path}`;
            const response = await fetch(url, {
                ...init,
                headers: {
                    ...init.headers,
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After');
                const error = new Error('Rate limit exceeded');
                error.statusCode = 429;
                if (retryAfter) {
                    error.retryAfterMs = parseFloat(retryAfter) * 1000;
                }
                throw error;
            }
            if (!response.ok) {
                const body = await response.text();
                throw new Auth0ApiError(response.status, body, path);
            }
            return (await response.json());
        });
    }
    async retryWithRateLimit(fn, maxRetries = 5, baseDelayMs = 2000) {
        let attempt = 0;
        for (;;) {
            try {
                await this.rateLimiter.acquire();
                return await fn();
            }
            catch (error) {
                const err = error;
                const isRateLimited = err.statusCode === 429 || /rate.?limit/i.test(err.message ?? '');
                attempt++;
                if (isRateLimited && attempt <= maxRetries) {
                    const delay = err.retryAfterMs ?? baseDelayMs * Math.pow(2, attempt - 1);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }
                throw error;
            }
        }
    }
    async getOrganizations(page = 0, perPage = 100) {
        const data = await this.apiCall(`/api/v2/organizations?page=${page}&per_page=${perPage}`);
        const orgs = Array.isArray(data) ? data : (data.organizations ?? []);
        return orgs.map((org) => ({
            id: org.id,
            name: org.name,
            display_name: org.display_name,
            branding: org.branding,
            metadata: org.metadata,
        }));
    }
    async getConnections(page = 0, perPage = 100, strategy) {
        const params = new URLSearchParams({
            page: String(page),
            per_page: String(perPage),
            include_totals: 'false',
        });
        if (strategy) {
            const strategies = Array.isArray(strategy) ? strategy : [strategy];
            for (const value of strategies) {
                params.append('strategy', value);
            }
        }
        const data = await this.apiCall(`/api/v2/connections?${params.toString()}`);
        return Array.isArray(data) ? data : (data.connections ?? []);
    }
    async getConnection(connectionId) {
        return this.apiCall(`/api/v2/connections/${encodeURIComponent(connectionId)}`);
    }
    async getOrganizationConnections(orgId, page = 0, perPage = 100) {
        const data = await this.apiCall(`/api/v2/organizations/${encodeURIComponent(orgId)}/enabled_connections?page=${page}&per_page=${perPage}`);
        return Array.isArray(data) ? data : (data.enabled_connections ?? []);
    }
    async getOrganizationMembers(orgId, page = 0, perPage = 100) {
        const data = await this.apiCall(`/api/v2/organizations/${orgId}/members?page=${page}&per_page=${perPage}`);
        return Array.isArray(data) ? data : (data.members ?? []);
    }
    async getUser(userId) {
        try {
            return await this.apiCall(`/api/v2/users/${encodeURIComponent(userId)}`);
        }
        catch (error) {
            if (error instanceof Auth0ApiError && error.statusCode === 404)
                return null;
            throw error;
        }
    }
    async getUsers(page = 0, perPage = 100) {
        const data = await this.apiCall(`/api/v2/users?page=${page}&per_page=${perPage}&include_totals=false`);
        return Array.isArray(data) ? data : (data.users ?? []);
    }
    async getMemberRoles(orgId, userId, page = 0, perPage = 100) {
        const data = await this.apiCall(`/api/v2/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/roles?page=${page}&per_page=${perPage}`);
        return Array.isArray(data) ? data : (data.roles ?? []);
    }
    async getRoles(page = 0, perPage = 100) {
        const data = await this.apiCall(`/api/v2/roles?page=${page}&per_page=${perPage}`);
        return Array.isArray(data) ? data : (data.roles ?? []);
    }
    async createUserExportJob(options = {}) {
        const body = {
            format: options.format ?? 'json',
        };
        if (options.connectionId)
            body.connection_id = options.connectionId;
        if (options.limit !== undefined)
            body.limit = options.limit;
        if (options.fields)
            body.fields = options.fields;
        return this.apiCall('/api/v2/jobs/users-exports', {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }
    async getJob(jobId) {
        return this.apiCall(`/api/v2/jobs/${encodeURIComponent(jobId)}`);
    }
    async downloadJobLocation(location) {
        return this.retryWithRateLimit(async () => {
            const response = await fetch(location);
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After');
                const error = new Error('Rate limit exceeded');
                error.statusCode = 429;
                if (retryAfter) {
                    error.retryAfterMs = parseFloat(retryAfter) * 1000;
                }
                throw error;
            }
            if (!response.ok) {
                throw new Error(`Failed to download Auth0 job output (${response.status})`);
            }
            return response.text();
        });
    }
    async testConnection() {
        try {
            await this.getOrganizations(0, 1);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
}
