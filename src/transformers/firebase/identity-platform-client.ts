import type { FirebaseInboundSamlConfig, FirebaseOAuthIdpConfig } from './sso-mapper.js';

export interface IdentityPlatformTenant {
  /** Fully qualified resource name e.g. `projects/{p}/tenants/{tenantId}`. */
  name?: string | null;
  displayName?: string | null;
}

export interface IdentityPlatformAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface IdentityPlatformClientOptions {
  projectId: string;
  accessTokenProvider: IdentityPlatformAccessTokenProvider;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class IdentityPlatformApiError extends Error {
  statusCode: number;
  body: string;
  path: string;

  constructor(statusCode: number, body: string, path: string) {
    super(`Identity Platform API error (${statusCode}) for ${path}: ${body}`);
    this.name = 'IdentityPlatformApiError';
    this.statusCode = statusCode;
    this.body = body;
    this.path = path;
  }
}

const DEFAULT_BASE_URL = 'https://identitytoolkit.googleapis.com';
const PAGE_SIZE = 100;

interface ListInboundSamlConfigsResponse {
  inboundSamlConfigs?: FirebaseInboundSamlConfig[];
  nextPageToken?: string;
}

interface ListOAuthIdpConfigsResponse {
  oauthIdpConfigs?: FirebaseOAuthIdpConfig[];
  nextPageToken?: string;
}

interface ListTenantsResponse {
  tenants?: IdentityPlatformTenant[];
  nextPageToken?: string;
}

export class IdentityPlatformClient {
  private readonly projectId: string;
  private readonly tokenProvider: IdentityPlatformAccessTokenProvider;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IdentityPlatformClientOptions) {
    if (!options.projectId) {
      throw new Error('IdentityPlatformClient requires a projectId');
    }
    this.projectId = options.projectId;
    this.tokenProvider = options.accessTokenProvider;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listTenants(): Promise<IdentityPlatformTenant[]> {
    return this.paginate<IdentityPlatformTenant, ListTenantsResponse>(
      `/v2/projects/${this.projectId}/tenants`,
      (page) => page.tenants ?? [],
    );
  }

  async listInboundSamlConfigs(tenantId?: string): Promise<FirebaseInboundSamlConfig[]> {
    const path = this.scopedPath(tenantId, 'inboundSamlConfigs');
    return this.paginate<FirebaseInboundSamlConfig, ListInboundSamlConfigsResponse>(
      path,
      (page) => page.inboundSamlConfigs ?? [],
    );
  }

  async listOAuthIdpConfigs(tenantId?: string): Promise<FirebaseOAuthIdpConfig[]> {
    const path = this.scopedPath(tenantId, 'oauthIdpConfigs');
    return this.paginate<FirebaseOAuthIdpConfig, ListOAuthIdpConfigsResponse>(
      path,
      (page) => page.oauthIdpConfigs ?? [],
    );
  }

  private scopedPath(tenantId: string | undefined, resource: string): string {
    return tenantId
      ? `/v2/projects/${this.projectId}/tenants/${tenantId}/${resource}`
      : `/v2/projects/${this.projectId}/${resource}`;
  }

  private async paginate<TItem, TResponse extends { nextPageToken?: string }>(
    basePath: string,
    selector: (page: TResponse) => TItem[],
  ): Promise<TItem[]> {
    const results: TItem[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${this.baseUrl}${basePath}`);
      url.searchParams.set('pageSize', String(PAGE_SIZE));
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const page = await this.requestJson<TResponse>(url.toString());
      results.push(...selector(page));
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);

    return results;
  }

  private async requestJson<T>(url: string): Promise<T> {
    const token = await this.tokenProvider.getAccessToken();
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await safeReadBody(response);
      throw new IdentityPlatformApiError(response.status, body, new URL(url).pathname);
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
