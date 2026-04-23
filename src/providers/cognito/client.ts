import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import {
  CognitoIdentityProviderClient,
  ListIdentityProvidersCommand,
  DescribeIdentityProviderCommand,
  ListUserPoolsCommand,
  ListUsersCommand,
  ProviderDescription,
  UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { ProviderClient, EntityType, ExportResult, ProviderCredentials } from '../../types';
import {
  CognitoProvider,
  CognitoUser,
  isSaml,
  isOidc,
  toSamlRow,
  toOidcRow,
  toUserRow,
  toCustomAttrRows,
  rowsToCsv,
  ProxyTemplates,
  SAML_HEADERS,
  OIDC_HEADERS,
  CUSTOM_ATTR_HEADERS,
  USER_HEADERS,
  DEFAULT_SAML_CUSTOM_ENTITY_ID_TEMPLATE,
} from './workos-csv';

function countDuplicates(values: string[]): number {
  const seen = new Set<string>();
  let dupes = 0;
  for (const v of values) {
    if (seen.has(v)) dupes += 1;
    else seen.add(v);
  }
  return dupes;
}

export interface CognitoClientOptions {
  /** Comma-separated pool IDs or a single ID. Overrides the USER_POOL_IDS credential. */
  userPoolIds?: string[];
  /** Directory to write CSV output. Defaults to cwd. */
  outDir?: string;
  /** Proxy URL templates with {provider_name}, {user_pool_id}, {region} placeholders. */
  proxy?: ProxyTemplates;
}

export class CognitoClient implements ProviderClient {
  private client?: CognitoIdentityProviderClient;
  private readonly credentials: ProviderCredentials;
  private readonly options: CognitoClientOptions;

  constructor(credentials: ProviderCredentials, options: CognitoClientOptions = {}) {
    this.credentials = credentials;
    this.options = options;
  }

  async authenticate(): Promise<void> {
    const region = this.credentials.region;
    if (!region) {
      throw new Error('AWS region is required');
    }

    this.client = new CognitoIdentityProviderClient({
      region,
      credentials:
        this.credentials.accessKeyId && this.credentials.secretAccessKey
          ? {
              accessKeyId: this.credentials.accessKeyId,
              secretAccessKey: this.credentials.secretAccessKey,
              sessionToken: this.credentials.sessionToken,
            }
          : undefined, // fall back to default AWS credential chain (env, profile, IMDS, etc.)
    });

    await this.validateCredentials();
  }

  async validateCredentials(): Promise<void> {
    if (!this.client) {
      throw new Error('call authenticate() before validateCredentials()');
    }
    // Cheap validation that creds work + caller has some cognito permissions.
    await this.client.send(new ListUserPoolsCommand({ MaxResults: 1 }));
  }

  getScopes(): string[] {
    return ['cognito-idp:ListIdentityProviders', 'cognito-idp:DescribeIdentityProvider'];
  }

  async getAvailableEntities(): Promise<EntityType[]> {
    return [
      {
        key: 'connections',
        name: 'Connections',
        description: 'Identity providers attached to Cognito user pools (SAML + OIDC)',
        enabled: true,
      },
      {
        key: 'users',
        name: 'Users',
        description: 'Cognito user pool users (password hashes not exportable)',
        enabled: true,
      },
    ];
  }

  async exportEntities(entityTypes: string[]): Promise<ExportResult> {
    if (!this.client) throw new Error('call authenticate() before exportEntities()');

    const entities: Record<string, any[]> = {};
    const summary: Record<string, number> = {};
    const outputFiles: string[] = [];

    for (const entityType of entityTypes) {
      try {
        switch (entityType) {
          case 'connections': {
            const { providers, writtenFiles } = await this.exportConnections();
            entities.connections = providers;
            summary.connections = providers.length;
            outputFiles.push(...writtenFiles);
            break;
          }
          case 'users': {
            const { users, writtenFiles } = await this.exportUsers();
            entities.users = users;
            summary.users = users.length;
            outputFiles.push(...writtenFiles);
            break;
          }
          default:
            console.warn(chalk.yellow(`  skipping unknown entity: ${entityType}`));
        }
      } catch (error) {
        console.warn(
          chalk.yellow(
            `  failed to export ${entityType}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          ),
        );
        entities[entityType] = [];
        summary[entityType] = 0;
      }
    }

    if (outputFiles.length > 0) entities.output_files = outputFiles;

    return {
      timestamp: new Date().toISOString(),
      provider: 'cognito',
      entities,
      summary,
    };
  }

  private async exportConnections(): Promise<{
    providers: CognitoProvider[];
    writtenFiles: string[];
  }> {
    const poolIds = this.resolvePoolIds();
    if (poolIds.length === 0) {
      throw new Error(
        'no user pool IDs provided — set COGNITO_USER_POOL_IDS, pass --user-pool-ids, or save to config',
      );
    }

    const all: CognitoProvider[] = [];
    for (const poolId of poolIds) {
      console.log(chalk.gray(`  fetching IdPs from ${poolId}...`));
      const providers = await this.fetchProviders(poolId);
      console.log(chalk.gray(`  ${poolId}: ${providers.length} IdP(s)`));
      all.push(...providers);
    }

    const region = this.credentials.region;
    const proxy: ProxyTemplates = {
      samlCustomEntityId:
        this.options.proxy?.samlCustomEntityId ??
        process.env.SAML_CUSTOM_ENTITY_ID_TEMPLATE ??
        DEFAULT_SAML_CUSTOM_ENTITY_ID_TEMPLATE,
      samlCustomAcsUrl:
        this.options.proxy?.samlCustomAcsUrl ?? process.env.SAML_CUSTOM_ACS_URL_TEMPLATE ?? null,
      oidcCustomRedirectUri:
        this.options.proxy?.oidcCustomRedirectUri ??
        process.env.OIDC_CUSTOM_REDIRECT_URI_TEMPLATE ??
        null,
    };

    const samlRows = all.filter(isSaml).map((p) => toSamlRow(p, proxy));
    const oidcRows = all.filter(isOidc).map((p) => toOidcRow(p, proxy));
    const customAttrRows = all.flatMap(toCustomAttrRows);

    const outDir = this.options.outDir ?? process.cwd();
    fs.mkdirSync(outDir, { recursive: true });

    const samlPath = path.join(outDir, 'workos_saml_connections.csv');
    const oidcPath = path.join(outDir, 'workos_oidc_connections.csv');
    const customPath = path.join(outDir, 'custom_attribute_mappings.csv');

    fs.writeFileSync(samlPath, rowsToCsv(SAML_HEADERS, samlRows));
    fs.writeFileSync(oidcPath, rowsToCsv(OIDC_HEADERS, oidcRows));
    fs.writeFileSync(customPath, rowsToCsv(CUSTOM_ATTR_HEADERS, customAttrRows));

    console.log(chalk.blue('\n  output files:'));
    console.log(chalk.gray(`    ${samlPath}`));
    console.log(chalk.gray(`    ${oidcPath}`));
    console.log(chalk.gray(`    ${customPath}`));

    this.logWarnings(all, samlRows.length + oidcRows.length);

    // Void the unused region to keep TS happy without changing semantics
    void region;

    return {
      providers: all,
      writtenFiles: [samlPath, oidcPath, customPath],
    };
  }

  private async exportUsers(): Promise<{ users: CognitoUser[]; writtenFiles: string[] }> {
    const poolIds = this.resolvePoolIds();
    if (poolIds.length === 0) {
      throw new Error(
        'no user pool IDs provided — set COGNITO_USER_POOL_IDS, pass --user-pool-ids, or save to config',
      );
    }

    const all: CognitoUser[] = [];
    for (const poolId of poolIds) {
      console.log(chalk.gray(`  fetching users from ${poolId}...`));
      const users = await this.fetchUsers(poolId);
      console.log(chalk.gray(`  ${poolId}: ${users.length} user(s)`));
      all.push(...users);
    }

    const rows = all.map(toUserRow);
    const outDir = this.options.outDir ?? process.cwd();
    fs.mkdirSync(outDir, { recursive: true });
    const usersPath = path.join(outDir, 'workos_users.csv');
    fs.writeFileSync(usersPath, rowsToCsv(USER_HEADERS, rows));

    console.log(chalk.blue('\n  output files:'));
    console.log(chalk.gray(`    ${usersPath}`));
    this.logUserWarnings(rows);

    return { users: all, writtenFiles: [usersPath] };
  }

  private async fetchUsers(poolId: string): Promise<CognitoUser[]> {
    const client = this.client!;
    const users: CognitoUser[] = [];

    let paginationToken: string | undefined;
    do {
      const resp = await client.send(
        new ListUsersCommand({
          UserPoolId: poolId,
          Limit: 60,
          PaginationToken: paginationToken,
        }),
      );
      for (const u of resp.Users ?? []) {
        const mapped = this.mapUser(poolId, u);
        if (mapped) users.push(mapped);
      }
      paginationToken = resp.PaginationToken;
      if (users.length > 0 && users.length % 300 === 0) {
        console.log(chalk.gray(`    ...${users.length} users so far`));
      }
    } while (paginationToken);

    return users;
  }

  private mapUser(poolId: string, u: UserType): CognitoUser | null {
    if (!u.Username) return null;
    const attributes: Record<string, string> = {};
    for (const attr of u.Attributes ?? []) {
      if (attr.Name && attr.Value !== undefined) attributes[attr.Name] = attr.Value;
    }
    return {
      userPoolId: poolId,
      username: u.Username,
      attributes,
      userStatus: u.UserStatus,
      enabled: u.Enabled,
    };
  }

  private logUserWarnings(rows: Array<Record<string, string>>): void {
    const missingEmail = rows.filter((r) => !r.email).length;
    if (missingEmail > 0) {
      console.log(
        chalk.yellow(
          `  [warn] ${missingEmail} user(s) have no email attribute — these rows will likely fail WorkOS import.`,
        ),
      );
    }
    if (rows.length > 0) {
      console.log(
        chalk.yellow(
          `  [warn] password_hash is blank for all ${rows.length} user(s) — Cognito does not expose hashes. ` +
            `Affected users will need to reset their password post-migration (or rely on SSO JIT provisioning).`,
        ),
      );
      const dupes = countDuplicates(rows.map((r) => r.user_id).filter(Boolean));
      if (dupes > 0) {
        console.log(
          chalk.yellow(
            `  [warn] ${dupes} duplicate user_id value(s) detected across pools — consider exporting pools separately or prefixing IDs.`,
          ),
        );
      }
    }
  }

  private async fetchProviders(poolId: string): Promise<CognitoProvider[]> {
    const client = this.client!;
    const providers: CognitoProvider[] = [];

    let nextToken: string | undefined;
    do {
      const resp = await client.send(
        new ListIdentityProvidersCommand({
          UserPoolId: poolId,
          MaxResults: 60,
          NextToken: nextToken,
        }),
      );
      for (const summary of resp.Providers ?? []) {
        const provider = await this.describeProvider(poolId, summary);
        if (provider) providers.push(provider);
      }
      nextToken = resp.NextToken;
    } while (nextToken);

    return providers;
  }

  private async describeProvider(
    poolId: string,
    summary: ProviderDescription,
  ): Promise<CognitoProvider | null> {
    if (!summary.ProviderName || !summary.ProviderType) return null;
    const resp = await this.client!.send(
      new DescribeIdentityProviderCommand({
        UserPoolId: poolId,
        ProviderName: summary.ProviderName,
      }),
    );
    const idp = resp.IdentityProvider;
    if (!idp?.ProviderName || !idp.ProviderType) return null;

    return {
      userPoolId: poolId,
      providerName: idp.ProviderName,
      providerType: idp.ProviderType,
      region: this.credentials.region,
      providerDetails: (idp.ProviderDetails ?? {}) as Record<string, string>,
      attributeMapping: (idp.AttributeMapping ?? {}) as Record<string, string>,
      idpIdentifiers: idp.IdpIdentifiers ?? [],
    };
  }

  private resolvePoolIds(): string[] {
    const candidates =
      this.options.userPoolIds ??
      (this.credentials.userPoolIds
        ? this.credentials.userPoolIds.split(',')
        : this.credentials.userPoolId
          ? [this.credentials.userPoolId]
          : []);
    return candidates.map((s) => s.trim()).filter(Boolean);
  }

  private logWarnings(all: CognitoProvider[], totalRows: number): void {
    const nameOnly = all.filter(
      (p) =>
        isSaml(p) &&
        p.attributeMapping.name &&
        !(p.attributeMapping.given_name && p.attributeMapping.family_name),
    );
    if (nameOnly.length > 0) {
      console.log(
        chalk.yellow(
          `  [warn] ${nameOnly.length} SAML connection(s) rely on a full-name attribute only ` +
            `(no given_name/family_name). WorkOS will use the 'name' column at import.`,
        ),
      );
    }
    if (totalRows > 0) {
      console.log(
        chalk.yellow(
          `  [warn] ${totalRows} row(s) have empty 'domains' column. ` +
            `Optional per WorkOS, recommended for domain-capture — populate before uploading.`,
        ),
      );
    }
  }
}
