import path from 'node:path';
import { CognitoClient, type CognitoClientOptions } from '../../providers/cognito/index.js';
import {
  type CognitoOrgStrategy,
  type ExportCognitoPackageResult,
} from '../../providers/cognito/package-exporter.js';
import { cognitoProvider } from '../../providers/cognito/index.js';
import type { ProviderCredentials } from '../../shared/types.js';
import type {
  MigrationPackageResult,
  MigrationSource,
  OptionSchema,
  SourceContext,
} from '../types.js';
import { readManifest } from '../util.js';

/**
 * Minimal slice of `CognitoClient` the adapter drives. The real client satisfies
 * it; tests inject a fake (pre-authenticated) that delegates to the package
 * exporter so byte-identical output can be verified without AWS calls.
 */
export interface CognitoExportClient {
  authenticate(): Promise<void>;
  exportPackage(options: {
    entities?: string[];
    outputDir?: string;
    orgStrategy?: CognitoOrgStrategy;
    skipExternalProviderUsers?: boolean;
    quiet?: boolean;
  }): Promise<ExportCognitoPackageResult>;
}

/** Declarative mirror of the `export-cognito --package` flags. Defaults match the CLI. */
const COGNITO_OPTIONS: OptionSchema = [
  {
    id: 'entities',
    label: 'Entities',
    description: 'Comma-separated package entities (users,organizations,memberships,sso)',
    type: 'string[]',
    default: ['users', 'organizations', 'memberships'],
  },
  {
    id: 'orgStrategy',
    label: 'Org strategy',
    description: 'How to map Cognito users to WorkOS organizations',
    type: 'string',
    choices: ['user-pool', 'connection', 'none'],
    default: 'user-pool',
  },
  {
    id: 'skipExternalProviderUsers',
    label: 'Skip federated users',
    description: 'Skip EXTERNAL_PROVIDER users (WorkOS JIT-provisions them on first SSO login)',
    type: 'boolean',
  },
  {
    id: 'samlCustomAcsUrlTemplate',
    label: 'SAML custom ACS URL template',
    description: 'Placeholders: {provider_name}, {user_pool_id}, {region}',
    type: 'string',
  },
  {
    id: 'samlCustomEntityIdTemplate',
    label: 'SAML custom Entity ID template',
    description: 'Default: urn:amazon:cognito:sp:{user_pool_id}',
    type: 'string',
  },
  {
    id: 'oidcCustomRedirectUriTemplate',
    label: 'OIDC custom redirect URI template',
    description: 'Template for the OIDC custom redirect URI',
    type: 'string',
  },
];

/**
 * Thin adapter over the existing Cognito package exporter. No export logic lives
 * here: `export()` builds a `CognitoClient` from credentials (or uses an injected
 * one), authenticates, and delegates to `client.exportPackage()` — the same path
 * `export-cognito --package` uses — so the package is byte-identical.
 */
export const cognitoSource: MigrationSource = {
  id: 'cognito',
  displayName: cognitoProvider.displayName,
  capabilities: {
    users: true,
    organizations: true,
    memberships: true,
    roles: false,
    totp: false,
    // Cognito does not expose password hashes via its API.
    passwords: 'none',
    saml: true,
    oidc: true,
    ingest: 'api',
  },
  credentials: cognitoProvider.credentials,
  options: COGNITO_OPTIONS,

  async validateCredentials(ctx: SourceContext): Promise<void> {
    if (ctx.client) {
      await (ctx.client as CognitoExportClient).authenticate();
      return;
    }
    const client = buildClient(ctx);
    // authenticate() runs validateCredentials() internally (a ListUserPools probe).
    await client.authenticate();
  },

  async export(ctx: SourceContext): Promise<MigrationPackageResult> {
    const client: CognitoExportClient = ctx.client
      ? (ctx.client as CognitoExportClient)
      : buildClient(ctx);

    await client.authenticate();

    const start = Date.now();
    await client.exportPackage({
      entities: ctx.options.entities as string[] | undefined,
      outputDir: ctx.outputDir,
      orgStrategy: ctx.options.orgStrategy as CognitoOrgStrategy | undefined,
      skipExternalProviderUsers: ctx.options.skipExternalProviderUsers as boolean | undefined,
      quiet: ctx.quiet ?? false,
    });

    const resolvedDir = path.resolve(ctx.outputDir);
    return {
      outputDir: resolvedDir,
      manifest: await readManifest(resolvedDir),
      durationMs: Date.now() - start,
    };
  },
};

function buildClient(ctx: SourceContext): CognitoClient {
  const credentials: ProviderCredentials = {
    region: ctx.credentials.region ?? '',
    userPoolIds: ctx.credentials.userPoolIds ?? '',
    accessKeyId: ctx.credentials.accessKeyId ?? '',
    secretAccessKey: ctx.credentials.secretAccessKey ?? '',
    sessionToken: ctx.credentials.sessionToken ?? '',
  };

  const clientOptions: CognitoClientOptions = {
    userPoolIds: (ctx.credentials.userPoolIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    outDir: ctx.outputDir,
    proxy: {
      samlCustomAcsUrl: (ctx.options.samlCustomAcsUrlTemplate as string | undefined) ?? null,
      samlCustomEntityId: (ctx.options.samlCustomEntityIdTemplate as string | undefined) ?? null,
      oidcCustomRedirectUri:
        (ctx.options.oidcCustomRedirectUriTemplate as string | undefined) ?? null,
    },
    skipExternalProviderUsers: ctx.options.skipExternalProviderUsers as boolean | undefined,
  };

  return new CognitoClient(credentials, clientOptions);
}
