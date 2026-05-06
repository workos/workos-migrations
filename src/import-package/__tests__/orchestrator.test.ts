import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMigrationPackage } from '../../package/writer';
import { MIGRATION_PACKAGE_CSV_HEADERS } from '../../package/manifest';
import { importPackage, planImportPackage } from '../orchestrator';

describe('import-package orchestrator', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-import-pkg-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('plans an Auth0 package and detects each entity', async () => {
    const pkgDir = path.join(tempRoot, 'pkg');
    await createMigrationPackage({
      provider: 'auth0',
      rootDir: pkgDir,
      entitiesRequested: ['users', 'organizations', 'memberships', 'roles', 'sso'],
      entitiesExported: {
        users: 1,
        organizations: 1,
        memberships: 1,
        roleDefinitions: 1,
        userRoleAssignments: 1,
        samlConnections: 1,
        oidcConnections: 0,
      },
      warnings: [],
    });

    writeRows(path.join(pkgDir, 'users.csv'), MIGRATION_PACKAGE_CSV_HEADERS.users, [
      {
        email: 'alice@example.com',
        first_name: 'Alice',
        last_name: 'Smith',
        email_verified: 'true',
        external_id: 'auth0|alice',
        org_external_id: 'org_1',
        org_name: 'Acme',
        role_slugs: 'admin-role',
      },
    ]);
    writeRows(path.join(pkgDir, 'organizations.csv'), MIGRATION_PACKAGE_CSV_HEADERS.organizations, [
      { org_external_id: 'org_1', org_name: 'Acme', domains: 'acme.com', metadata: '' },
    ]);
    writeRows(
      path.join(pkgDir, 'organization_memberships.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.memberships,
      [
        {
          email: 'alice@example.com',
          external_id: 'auth0|alice',
          org_external_id: 'org_1',
          org_name: 'Acme',
          role_slugs: 'admin-role',
          metadata: '',
        },
      ],
    );
    writeRows(
      path.join(pkgDir, 'role_definitions.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.roleDefinitions,
      [
        {
          role_slug: 'admin-role',
          role_name: 'Admin',
          role_type: 'environment',
          permissions: '',
          org_id: '',
          org_external_id: '',
        },
      ],
    );
    writeRows(
      path.join(pkgDir, 'user_role_assignments.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.userRoleAssignments,
      [
        {
          email: 'alice@example.com',
          user_id: '',
          external_id: 'auth0|alice',
          role_slug: 'admin-role',
          org_id: '',
          org_external_id: 'org_1',
        },
      ],
    );
    writeRows(
      path.join(pkgDir, 'sso/saml_connections.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.samlConnections,
      [
        {
          organizationName: 'Acme',
          organizationExternalId: 'org_1',
          domains: 'acme.com',
          idpEntityId: 'https://idp.example.com/entity',
          idpUrl: 'https://idp.example.com/sso',
          x509Cert: 'CERT',
          importedId: 'auth0:con_1',
        },
      ],
    );

    const plan = await planImportPackage(pkgDir);
    expect(plan).toMatchObject({
      manifestProvider: 'auth0',
      hasUsersCsv: true,
      hasOrganizationsCsv: true,
      hasMembershipsCsv: true,
      hasRoleDefinitionsCsv: true,
      hasRoleAssignmentsCsv: true,
      hasSso: true,
    });
    expect(plan.validationErrors).toEqual([]);
  });

  it('runs in dry-run mode without contacting WorkOS and writes a summary file', async () => {
    const pkgDir = path.join(tempRoot, 'pkg');
    await createMigrationPackage({
      provider: 'auth0',
      rootDir: pkgDir,
      entitiesRequested: ['users', 'organizations', 'memberships'],
      entitiesExported: { users: 1, organizations: 1, memberships: 1 },
      warnings: [],
    });

    writeRows(path.join(pkgDir, 'users.csv'), MIGRATION_PACKAGE_CSV_HEADERS.users, [
      {
        email: 'alice@example.com',
        first_name: 'Alice',
        last_name: 'Smith',
        email_verified: 'true',
        external_id: 'auth0|alice',
        org_external_id: 'org_1',
        org_name: 'Acme',
      },
    ]);
    writeRows(path.join(pkgDir, 'organizations.csv'), MIGRATION_PACKAGE_CSV_HEADERS.organizations, [
      { org_external_id: 'org_1', org_name: 'Acme', domains: 'acme.com', metadata: '' },
    ]);
    writeRows(
      path.join(pkgDir, 'organization_memberships.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.memberships,
      [
        {
          email: 'alice@example.com',
          external_id: 'auth0|alice',
          org_external_id: 'org_1',
          org_name: 'Acme',
          role_slugs: '',
          metadata: '',
        },
      ],
    );

    const summary = await importPackage({
      packageDir: pkgDir,
      dryRun: true,
      quiet: true,
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.manifestProvider).toBe('auth0');
    expect(summary.users).toMatchObject({ status: 'planned', total: 1 });
    expect(summary.organizations).toMatchObject({ status: 'planned' });
    expect(summary.memberships).toMatchObject({ status: 'planned' });
    expect(summary.ssoConnections).toEqual({ status: 'absent' });

    const summaryPath = path.join(pkgDir, 'workos_import_summary.json');
    expect(fs.existsSync(summaryPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    expect(parsed.users.status).toBe('planned');
  });

  it('flags SSO files as handoff-only', async () => {
    const pkgDir = path.join(tempRoot, 'pkg');
    await createMigrationPackage({
      provider: 'auth0',
      rootDir: pkgDir,
      entitiesRequested: ['sso'],
      entitiesExported: { samlConnections: 1 },
      warnings: [],
    });

    writeRows(
      path.join(pkgDir, 'sso/saml_connections.csv'),
      MIGRATION_PACKAGE_CSV_HEADERS.samlConnections,
      [
        {
          organizationName: 'Acme',
          organizationExternalId: 'org_1',
          domains: 'acme.com',
          idpEntityId: 'https://idp.example.com/entity',
          idpUrl: 'https://idp.example.com/sso',
          x509Cert: 'CERT',
          importedId: 'auth0:con_1',
        },
      ],
    );

    const summary = await importPackage({ packageDir: pkgDir, dryRun: true, quiet: true });
    expect(summary.ssoConnections).toMatchObject({ status: 'handoff', total: 1 });
  });
});

function writeRows(
  filePath: string,
  headers: readonly string[],
  rows: Record<string, string>[],
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header] ?? '')).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
