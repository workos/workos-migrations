import fs from 'node:fs/promises';
import path from 'node:path';

/** Recursively read a directory into a map of relative path -> file bytes. */
export async function readTree(dir: string): Promise<Map<string, Buffer>> {
  const tree = new Map<string, Buffer>();
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        tree.set(path.relative(dir, full), await fs.readFile(full));
      }
    }
  }
  await walk(dir);
  return tree;
}

/**
 * Assert two migration-package directories are byte-identical, normalizing only
 * the inherently non-deterministic timestamps: `generatedAt` in `manifest.json`
 * and the per-record `timestamp` in `*.jsonl` files (warnings, skipped users).
 * Every other field and file is compared byte-for-byte.
 */
export async function expectByteIdenticalPackages(
  legacyDir: string,
  adapterDir: string,
): Promise<void> {
  const legacy = await readTree(legacyDir);
  const adapter = await readTree(adapterDir);

  expect([...adapter.keys()].sort()).toEqual([...legacy.keys()].sort());

  for (const [rel, adapterBytes] of adapter) {
    const legacyBytes = legacy.get(rel)!;
    if (rel === 'manifest.json') {
      expect(stripKey(adapterBytes, 'generatedAt')).toEqual(stripKey(legacyBytes, 'generatedAt'));
    } else if (rel.endsWith('.jsonl')) {
      expect(stripJsonlTimestamps(adapterBytes)).toEqual(stripJsonlTimestamps(legacyBytes));
    } else {
      expect(adapterBytes.equals(legacyBytes)).toBe(true);
    }
  }
}

function stripKey(buf: Buffer, key: string): Record<string, unknown> {
  const obj = JSON.parse(buf.toString('utf-8')) as Record<string, unknown>;
  delete obj[key];
  return obj;
}

function stripJsonlTimestamps(buf: Buffer): Record<string, unknown>[] {
  return buf
    .toString('utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const obj = JSON.parse(line) as Record<string, unknown>;
      delete obj.timestamp;
      return obj;
    });
}
