import path from 'node:path';
import { Auth0Client } from '../../exporters/auth0/client.js';
import {
  exportAuth0Package,
  exportAuth0PackageWithClient,
  type Auth0ExportClient,
} from '../../exporters/auth0/package-exporter.js';
import { auth0Provider } from '../../providers/auth0/index.js';
import type { Auth0ExportEngine, Auth0ExportOptions } from '../../shared/types.js';
import type {
  MigrationPackageResult,
  MigrationSource,
  OptionSchema,
  SourceContext,
} from '../types.js';
import { readManifest, toNumber, validateSourceContext } from '../util.js';

/**
 * Declarative mirror of the `export-auth0` CLI flags (package mode). The legacy
 * command parses these by hand; the registry-driven CLI (WS-1) will generate
 * arg parsing from this schema. Defaults match `export-auth0.ts`.
 */
const AUTH0_OPTIONS: OptionSchema = [
  {
    id: 'entities',
    label: 'Entities',
    description: 'Comma-separated package entities (users,organizations,memberships,roles,sso)',
    type: 'string[]',
    default: ['users', 'organizations', 'memberships'],
  },
  {
    id: 'includeSecrets',
    label: 'Include secrets',
    description: 'Include Auth0 SSO connection secrets in package handoff files',
    type: 'boolean',
    default: false,
  },
  {
    id: 'orgs',
    label: 'Organization IDs',
    description: 'Filter to specific Auth0 organization IDs',
    type: 'string[]',
  },
  {
    id: 'pageSize',
    label: 'Page size',
    description: 'API pagination size (max 100)',
    type: 'number',
    default: 100,
  },
  {
    id: 'rateLimit',
    label: 'Rate limit',
    description: 'API requests per second',
    type: 'number',
    default: 50,
  },
  {
    id: 'userFetchConcurrency',
    label: 'User fetch concurrency',
    description: 'Parallel user fetch count',
    type: 'number',
    default: 10,
  },
  {
    id: 'useMetadata',
    label: 'Use metadata',
    description:
      'Use metadata for org discovery instead of the Organizations API (admin-controlled app_metadata only by default)',
    type: 'boolean',
    default: false,
  },
  {
    id: 'allowUserMetadataOrg',
    label: 'Allow user_metadata org discovery (insecure)',
    description:
      'Also trust end-user-writable user_metadata for org discovery. Lets source-tenant end users self-assign organization membership; only enable if you fully trust user_metadata',
    type: 'boolean',
    default: false,
  },
  {
    id: 'metadataOrgIdField',
    label: 'Metadata org ID field',
    description: 'Custom metadata field for org ID',
    type: 'string',
  },
  {
    id: 'metadataOrgNameField',
    label: 'Metadata org name field',
    description: 'Custom metadata field for org name',
    type: 'string',
  },
  {
    id: 'includeFederatedUsers',
    label: 'Include federated users',
    description: 'Include federated/JIT users in package mode (skipped by default)',
    type: 'boolean',
    default: false,
  },
  {
    id: 'engine',
    label: 'Export engine',
    description: 'Auth0 user export engine',
    type: 'string',
    choices: ['management-api', 'bulk-job'],
    default: 'management-api',
  },
  {
    id: 'bulkConnectionId',
    label: 'Bulk connection ID',
    description: 'Auth0 connection ID to scope a bulk-job export to a single connection',
    type: 'string',
  },
  {
    id: 'bulkPollIntervalMs',
    label: 'Bulk poll interval (ms)',
    description: 'Polling interval for bulk-job status checks',
    type: 'number',
  },
  {
    id: 'bulkMaxPollAttempts',
    label: 'Bulk max poll attempts',
    description: 'Maximum bulk-job poll attempts before timing out',
    type: 'number',
  },
  {
    id: 'jobId',
    label: 'Checkpoint job ID',
    description: 'Enable export checkpointing for large tenants',
    type: 'string',
  },
  {
    id: 'resume',
    label: 'Resume',
    description: 'Resume a previously checkpointed export',
    type: 'boolean',
  },
];

/**
 * Thin adapter that wraps the existing Auth0 package exporter to satisfy the
 * `MigrationSource` contract. No export logic lives here — `export()` maps the
 * generic `SourceContext` onto `Auth0ExportOptions` and delegates to the same
 * functions `export-auth0 --package` already calls, so the produced package is
 * byte-identical to the legacy command.
 */
export const auth0Source: MigrationSource = {
  id: 'auth0',
  displayName: auth0Provider.displayName,
  capabilities: {
    users: true,
    organizations: true,
    memberships: true,
    roles: true,
    totp: false,
    // Auth0's Management API export omits password hashes; they require a
    // separate support export merged in via `merge-passwords`.
    passwords: 'support-export',
    saml: true,
    oidc: true,
    ingest: 'api',
  },
  credentials: auth0Provider.credentials,
  options: AUTH0_OPTIONS,

  async validateCredentials(ctx: SourceContext): Promise<void> {
    const client = resolveClient(ctx);
    const result = await client.testConnection?.();
    if (result && !result.success) {
      throw new Error(`Auth0 connection failed: ${result.error}`);
    }
  },

  async export(ctx: SourceContext): Promise<MigrationPackageResult> {
    validateSourceContext(auth0Source, ctx);
    const options = toExportOptions(ctx);
    const summary = ctx.client
      ? await exportAuth0PackageWithClient(ctx.client as Auth0ExportClient, options)
      : await exportAuth0Package(options);

    const resolvedDir = path.resolve(ctx.outputDir);
    return {
      outputDir: resolvedDir,
      manifest: await readManifest(resolvedDir),
      durationMs: summary.duration,
    };
  },
};

function resolveClient(ctx: SourceContext): Auth0ExportClient {
  if (ctx.client) {
    return ctx.client as Auth0ExportClient;
  }
  return new Auth0Client({
    domain: ctx.credentials.domain,
    clientId: ctx.credentials.clientId,
    clientSecret: ctx.credentials.clientSecret,
    rateLimit: toNumber(ctx.options.rateLimit, 50),
  });
}

function toExportOptions(ctx: SourceContext): Auth0ExportOptions {
  const o = ctx.options;
  return {
    domain: ctx.credentials.domain,
    clientId: ctx.credentials.clientId,
    clientSecret: ctx.credentials.clientSecret,
    package: true,
    outputDir: ctx.outputDir,
    entities: o.entities as string[] | undefined,
    includeSecrets: Boolean(o.includeSecrets ?? false),
    orgs: o.orgs as string[] | undefined,
    pageSize: toNumber(o.pageSize, 100),
    rateLimit: toNumber(o.rateLimit, 50),
    userFetchConcurrency: toNumber(o.userFetchConcurrency, 10),
    useMetadata: Boolean(o.useMetadata ?? false),
    // Fail closed: this opt-in trusts end-user-writable data, so only an explicit
    // boolean true (or the string "true") may enable it — never `Boolean("false")`.
    allowUserMetadataOrg: o.allowUserMetadataOrg === true || o.allowUserMetadataOrg === 'true',
    metadataOrgIdField: o.metadataOrgIdField as string | undefined,
    metadataOrgNameField: o.metadataOrgNameField as string | undefined,
    includeFederatedUsers: Boolean(o.includeFederatedUsers ?? false),
    engine: (o.engine as Auth0ExportEngine | undefined) ?? 'management-api',
    bulkConnectionId: o.bulkConnectionId as string | undefined,
    bulkPollIntervalMs:
      o.bulkPollIntervalMs == null ? undefined : toNumber(o.bulkPollIntervalMs, 0),
    bulkMaxPollAttempts:
      o.bulkMaxPollAttempts == null ? undefined : toNumber(o.bulkMaxPollAttempts, 0),
    jobId: o.jobId as string | undefined,
    resume: Boolean(o.resume ?? false),
    quiet: ctx.quiet ?? false,
  };
}
