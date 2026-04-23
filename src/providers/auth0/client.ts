import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { ProviderClient, EntityType, ExportResult, ProviderCredentials } from '../../types';
import {
  transformAuth0Connections,
  type Auth0TransformConfig,
  type TransformResult,
} from './transform';

interface Auth0TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface Auth0User {
  user_id: string;
  email: string;
  name: string;
  created_at: string;
  updated_at: string;
  [key: string]: any;
}

export interface Auth0Connection {
  id: string;
  name: string;
  strategy: string;
  display_name: string;
  enabled_clients: string[];
  options: any;
  [key: string]: any;
}

export interface Auth0Client {
  client_id: string;
  name: string;
  app_type: string;
  is_first_party: boolean;
  callbacks: string[];
  [key: string]: any;
}

export interface Auth0Role {
  id: string;
  name: string;
  description: string;
  [key: string]: any;
}

export interface Auth0Organization {
  id: string;
  name: string;
  display_name: string;
  [key: string]: any;
}

const SSO_STRATEGIES = [
  'ad',
  'adfs', 
  'auth0-adldap',
  'oidc',
  'okta',
  'pingfederate',
  'samlp',
];

export class Auth0Client implements ProviderClient {
  private httpClient: AxiosInstance;
  private accessToken: string | null = null;
  private grantedScopes: string[] = [];

  private static readonly SCOPE_REQUIREMENTS: { [key: string]: string[] } = {
    users: ['read:users'],
    connections: ['read:connections', 'read:connections_options'],
    clients: ['read:clients'],
    roles: ['read:roles'],
    organizations: ['read:organizations'],
    permissions: ['read:resource_servers'],
  };

  constructor(
    private credentials: ProviderCredentials,
    private transformConfig: Auth0TransformConfig = {},
    private outputDir?: string,
  ) {
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
      this.grantedScopes = response.data.scope ? response.data.scope.split(' ') : [];
      
      this.httpClient.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
    } catch (error) {
      throw new Error(
        `Failed to authenticate with Auth0: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  async validateCredentials(): Promise<void> {
    await this.authenticate();
  }

  getScopes(): string[] {
    return this.grantedScopes;
  }

  async getAvailableEntities(): Promise<EntityType[]> {
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

  private hasRequiredScopes(entityType: string): boolean {
    const requiredScopes = Auth0Client.SCOPE_REQUIREMENTS[entityType] || [];
    return requiredScopes.every((scope: string) => this.grantedScopes.includes(scope));
  }

  async exportEntities(entityTypes: string[]): Promise<ExportResult> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const entities: Record<string, any[]> = {};
    const summary: Record<string, number> = {};
    const outputFiles: string[] = [];

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
      } catch (error) {
        console.warn(`Failed to export ${entityType}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        entities[entityType] = [];
        summary[entityType] = 0;
      }
    }

    // Run the connection transform whenever connections were fetched.
    // Writes SAML + OIDC CSVs alongside the raw JSON dump.
    if (Array.isArray(entities.connections) && entities.connections.length > 0) {
      const transformResult = transformAuth0Connections(
        entities.connections,
        entities.clients,
        this.transformConfig,
      );
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

    if (outputFiles.length > 0) entities.output_files = outputFiles;

    return {
      timestamp: new Date().toISOString(),
      provider: 'auth0',
      entities,
      summary,
    };
  }

  private writeTransformOutputs(result: TransformResult): string[] {
    const outDir = this.outputDir ?? process.cwd();
    fs.mkdirSync(outDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const samlPath = path.join(outDir, `auth0_saml_${timestamp}.csv`);
    const oidcPath = path.join(outDir, `auth0_oidc_${timestamp}.csv`);
    fs.writeFileSync(samlPath, result.samlCsv);
    fs.writeFileSync(oidcPath, result.oidcCsv);
    return [samlPath, oidcPath];
  }

  private printTransformSummary(result: TransformResult): void {
    console.log(chalk.blue('\n  Auth0 → WorkOS transform summary:'));
    console.log(chalk.gray(`    SAML rows: ${result.samlCount}`));
    console.log(chalk.gray(`    OIDC rows: ${result.oidcCount}`));

    if (result.samlIdpInitiatedDisabled.length > 0) {
      console.log(
        chalk.yellow(
          `    [warn] ${result.samlIdpInitiatedDisabled.length} SAML connection(s) have IdP-initiated SSO disabled`,
        ),
      );
    }

    const skippedSaml = result.skipped.filter((s) => s.type === 'SAML');
    const skippedOidc = result.skipped.filter((s) => s.type === 'OIDC');
    if (skippedSaml.length > 0 || skippedOidc.length > 0) {
      console.log(
        chalk.yellow(
          `    [warn] skipped: ${skippedSaml.length} SAML / ${skippedOidc.length} OIDC`,
        ),
      );
      for (const s of result.skipped) {
        console.log(chalk.gray(`      • ${s.connectionName} [${s.type}] — ${s.reason}`));
      }
    }

    if (result.manualSetup.length > 0) {
      console.log(
        chalk.yellow(
          `    [warn] ${result.manualSetup.length} connection(s) need manual setup in WorkOS:`,
        ),
      );
      for (const m of result.manualSetup) {
        console.log(chalk.gray(`      • ${m.connectionName} [${m.strategy}] — ${m.reason}`));
      }
    }
  }

  private async getUsers(): Promise<Auth0User[]> {
    const response = await this.httpClient.get('/users', {
      params: {
        per_page: 100,
        include_totals: true,
      },
    });

    const data = response.data;
    return Array.isArray(data) ? data : data.users || [];
  }

  private async getConnections(): Promise<Auth0Connection[]> {
    const response = await this.httpClient.get('/connections', {
      params: {
        per_page: 100,
        include_totals: true,
      },
    });

    const data = response.data;
    const allConnections = Array.isArray(data) ? data : data.connections || [];
    
    // Filter for SSO strategies
    return allConnections.filter((conn: Auth0Connection) =>
      SSO_STRATEGIES.includes(conn.strategy.toLowerCase())
    );
  }

  private async getClients(): Promise<Auth0Client[]> {
    const response = await this.httpClient.get('/clients', {
      params: {
        per_page: 100,
        include_totals: true,
      },
    });

    const data = response.data;
    return Array.isArray(data) ? data : data.clients || [];
  }

  private async getRoles(): Promise<Auth0Role[]> {
    const response = await this.httpClient.get('/roles', {
      params: {
        per_page: 100,
        include_totals: true,
      },
    });

    const data = response.data;
    return Array.isArray(data) ? data : data.roles || [];
  }

  private async getOrganizations(): Promise<Auth0Organization[]> {
    try {
      const response = await this.httpClient.get('/organizations', {
        params: {
          per_page: 100,
          include_totals: true,
        },
      });

      const data = response.data;
      return Array.isArray(data) ? data : data.organizations || [];
    } catch (error) {
      // Organizations might not be available in all Auth0 plans
      return [];
    }
  }
}