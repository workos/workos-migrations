import path from 'node:path';
import { exportClerkPackage } from '../../transformers/clerk/package-exporter.js';
import type {
  MigrationPackageResult,
  MigrationSource,
  OptionSchema,
  SourceContext,
} from '../types.js';
import { readManifest } from '../util.js';

/**
 * Test/DI seam for `SourceContext.client`: a `fetch` implementation injected into
 * the Clerk Backend API client so SSO export can be exercised without network.
 */
export interface ClerkAdapterClient {
  fetchImpl?: typeof fetch;
}

/** Declarative mirror of the `transform-clerk --package` flags. */
const CLERK_OPTIONS: OptionSchema = [
  {
    id: 'input',
    label: 'Clerk export CSV',
    description: 'Path to the Clerk dashboard CSV export',
    type: 'string',
    required: true,
  },
  {
    id: 'orgMapping',
    label: 'Org mapping CSV',
    description: 'Org mapping CSV (clerk_user_id,org_external_id,org_name)',
    type: 'string',
  },
  {
    id: 'roleMapping',
    label: 'Role mapping CSV',
    description: 'Role mapping CSV (clerk_user_id,role_slug)',
    type: 'string',
  },
  {
    id: 'sourceTenant',
    label: 'Source tenant',
    description: 'Optional source tenant identifier to record in the manifest',
    type: 'string',
  },
  {
    id: 'clerkApiBaseUrl',
    label: 'Clerk API base URL',
    description: 'Override the Clerk Backend API base URL (default https://api.clerk.com/v1)',
    type: 'string',
  },
];

/**
 * Thin adapter over the existing Clerk transformer. `export()` maps the generic
 * context onto `exportClerkPackage` — the same path `transform-clerk --package`
 * uses — so the package is byte-identical.
 *
 * SSO is opt-in: when a `secretKey` credential is supplied, the exporter pulls
 * enterprise SAML/OIDC connections via the Clerk Backend API and writes the
 * handoff CSVs. Without it, only the file transform runs.
 */
export const clerkSource: MigrationSource = {
  id: 'clerk',
  displayName: 'Clerk',
  capabilities: {
    users: true,
    organizations: true,
    memberships: true,
    roles: true,
    totp: false,
    // Clerk's CSV export carries password_digest + password_hasher inline.
    passwords: 'hash-inline',
    saml: true,
    oidc: true,
    ingest: 'file',
  },
  credentials: [
    {
      key: 'secretKey',
      name: 'Clerk Secret Key (enterprise SSO export only)',
      type: 'password',
      required: false,
      envVar: 'CLERK_SECRET_KEY',
    },
  ],
  options: CLERK_OPTIONS,

  async validateCredentials(): Promise<void> {
    // The file transform needs no credentials; the optional secretKey is
    // validated by the Backend API call during export.
  },

  async export(ctx: SourceContext): Promise<MigrationPackageResult> {
    const seam = ctx.client as ClerkAdapterClient | undefined;
    const start = Date.now();
    await exportClerkPackage({
      input: String(ctx.options.input),
      outputDir: ctx.outputDir,
      orgMapping: ctx.options.orgMapping as string | undefined,
      roleMapping: ctx.options.roleMapping as string | undefined,
      sourceTenant: ctx.options.sourceTenant as string | undefined,
      clerkSecretKey: ctx.credentials.secretKey || undefined,
      clerkApiBaseUrl: ctx.options.clerkApiBaseUrl as string | undefined,
      clerkFetchImpl: seam?.fetchImpl,
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
