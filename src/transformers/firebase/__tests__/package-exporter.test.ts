import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamCSV } from '../../../shared/csv-utils';
import { validateMigrationPackage } from '../../../package/validator';
import { exportFirebasePackage } from '../package-exporter';

describe('exportFirebasePackage', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-firebase-pkg-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('writes a valid package and skips disabled + missing-email users by default', async () => {
    const inputJson = path.join(tempRoot, 'firebase.json');
    fs.writeFileSync(
      inputJson,
      JSON.stringify({
        users: [
          {
            localId: 'fb_alice',
            email: 'alice@acme.com',
            displayName: 'Alice Builder',
            emailVerified: true,
          },
          {
            localId: 'fb_disabled',
            email: 'sleeper@acme.com',
            displayName: 'Disabled',
            disabled: true,
          },
          {
            localId: 'fb_no_email',
            displayName: 'No Email',
          },
        ],
      }),
    );

    const orgMapping = path.join(tempRoot, 'orgs.csv');
    fs.writeFileSync(orgMapping, 'firebase_uid,org_external_id,org_name\nfb_alice,acme,Acme\n');

    const roleMapping = path.join(tempRoot, 'roles.csv');
    fs.writeFileSync(roleMapping, 'firebase_uid,role_slug\nfb_alice,admin\n');

    const pkgDir = path.join(tempRoot, 'pkg');
    const stats = await exportFirebasePackage({
      input: inputJson,
      outputDir: pkgDir,
      nameSplitStrategy: 'first-space',
      orgMapping,
      roleMapping,
      quiet: true,
    });

    expect(stats.totalUsers).toBe(1);
    expect(stats.skippedUsers).toBe(2);
    expect(stats.totalOrgs).toBe(1);
    expect(stats.totalMemberships).toBe(1);
    expect(stats.roleDefinitions).toBe(1);
    expect(stats.userRoleAssignments).toBe(1);

    const validation = await validateMigrationPackage(pkgDir);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.provider).toBe('firebase');

    const users = await readCsv(path.join(pkgDir, 'users.csv'));
    expect(users).toMatchObject([
      {
        email: 'alice@acme.com',
        first_name: 'Alice',
        last_name: 'Builder',
        external_id: 'fb_alice',
        org_external_id: 'acme',
        role_slugs: 'admin',
      },
    ]);

    const skipped = readJsonl(path.join(pkgDir, 'skipped_users.jsonl'));
    expect(skipped.map((s) => s.reason).sort()).toEqual(['disabled_user', 'no_email']);
  });

  it('warns when scrypt parameters are missing for users with passwords', async () => {
    const inputJson = path.join(tempRoot, 'firebase.json');
    fs.writeFileSync(
      inputJson,
      JSON.stringify({
        users: [
          {
            localId: 'fb_user',
            email: 'user@acme.com',
            passwordHash: 'aGFzaA==',
            salt: 'c2FsdA==',
          },
        ],
      }),
    );
    const pkgDir = path.join(tempRoot, 'pkg');
    const stats = await exportFirebasePackage({
      input: inputJson,
      outputDir: pkgDir,
      nameSplitStrategy: 'first-space',
      quiet: true,
    });
    expect(stats.totalUsers).toBe(1);
    expect(stats.warnings.some((w) => w.code === 'missing_scrypt_parameters')).toBe(true);
  });

  it('preserves mfaInfo, createdAt, and lastSignedInAt in user metadata', async () => {
    const inputJson = path.join(tempRoot, 'firebase.json');
    fs.writeFileSync(
      inputJson,
      JSON.stringify({
        users: [
          {
            localId: 'fb_meta',
            email: 'meta@acme.com',
            displayName: 'Meta User',
            emailVerified: true,
            createdAt: '1700000000000',
            lastSignedInAt: '1700100000000',
            mfaInfo: [
              {
                mfaEnrollmentId: 'mfa_123',
                phoneInfo: '+15551234567',
                enrolledAt: '2023-11-15T00:00:00Z',
              },
            ],
          },
        ],
      }),
    );
    const pkgDir = path.join(tempRoot, 'pkg');
    await exportFirebasePackage({
      input: inputJson,
      outputDir: pkgDir,
      nameSplitStrategy: 'first-space',
      quiet: true,
    });

    const users = await readCsv(path.join(pkgDir, 'users.csv'));
    expect(users).toHaveLength(1);
    const metadata = JSON.parse(users[0].metadata) as Record<string, unknown>;
    expect(metadata.created_at).toBe(new Date(1700000000000).toISOString());
    expect(metadata.last_signed_in_at).toBe(new Date(1700100000000).toISOString());
    expect(metadata.mfa_info).toEqual([
      {
        mfaEnrollmentId: 'mfa_123',
        phoneInfo: '+15551234567',
        enrolledAt: '2023-11-15T00:00:00Z',
      },
    ]);
  });

  it('respects include-disabled', async () => {
    const inputJson = path.join(tempRoot, 'firebase.json');
    fs.writeFileSync(
      inputJson,
      JSON.stringify({
        users: [
          { localId: 'fb_a', email: 'a@x.com', disabled: true },
          { localId: 'fb_b', email: 'b@x.com' },
        ],
      }),
    );
    const pkgDir = path.join(tempRoot, 'pkg');
    const stats = await exportFirebasePackage({
      input: inputJson,
      outputDir: pkgDir,
      nameSplitStrategy: 'first-space',
      includeDisabled: true,
      quiet: true,
    });
    expect(stats.totalUsers).toBe(2);
  });
});

async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  for await (const row of streamCSV(filePath)) {
    rows.push(row as Record<string, string>);
  }
  return rows;
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
}
