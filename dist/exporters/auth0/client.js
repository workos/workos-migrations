import { RateLimiter } from '../../shared/rate-limiter.js';
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
    async apiCall(path) {
        return this.retryWithRateLimit(async () => {
            const token = await this.getAccessToken();
            const url = `https://${this.domain}${path}`;
            const response = await fetch(url, {
                headers: {
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
                throw new Error(`Auth0 API error (${response.status}): ${body}`);
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
    async getOrganizationMembers(orgId, page = 0, perPage = 100) {
        const data = await this.apiCall(`/api/v2/organizations/${orgId}/members?page=${page}&per_page=${perPage}`);
        return Array.isArray(data) ? data : (data.members ?? []);
    }
    async getUser(userId) {
        try {
            return await this.apiCall(`/api/v2/users/${encodeURIComponent(userId)}`);
        }
        catch (error) {
            const err = error;
            if (err.message?.includes('404'))
                return null;
            throw error;
        }
    }
    async getUsers(page = 0, perPage = 100) {
        const data = await this.apiCall(`/api/v2/users?page=${page}&per_page=${perPage}&include_totals=false`);
        return Array.isArray(data) ? data : (data.users ?? []);
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
