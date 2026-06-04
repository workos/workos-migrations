import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSource } from '../../registry';
import { expectByteIdenticalPackages } from '../../__tests__/tree-helper';
import { csvSource } from '../index';

describe('csvSource adapter', () => {
  it('is registered with file ingest', () => {
    expect(getSource('csv')).toBe(csvSource);
    expect(csvSource.capabilities.ingest).toBe('file');
  });

  it('writes a deterministic package skeleton with the requested manifest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'csv-adapter-'));
    const dirA = path.join(root, 'a');
    const dirB = path.join(root, 'b');

    try {
      const result = await csvSource.export({
        credentials: {},
        options: {
          provider: 'csv',
          entities: ['users', 'organizations', 'memberships'],
          sourceTenant: 'acme-csv',
        },
        outputDir: dirA,
        quiet: true,
      });

      expect(result.manifest.provider).toBe('csv');
      expect(result.manifest.sourceTenant).toBe('acme-csv');
      expect(result.manifest.entitiesRequested).toEqual(['users', 'organizations', 'memberships']);
      // Skeleton ships the canonical files + handoff dirs.
      await expect(fs.access(path.join(dirA, 'users.csv'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(dirA, 'manifest.json'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(dirA, 'sso'))).resolves.toBeUndefined();

      // The skeleton is deterministic (apart from the manifest timestamp).
      await csvSource.export({
        credentials: {},
        options: {
          provider: 'csv',
          entities: ['users', 'organizations', 'memberships'],
          sourceTenant: 'acme-csv',
        },
        outputDir: dirB,
        quiet: true,
      });
      await expectByteIdenticalPackages(dirA, dirB);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
