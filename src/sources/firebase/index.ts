import path from 'node:path';
import { exportFirebasePackage } from '../../transformers/firebase/package-exporter.js';
import {
  createGoogleAccessTokenProvider,
  detectGoogleProjectId,
} from '../../transformers/firebase/google-auth.js';
import type { IdentityPlatformAccessTokenProvider } from '../../transformers/firebase/identity-platform-client.js';
import type { FirebaseScryptConfig, NameSplitStrategy } from '../../shared/types.js';
import type {
  MigrationPackageResult,
  MigrationSource,
  OptionSchema,
  SourceContext,
} from '../types.js';
import { readManifest, toNumber } from '../util.js';

/**
 * Test/DI seam for `SourceContext.client`: a pre-built access-token provider and
 * `fetch` implementation for the Identity Platform admin API, so SSO export can
 * be exercised without real Google credentials.
 */
export interface FirebaseAdapterClient {
  accessTokenProvider?: IdentityPlatformAccessTokenProvider;
  fetchImpl?: typeof fetch;
}

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
  {
    id: 'skipTenantSso',
    label: 'Skip tenant SSO scopes',
    description: 'Limit SSO export to the project scope (skip per-tenant configs)',
    type: 'boolean',
    default: false,
  },
];

/**
 * Thin adapter over the existing Firebase transformer. `export()` maps the generic
 * context onto `exportFirebasePackage` — the same path `transform-firebase --package`
 * uses — so the package is byte-identical.
 *
 * SSO is opt-in: when a `serviceAccountKey` credential (path to a service-account
 * key file) is supplied, the exporter calls the Identity Platform admin API and
 * writes the SAML/OIDC handoff CSVs. `projectId` is auto-detected from the key
 * file when not given.
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
    saml: true,
    oidc: true,
    ingest: 'file',
  },
  credentials: [
    {
      key: 'serviceAccountKey',
      name: 'Service account key file (Identity Platform SSO export only)',
      type: 'input',
      required: false,
      envVar: 'GOOGLE_APPLICATION_CREDENTIALS',
    },
    {
      key: 'projectId',
      name: 'GCP project ID (SSO export only; auto-detected from the key file)',
      type: 'input',
      required: false,
      envVar: 'GOOGLE_CLOUD_PROJECT',
    },
  ],
  options: FIREBASE_OPTIONS,

  async validateCredentials(): Promise<void> {
    // The file transform needs no credentials; SSO credentials are validated by
    // the Identity Platform call during export.
  },

  async export(ctx: SourceContext): Promise<MigrationPackageResult> {
    const seam = ctx.client as FirebaseAdapterClient | undefined;

    let accessTokenProvider = seam?.accessTokenProvider;
    let gcpProjectId = ctx.credentials.projectId || undefined;
    const serviceAccountKey = ctx.credentials.serviceAccountKey || undefined;
    // Mirror the CLI: when a service-account key file is supplied, build the
    // access-token provider and auto-detect the project ID if not provided.
    if (!accessTokenProvider && serviceAccountKey) {
      accessTokenProvider = createGoogleAccessTokenProvider({ keyFile: serviceAccountKey });
      gcpProjectId = gcpProjectId ?? (await detectGoogleProjectId({ keyFile: serviceAccountKey }));
    }

    const skipPasswords = Boolean(ctx.options.skipPasswords ?? false);
    const signerKey = ctx.options.signerKey as string | undefined;
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
      gcpProjectId,
      accessTokenProvider,
      identityPlatformFetchImpl: seam?.fetchImpl,
      skipTenantSsoScopes: Boolean(ctx.options.skipTenantSso ?? false),
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
