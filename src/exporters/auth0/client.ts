import type { Auth0User, Auth0Organization } from '../../shared/types.js';
import { RateLimiter } from '../../shared/rate-limiter.js';

export interface Auth0ClientOptions {
  domain: string;
  clientId: string;
  clientSecret: string;
  rateLimit?: number;
}

export class Auth0Client {
  private domain: string;
  private clientId: string;
  private clientSecret: string;
  private rateLimiter: RateLimiter;
  private accessToken?: string;
  private tokenExpiry?: number;

  constructor(options: Auth0ClientOptions) {
    this.domain = options.domain;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.rateLimiter = new RateLimiter(options.rateLimit ?? 50);
  }

  async getAccessToken(): Promise<string> {
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

    const data = (await response.json()) as { access_token?: string; expires_in?: number };

    if (!data.access_token) {
      throw new Error('No access token in Auth0 response');
    }

    this.accessToken = data.access_token;
    const expiresIn = data.expires_in ?? 86400;
    this.tokenExpiry = Date.now() + (expiresIn - 300) * 1000;

    return this.accessToken;
  }

  private async apiCall<T>(path: string): Promise<T> {
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
        const error: Error & { statusCode?: number; retryAfterMs?: number } = new Error(
          'Rate limit exceeded',
        );
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

      return (await response.json()) as T;
    });
  }

  private async retryWithRateLimit<T>(
    fn: () => Promise<T>,
    maxRetries = 5,
    baseDelayMs = 2000,
  ): Promise<T> {
    let attempt = 0;

    for (;;) {
      try {
        await this.rateLimiter.acquire();
        return await fn();
      } catch (error: unknown) {
        const err = error as Error & { statusCode?: number; retryAfterMs?: number };
        const isRateLimited =
          err.statusCode === 429 || /rate.?limit/i.test(err.message ?? '');

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

  async getOrganizations(page = 0, perPage = 100): Promise<Auth0Organization[]> {
    const data = await this.apiCall<
      Auth0Organization[] | { organizations?: Auth0Organization[] }
    >(`/api/v2/organizations?page=${page}&per_page=${perPage}`);

    const orgs = Array.isArray(data) ? data : (data.organizations ?? []);
    return orgs.map((org) => ({
      id: org.id,
      name: org.name,
      display_name: org.display_name,
      branding: org.branding,
      metadata: org.metadata,
    }));
  }

  async getOrganizationMembers(
    orgId: string,
    page = 0,
    perPage = 100,
  ): Promise<Array<{ user_id: string }>> {
    const data = await this.apiCall<
      Array<{ user_id: string }> | { members?: Array<{ user_id: string }> }
    >(`/api/v2/organizations/${orgId}/members?page=${page}&per_page=${perPage}`);

    return Array.isArray(data) ? data : (data.members ?? []);
  }

  async getUser(userId: string): Promise<Auth0User | null> {
    try {
      return await this.apiCall<Auth0User>(`/api/v2/users/${encodeURIComponent(userId)}`);
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      if (err.message?.includes('404')) return null;
      throw error;
    }
  }

  async getUsers(page = 0, perPage = 100): Promise<Auth0User[]> {
    const data = await this.apiCall<Auth0User[] | { users?: Auth0User[] }>(
      `/api/v2/users?page=${page}&per_page=${perPage}&include_totals=false`,
    );

    return Array.isArray(data) ? data : (data.users ?? []);
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.getOrganizations(0, 1);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }
}
