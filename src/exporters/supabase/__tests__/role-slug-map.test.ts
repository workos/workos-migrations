import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyRoleSlugMap, loadRoleSlugMap } from '../role-slug-map.js';

describe('loadRoleSlugMap', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-slug-map-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a JSON dict and returns a Map', async () => {
    const jsonPath = path.join(tmpDir, 'roles.json');
    await fsp.writeFile(jsonPath, JSON.stringify({ owner: 'admin', member: 'member' }));

    const map = await loadRoleSlugMap(jsonPath);
    expect(map.get('owner')).toBe('admin');
    expect(map.get('member')).toBe('member');
    expect(map.size).toBe(2);
  });

  it('loads a CSV with role,slug columns and returns a Map', async () => {
    const csvPath = path.join(tmpDir, 'roles.csv');
    await fsp.writeFile(csvPath, 'role,slug\nowner,admin\nmember,member\n');

    const map = await loadRoleSlugMap(csvPath);
    expect(map.get('owner')).toBe('admin');
    expect(map.get('member')).toBe('member');
  });

  it('rejects unsupported extensions', async () => {
    await expect(loadRoleSlugMap(path.join(tmpDir, 'roles.yaml'))).rejects.toThrow(
      /Unsupported.*\.yaml/,
    );
  });

  it('throws when the file does not exist (JSON branch)', async () => {
    await expect(loadRoleSlugMap(path.join(tmpDir, 'missing.json'))).rejects.toThrow();
  });

  it('throws when JSON content is not an object dict', async () => {
    const jsonPath = path.join(tmpDir, 'array.json');
    await fsp.writeFile(jsonPath, JSON.stringify(['a', 'b']));
    await expect(loadRoleSlugMap(jsonPath)).rejects.toThrow(/must be an object dict/);
  });

  it('throws when a JSON value is non-string', async () => {
    const jsonPath = path.join(tmpDir, 'bad.json');
    await fsp.writeFile(jsonPath, JSON.stringify({ owner: 42 }));
    await expect(loadRoleSlugMap(jsonPath)).rejects.toThrow(/must be a string/);
  });

  it('throws when the CSV lacks required columns', async () => {
    const csvPath = path.join(tmpDir, 'wrong.csv');
    await fsp.writeFile(csvPath, 'foo,bar\n1,2\n');
    await expect(loadRoleSlugMap(csvPath)).rejects.toThrow(/columns "role" and "slug"/);
  });
});

describe('applyRoleSlugMap', () => {
  const map = new Map([
    ['owner', 'admin'],
    ['member', 'member'],
  ]);

  it('returns the mapped slug on a hit', () => {
    expect(applyRoleSlugMap(map, 'owner')).toEqual({ slug: 'admin' });
  });

  it('returns a warning on a miss', () => {
    expect(applyRoleSlugMap(map, 'guest')).toEqual({ warning: 'Unmapped role: guest' });
  });

  it('passes through the raw value when no map is provided', () => {
    expect(applyRoleSlugMap(undefined, 'owner')).toEqual({ slug: 'owner' });
  });

  it('returns empty result for null/empty raw values', () => {
    expect(applyRoleSlugMap(map, null)).toEqual({});
    expect(applyRoleSlugMap(map, '')).toEqual({});
    expect(applyRoleSlugMap(map, '   ')).toEqual({});
  });

  it('is case-sensitive', () => {
    expect(applyRoleSlugMap(map, 'Owner')).toEqual({ warning: 'Unmapped role: Owner' });
  });
});
