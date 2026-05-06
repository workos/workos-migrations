import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamCSV } from '../../../shared/csv-utils';
import { validateMigrationPackage } from '../../../package/validator';
import { exportClerkPackage } from '../package-exporter';

describe('exportClerkPackage', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-clerk-pkg-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('writes a valid package from a Clerk dashboard CSV with org and role mappings', async () => {
    const inputCsv = path.join(tempRoot, 'clerk.csv');
    fs.writeFileSync(
      inputCsv,
      [
        'id,primary_email_address,first_name,last_name,password_hasher,password_digest,username',
        'user_alice,alice@acme.com,Alice,Builder,bcrypt,$2a$10$alicehash,alice',
        'user_bob,bob@acme.com,Bob,,scrypt,$scrypt$bobhash,bob',
        'user_no_email,,,,,,',
      ].join('\n'),
    );

    const orgMappingPath = path.join(tempRoot, 'orgs.csv');
    fs.writeFileSync(
      orgMappingPath,
      'clerk_user_id,org_external_id,org_name\nuser_alice,acme,Acme\nuser_bob,acme,Acme\n',
    );

    const roleMappingPath = path.join(tempRoot, 'roles.csv');
    fs.writeFileSync(
      roleMappingPath,
      'clerk_user_id,role_slug\nuser_alice,admin\nuser_bob,member\n',
    );

    const pkgDir = path.join(tempRoot, 'pkg');
    const stats = await exportClerkPackage({
      input: inputCsv,
      outputDir: pkgDir,
      orgMapping: orgMappingPath,
      roleMapping: roleMappingPath,
      quiet: true,
    });

    expect(stats.totalUsers).toBe(2);
    expect(stats.totalOrgs).toBe(1);
    expect(stats.totalMemberships).toBe(2);
    expect(stats.roleDefinitions).toBe(2);
    expect(stats.userRoleAssignments).toBe(2);
    expect(stats.skippedUsers).toBe(1);
    expect(stats.warnings.some((w) => w.code === 'unsupported_password_hasher')).toBe(true);

    const validation = await validateMigrationPackage(pkgDir);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.provider).toBe('clerk');

    const users = await readCsv(path.join(pkgDir, 'users.csv'));
    expect(users.find((u) => u.external_id === 'user_alice')).toMatchObject({
      email: 'alice@acme.com',
      first_name: 'Alice',
      last_name: 'Builder',
      password_hash: '$2a$10$alicehash',
      password_hash_type: 'bcrypt',
      org_external_id: 'acme',
      role_slugs: 'admin',
    });
    expect(users.find((u) => u.external_id === 'user_bob')).toMatchObject({
      email: 'bob@acme.com',
      password_hash: '',
      password_hash_type: '',
    });

    const orgs = await readCsv(path.join(pkgDir, 'organizations.csv'));
    expect(orgs).toMatchObject([{ org_external_id: 'acme', org_name: 'Acme' }]);

    const memberships = await readCsv(path.join(pkgDir, 'organization_memberships.csv'));
    expect(memberships).toHaveLength(2);

    const roles = await readCsv(path.join(pkgDir, 'role_definitions.csv'));
    expect(roles.map((r) => r.role_slug).sort()).toEqual(['admin', 'member']);

    const assignments = await readCsv(path.join(pkgDir, 'user_role_assignments.csv'));
    expect(assignments).toHaveLength(2);

    const upload = await readCsv(path.join(pkgDir, 'workos_upload', 'users.csv'));
    expect(upload).toHaveLength(2);
    expect(upload.find((u) => u.user_id === 'user_alice')?.password_hash).toBe('$2a$10$alicehash');
  });

  it('writes a package without orgs when no mapping is provided', async () => {
    const inputCsv = path.join(tempRoot, 'clerk.csv');
    fs.writeFileSync(
      inputCsv,
      'id,primary_email_address,first_name\nuser_solo,solo@acme.com,Solo\n',
    );
    const pkgDir = path.join(tempRoot, 'pkg');
    const stats = await exportClerkPackage({ input: inputCsv, outputDir: pkgDir, quiet: true });

    expect(stats.totalUsers).toBe(1);
    expect(stats.totalOrgs).toBe(0);
    expect(stats.totalMemberships).toBe(0);

    const validation = await validateMigrationPackage(pkgDir);
    expect(validation.valid).toBe(true);
  });
});

async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  for await (const row of streamCSV(filePath)) {
    rows.push(row as Record<string, string>);
  }
  return rows;
}
