import fs from 'node:fs/promises';
import path from 'node:path';
import type { MigrationPackageManifest } from '../package/manifest.js';

/** Read a written package manifest back from disk. */
export async function readManifest(outputDir: string): Promise<MigrationPackageManifest> {
  const raw = await fs.readFile(path.join(path.resolve(outputDir), 'manifest.json'), 'utf-8');
  return JSON.parse(raw) as MigrationPackageManifest;
}

/** Coerce an option value to a number, falling back when absent or not numeric. */
export function toNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
