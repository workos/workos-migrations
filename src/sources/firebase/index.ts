import path from 'node:path';
import { exportFirebasePackage } from '../../transformers/firebase/package-exporter.js';
import type { FirebaseScryptConfig, NameSplitStrategy } from '../../shared/types.js';
import type {
  MigrationPackageResult,
  MigrationSource,
  OptionSchema,
  SourceContext,
} from '../types.js';
import { readManifest, toNumber } from '../util.js';

/** Declarative mirror of the `transform-firebase --package` flags. Defaults match the CLI. */
const FIREBASE_OPTIONS: OptionSchema = [
  {
    id: 'input',
    label: 'Firebase Auth JSON export',
    description: 'Path to the Firebase Auth JSON export file',
    type: 'string',
    required: true,
  },
  {
    id: 'nameSplit',
    label: 'Name split strategy',
    description: 'How to split displayName into first/last name',
    type: 'string',
    choices: ['first-space', 'last-space', 'first-name-only'],
    default: 'first-space',
  },
  {
    id: 'includeDisabled',
    label: 'Include disabled users',
    description: 'Include disabled users (excluded by default)',
    type: 'boolean',
    default: false,
  },
  {
    id: 'skipPasswords',
    label: 'Skip passwords',
    description: 'Skip password hash extraction',
    type: 'boolean',
    default: false,
  },
  {
    id: 'signerKey',
    label: 'Scrypt signer key',
    description: 'Firebase scrypt signer key (base64)',
    type: 'string',
  },
  {
    id: 'saltSeparator',
    label: 'Scrypt salt separator',
    description: 'Firebase scrypt salt separator (base64)',
    type: 'string',
  },
  {
    id: 'rounds',
    label: 'Scrypt rounds',
    description: 'Firebase scrypt rounds',
    type: 'number',
    default: 8,
  },
  {
    id: 'memoryCost',
    label: 'Scrypt memory cost',
    description: 'Firebase scrypt memory cost',
    type: 'number',
    default: 14,
  },
  {
    id: 'orgMapping',
    label: 'Org mapping CSV',
    description: 'Org mapping CSV (firebase_uid,org_external_id,org_name)',
    type: 'string',
  },
  {
    id: 'roleMapping',
    label: 'Role mapping CSV',
    description: 'Role mapping CSV (firebase_uid,role_slug)',
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
 * Thin adapter over the existing Firebase transformer. `export()` maps the generic
 * context onto `exportFirebasePackage` — the same path `transform-firebase --package`
 * uses — so the package is byte-identical.
 *
 * NOTE: `saml`/`oidc` are `false` here because this base predates the Firebase
 * Identity Platform SSO handoff (PR #89). When that lands, flip the flags and add
 * the `projectId`/`serviceAccountKey` credentials + SSO options.
 */
export const firebaseSource: MigrationSource = {
  id: 'firebase',
  displayName: 'Firebase Auth',
  capabilities: {
    users: true,
    organizations: true,
    memberships: true,
    roles: true,
    totp: false,
    // Firebase exports scrypt password hashes inline.
    passwords: 'hash-inline',
    saml: false,
    oidc: false,
    ingest: 'file',
  },
  // The file transform needs no API credentials; the input file is an option.
  credentials: [],
  options: FIREBASE_OPTIONS,

  async validateCredentials(): Promise<void> {
    // No credentials to validate for the file-in transform.
  },

  async export(ctx: SourceContext): Promise<MigrationPackageResult> {
    const skipPasswords = Boolean(ctx.options.skipPasswords ?? false);
    const signerKey = ctx.options.signerKey as string | undefined;

    // Mirror the CLI: scrypt config is only built when a signer key is supplied
    // and password extraction is not skipped.
    let scryptConfig: FirebaseScryptConfig | undefined;
    if (signerKey && !skipPasswords) {
      scryptConfig = {
        signerKey,
        saltSeparator: (ctx.options.saltSeparator as string | undefined) ?? '',
        rounds: toNumber(ctx.options.rounds, 8),
        memoryCost: toNumber(ctx.options.memoryCost, 14),
      };
    }

    const start = Date.now();
    await exportFirebasePackage({
      input: String(ctx.options.input),
      outputDir: ctx.outputDir,
      scryptConfig,
      nameSplitStrategy: (ctx.options.nameSplit as NameSplitStrategy | undefined) ?? 'first-space',
      includeDisabled: Boolean(ctx.options.includeDisabled ?? false),
      skipPasswords,
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
