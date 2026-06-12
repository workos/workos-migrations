import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { MigrationPackageManifest } from '../package/manifest.js';
import type { MigrationSource, SourceContext } from './types.js';

/** Read a written package manifest back from disk. */
export async function readManifest(outputDir: string): Promise<MigrationPackageManifest> {
  const raw = await fs.readFile(path.join(path.resolve(outputDir), 'manifest.json'), 'utf-8');
  return JSON.parse(raw) as MigrationPackageManifest;
}

/** Coerce an option value to a number, falling back when absent, empty, or not numeric. */
export function toNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Validate a SourceContext against a source's declared credentials and options.
 * Called at the top of every adapter's export() so the CLI and programmatic
 * callers (e.g. the wizard) get the same early, clear errors: missing required
 * credentials/options, out-of-range choice values, and missing input files.
 */
export function validateSourceContext(
  source: Pick<MigrationSource, 'credentials' | 'options'>,
  ctx: SourceContext,
): void {
  for (const cred of source.credentials) {
    if (cred.required && !ctx.credentials[cred.key]) {
      throw new Error(
        `Missing required credential "${cred.name}" (${cred.key}${
          cred.envVar ? `, env ${cred.envVar}` : ''
        })`,
      );
    }
  }

  for (const opt of source.options) {
    const value = ctx.options[opt.id] ?? opt.default;
    if (opt.required && (value === undefined || value === '')) {
      throw new Error(`Missing required option "${opt.id}" (${opt.label})`);
    }
    if (value === undefined) continue;
    if (opt.choices && !opt.choices.includes(String(value))) {
      throw new Error(
        `Invalid value "${String(value)}" for option "${opt.id}" — must be one of: ${opt.choices.join(', ')}`,
      );
    }
    if (opt.file && typeof value === 'string' && !existsSync(value)) {
      throw new Error(`${opt.label} not found: ${value}`);
    }
  }
}
