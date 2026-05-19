import type { OrgSchemaConfig } from '../../../shared/types.js';
import {
  buildMembershipQuery,
  buildOrgQuery,
  buildOrphanMembershipCountQuery,
} from '../org-query-builder.js';

const MINIMAL_CONFIG: OrgSchemaConfig = {
  orgTable: { schema: 'public', name: 'organizations' },
  orgIdColumn: 'id',
  orgNameColumn: 'name',
  membersTable: { schema: 'public', name: 'org_members' },
  membershipUserColumn: 'user_id',
  membershipOrgColumn: 'organization_id',
};

const FULL_CONFIG: OrgSchemaConfig = {
  orgTable: { schema: 'public', name: 'workspaces' },
  orgIdColumn: 'id',
  orgNameColumn: 'name',
  orgExternalIdColumn: 'slug',
  orgDomainsColumn: 'domain',
  membersTable: { schema: 'public', name: 'workspace_members' },
  membershipUserColumn: 'user_id',
  membershipOrgColumn: 'workspace_id',
  membershipRoleColumn: 'role',
};

describe('buildOrgQuery', () => {
  it('builds a minimal SELECT against schema.table', () => {
    expect(buildOrgQuery(MINIMAL_CONFIG)).toMatchInlineSnapshot(
      `"SELECT id::text AS org_internal_id, name AS org_name, id::text AS org_external_id, NULL::text AS org_domains FROM public.organizations"`,
    );
  });

  it('includes optional columns when present', () => {
    expect(buildOrgQuery(FULL_CONFIG)).toMatchInlineSnapshot(
      `"SELECT id::text AS org_internal_id, name AS org_name, slug::text AS org_external_id, domain AS org_domains FROM public.workspaces"`,
    );
  });

  it('quotes reserved-word identifiers', () => {
    const config: OrgSchemaConfig = {
      ...MINIMAL_CONFIG,
      orgTable: { schema: 'public', name: 'select' },
      orgNameColumn: 'user',
    };
    const sql = buildOrgQuery(config);
    expect(sql).toContain('"user" AS org_name');
    expect(sql).toContain('public."select"');
  });

  it('defaults to public schema when none is provided', () => {
    const config: OrgSchemaConfig = {
      ...MINIMAL_CONFIG,
      orgTable: { name: 'organizations' },
    };
    expect(buildOrgQuery(config)).toContain('FROM public.organizations');
  });
});

describe('buildMembershipQuery', () => {
  it('builds an INNER JOIN against auth.users for email resolution', () => {
    const sql = buildMembershipQuery(MINIMAL_CONFIG);
    expect(sql).toContain('JOIN auth.users u ON u.id = m.user_id');
    expect(sql).toContain('FROM public.org_members m');
    expect(sql).toContain('JOIN public.organizations o ON o.id = m.organization_id');
    expect(sql).toContain('NULL::text AS role');
  });

  it('selects the role column when --membership-role-column is provided', () => {
    const sql = buildMembershipQuery(FULL_CONFIG);
    expect(sql).toContain('m.role::text AS role');
  });

  it('uses the org_external_id column on the orgs table for the join projection', () => {
    const sql = buildMembershipQuery(FULL_CONFIG);
    expect(sql).toContain('o.slug::text AS org_external_id');
  });

  it('falls back to membership-org-column when no orgExternalIdColumn is set', () => {
    const sql = buildMembershipQuery(MINIMAL_CONFIG);
    expect(sql).toContain('m.organization_id::text AS org_external_id');
  });
});

describe('buildOrphanMembershipCountQuery', () => {
  it('builds a LEFT JOIN counting memberships whose user is missing from auth.users', () => {
    expect(buildOrphanMembershipCountQuery(MINIMAL_CONFIG)).toMatchInlineSnapshot(
      `"SELECT count(*)::int AS count FROM public.org_members m LEFT JOIN auth.users u ON u.id = m.user_id WHERE u.id IS NULL"`,
    );
  });
});
