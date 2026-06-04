import path from 'node:path';
import { exportClerkPackage } from '../../transformers/clerk/package-exporter.js';
import type {
  MigrationPackageResult,
  MigrationSource,
  OptionSchema,
  SourceContext,
} from '../types.js';
import { readManifest } from '../util.js';

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
];

/**
 * Thin adapter over the existing Clerk transformer. `export()` maps the generic
 * context onto `exportClerkPackage` — the same path `transform-clerk --package`
 * uses — so the package is byte-identical.
 *
 * NOTE: `saml`/`oidc` are `false` here because this base predates the Clerk SSO
 * handoff (PR #88). When that lands, flip the flags and add the `secretKey`
 * credential + SSO options.
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
    saml: false,
    oidc: false,
    ingest: 'file',
  },
  // The file transform needs no API credentials; the input file is an option.
  credentials: [],
  options: CLERK_OPTIONS,

  async validateCredentials(): Promise<void> {
    // No credentials to validate for the file-in transform.
  },

  async export(ctx: SourceContext): Promise<MigrationPackageResult> {
    const start = Date.now();
    await exportClerkPackage({
      input: String(ctx.options.input),
      outputDir: ctx.outputDir,
      orgMapping: ctx.options.orgMapping as string | undefined,
      roleMapping: ctx.options.roleMapping as string | undefined,
      sourceTenant: ctx.options.sourceTenant as string | undefined,
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
