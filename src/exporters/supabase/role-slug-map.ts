import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse';

export type RoleSlugMap = Map<string, string>;

export interface ApplyRoleSlugMapResult {
  slug?: string;
  warning?: string;
}

/**
 * Load a role-slug map from JSON (object dict) or CSV (`role,slug` columns).
 * Format is detected by file extension; throws when the file doesn't exist.
 */
export async function loadRoleSlugMap(filePath: string): Promise<RoleSlugMap> {
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();

  if (ext === '.json') return loadJson(resolved);
  if (ext === '.csv') return loadCsv(resolved);
  throw new Error(`Unsupported role-slug-map extension: ${ext || '<none>'} (expected .json or .csv)`);
}

export function applyRoleSlugMap(
  map: RoleSlugMap | undefined,
  raw: string | null | undefined,
): ApplyRoleSlugMapResult {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};

  if (!map) return { slug: trimmed };

  const slug = map.get(trimmed);
  if (slug) return { slug };

  return { warning: `Unmapped role: ${trimmed}` };
}

async function loadJson(filePath: string): Promise<RoleSlugMap> {
  const raw = await fsp.readFile(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`Failed to parse role-slug-map JSON at ${filePath}: ${(error as Error).message}`, {
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Role-slug-map JSON must be an object dict: ${filePath}`);
  }

  const map: RoleSlugMap = new Map();
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error(`Role-slug-map JSON value for "${key}" must be a string`);
    }
    map.set(key, value);
  }
  return map;
}

async function loadCsv(filePath: string): Promise<RoleSlugMap> {
  return new Promise<RoleSlugMap>((resolve, reject) => {
    const map: RoleSlugMap = new Map();
    const parser = parse({ columns: true, skip_empty_lines: true, trim: true });
    createReadStream(filePath)
      .pipe(parser)
      .on('data', (row: Record<string, string>) => {
        if (!('role' in row) || !('slug' in row)) {
          parser.destroy(
            new Error(`Role-slug-map CSV must have columns "role" and "slug": ${filePath}`),
          );
          return;
        }
        const role = row.role?.trim();
        const slug = row.slug?.trim();
        if (role && slug) map.set(role, slug);
      })
      .on('end', () => resolve(map))
      .on('error', reject);
  });
}
