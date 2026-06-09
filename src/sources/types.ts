import type { CredentialField } from '../shared/types.js';
import type { MigrationPackageManifest } from '../package/manifest.js';

/**
 * Credential metadata is unchanged from the legacy `Provider` shape — re-exported
 * here so sources can declare credentials without importing from `shared/types`.
 */
export type { CredentialField };

/**
 * What a source can produce and how it ingests data. Declarative so it can drive
 * the capability matrix, `--help`, and (later) the wizard from a single place.
 */
export interface SourceCapabilities {
  users: boolean;
  organizations: boolean;
  memberships: boolean;
  roles: boolean;
  totp: boolean;
  /**
   * `hash-inline`   — password hashes are included in the export itself.
   * `support-export`— hashes require a separate provider/support export to merge in.
   * `none`          — passwords are not migratable from this source.
   */
  passwords: 'hash-inline' | 'support-export' | 'none';
  saml: boolean;
  oidc: boolean;
  /**
   * `api`  — pull from the provider's API.
   * `file` — transform a supplied export file.
   * `both` — either is supported.
   * Replaces the old `export-*` (API) vs `transform-*` (file) command split.
   */
  ingest: 'api' | 'file' | 'both';
}

/** A single declarative option a source accepts. Drives arg parsing and the wizard. */
export interface SourceOption {
  /** Stable key used in `SourceContext.options` and as the long-flag name. */
  id: string;
  /** Human-readable label for prompts/help. */
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  required?: boolean;
  default?: string | number | boolean | readonly string[];
  /** Restrict the value to a fixed set (e.g. an engine selector). */
  choices?: readonly string[];
}

export type OptionSchema = readonly SourceOption[];

/** Everything a source needs to run one export. Generic across sources. */
export interface SourceContext {
  /** Resolved credential values keyed by `CredentialField.key`. */
  credentials: Record<string, string>;
  /** Resolved option values keyed by `SourceOption.id`. */
  options: Record<string, unknown>;
  /** Directory the source writes its migration package into. */
  outputDir: string;
  /** Suppress progress logging. */
  quiet?: boolean;
  /**
   * Optional pre-constructed provider client — a dependency-injection / test seam.
   * Sources that build their own client from `credentials` may ignore it. Adapter
   * tests use it to prove byte-identical output without making network calls.
   */
  client?: unknown;
}

/** Result of a successful export: where the package landed and what it contains. */
export interface MigrationPackageResult {
  /** Absolute path to the written migration package. */
  outputDir: string;
  /** The package manifest as written to disk. */
  manifest: MigrationPackageManifest;
  /** Wall-clock duration of the export in milliseconds. */
  durationMs: number;
}

/**
 * The single interface every migration source implements. Producers write a
 * provider-neutral migration package on disk; `import-package` consumes it.
 */
export interface MigrationSource {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: SourceCapabilities;
  readonly credentials: readonly CredentialField[];
  readonly options: OptionSchema;

  /** Throw if credentials are missing or invalid (e.g. a failed connection test). */
  validateCredentials(ctx: SourceContext): Promise<void>;
  /** Pull from an API or transform a supplied file; always writes a package on disk. */
  export(ctx: SourceContext): Promise<MigrationPackageResult>;
}
