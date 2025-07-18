import axios, { AxiosInstance } from 'axios';

interface Auth0Credentials {
  clientId: string;
  clientSecret: string;
  domain: string;
}

interface Auth0TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface Auth0Client {
  id: string;
  name: string;
  client_id: string;
  app_type: string;
  is_first_party: boolean;
  is_heroku_app: boolean;
  callbacks: string[];
  allowed_origins: string[];
  web_origins: string[];
  client_aliases: string[];
  allowed_clients: string[];
  allowed_logout_urls: string[];
  jwt_configuration: any;
  client_metadata: any;
  mobile: any;
  initiate_login_uri: string;
  native_social_login: any;
  refresh_token: any;
  oidc_conformant: boolean;
  cross_origin_auth: boolean;
  sso: boolean;
  sso_disabled: boolean;
  cross_origin_authentication: boolean;
  signing_keys: any[];
  grant_types: string[];
  custom_login_page_on: boolean;
  organization_usage: string;
  organization_require_behavior: string;
}

export interface Auth0Connection {
  id: string;
  options: any;
  strategy: string;
  name: string;
  provisioning_ticket_url: string;
  enabled_clients: string[];
  is_domain_connection: boolean;
  realms: string[];
  metadata: any;
  display_name: string;
}

export class Auth0Client {
  private httpClient: AxiosInstance;
  private accessToken: string | null = null;

  constructor(private credentials: Auth0Credentials) {
    this.httpClient = axios.create({
      baseURL: `https://${credentials.domain}/api/v2`,
      timeout: 30000,
    });
  }

  async authenticate(): Promise<void> {
    try {
      const response = await axios.post<Auth0TokenResponse>(
        `https://${this.credentials.domain}/oauth/token`,
        {
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          audience: `https://${this.credentials.domain}/api/v2/`,
          grant_type: 'client_credentials',
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      this.accessToken = response.data.access_token;
      this.httpClient.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
    } catch (error) {
      throw new Error(`Failed to authenticate with Auth0: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getClients(): Promise<Auth0Client[]> {
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
    } catch (error) {
      throw new Error(`Failed to fetch clients: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getConnections(): Promise<Auth0Connection[]> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const ssoStrategies = ['ad', 'adfs', 'saml', 'oidc', 'okta', 'ping-federate'];
    const allConnections: Auth0Connection[] = [];

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
    } catch (error) {
      throw new Error(`Failed to fetch connections: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}