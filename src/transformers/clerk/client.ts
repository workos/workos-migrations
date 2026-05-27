import type { ClerkEnterpriseConnection } from './sso-mapper.js';

export interface ClerkClientOptions {
  secretKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class ClerkApiError extends Error {
  statusCode: number;
  body: string;
  path: string;

  constructor(statusCode: number, body: string, path: string) {
    super(`Clerk API error (${statusCode}) for ${path}: ${body}`);
    this.name = 'ClerkApiError';
    this.statusCode = statusCode;
    this.body = body;
    this.path = path;
  }
}

interface ListEnterpriseConnectionsResponse {
  data?: ClerkEnterpriseConnection[];
  total_count?: number;
}

const DEFAULT_BASE_URL = 'https://api.clerk.com/v1';
const PAGE_LIMIT = 500;

export class ClerkClient {
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClerkClientOptions) {
    if (!options.secretKey) {
      throw new Error('ClerkClient requires a secretKey');
    }
    this.secretKey = options.secretKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Lists every enterprise connection (SAML + OIDC) via the unified
   * `/v1/enterprise_connections` endpoint. Replaces the deprecated
   * `/v1/saml_connections` path.
   */
  async listEnterpriseConnections(): Promise<ClerkEnterpriseConnection[]> {
    const results: ClerkEnterpriseConnection[] = [];
    let offset = 0;

    while (true) {
      const url = `${this.baseUrl}/enterprise_connections?limit=${PAGE_LIMIT}&offset=${offset}`;
      const page = await this.requestJson<
        ListEnterpriseConnectionsResponse | ClerkEnterpriseConnection[]
      >(url);
      const items = Array.isArray(page) ? page : (page.data ?? []);

      results.push(...items);

      if (items.length < PAGE_LIMIT) break;
      offset += items.length;
    }

    return results;
  }

  private async requestJson<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await safeReadBody(response);
      throw new ClerkApiError(response.status, body, new URL(url).pathname);
    }

    return (await response.json()) as T;
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
