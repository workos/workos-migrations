import path from 'node:path';
import { createMigrationPackage } from '../../package/writer.js';
import type {
  MigrationPackageResult,
  MigrationSource,
  OptionSchema,
  SourceContext,
} from '../types.js';
import { validateSourceContext } from '../util.js';

/** Declarative mirror of the `generate-package-template` flags. */
const CSV_OPTIONS: OptionSchema = [
  {
    id: 'provider',
    label: 'Provider name',
    description: 'Provider name to record in the manifest',
    type: 'string',
    default: 'csv',
  },
  {
    id: 'entities',
    label: 'Entities',
    description: 'Entities to mark as requested in the manifest',
    type: 'string[]',
    default: ['users', 'organizations', 'memberships'],
  },
  {
    id: 'sourceTenant',
    label: 'Source tenant',
    description: 'Optional source tenant identifier to record in the manifest',
    type: 'string',
  },
];

/**
 * Generic CSV source. There is no provider API or export file to transform — the
 * migration package *is* the CSV format. `export()` writes an empty package
 * skeleton (the same `createMigrationPackage` call `generate-package-template`
 * uses) for the operator to populate with the canonical headers.
 */
export const csvSource: MigrationSource = {
  id: 'csv',
  displayName: 'Generic CSV',
  capabilities: {
    users: true,
    organizations: true,
    memberships: true,
    roles: true,
    totp: true,
    // The canonical CSV carries password_hash + password_hash_type columns.
    passwords: 'hash-inline',
    saml: true,
    oidc: true,
    ingest: 'file',
  },
  // No credentials are needed to generate a package skeleton.
  credentials: [],
  options: CSV_OPTIONS,

  async validateCredentials(): Promise<void> {
    // Nothing to validate — the CSV source generates a local skeleton.
  },

  async export(ctx: SourceContext): Promise<MigrationPackageResult> {
    validateSourceContext(csvSource, ctx);
    const start = Date.now();
    const pkg = await createMigrationPackage({
      provider: (ctx.options.provider as string | undefined) ?? 'csv',
      rootDir: ctx.outputDir,
      entitiesRequested: (ctx.options.entities as string[] | undefined) ?? [
        'users',
        'organizations',
        'memberships',
      ],
      sourceTenant: ctx.options.sourceTenant as string | undefined,
      warnings: [],
      handoffNotes: buildTemplateHandoffNotes(),
    });

    return {
      outputDir: path.resolve(ctx.outputDir),
      manifest: pkg.manifest,
      durationMs: Date.now() - start,
    };
  },
};

function buildTemplateHandoffNotes(): string {
  return [
    '# SSO handoff notes',
    '',
    'This skeleton ships empty SSO handoff CSVs. Populate them only when you have',
    'enterprise SAML or OIDC connection material to hand off; otherwise leave them',
    'header-only. WorkOS SSO connections are never imported automatically.',
    '',
  ].join('\n');
}
