import {
  parseQualifiedIdentifier,
  validateOrgSchemaFlags,
  type OrgSchemaFlags,
} from '../org-schema.js';

describe('parseQualifiedIdentifier', () => {
  it('parses an unqualified identifier', () => {
    expect(parseQualifiedIdentifier('organizations')).toEqual({ name: 'organizations' });
  });

  it('parses a schema-qualified identifier', () => {
    expect(parseQualifiedIdentifier('public.orgs')).toEqual({ schema: 'public', name: 'orgs' });
  });

  it('accepts reserved words (pg-format will quote them later)', () => {
    expect(parseQualifiedIdentifier('user')).toEqual({ name: 'user' });
    expect(parseQualifiedIdentifier('public.select')).toEqual({ schema: 'public', name: 'select' });
  });

  it('rejects identifiers with semicolons', () => {
    expect(() => parseQualifiedIdentifier('orgs; DROP TABLE x')).toThrow(/Invalid identifier/);
  });

  it('rejects identifiers with quotes', () => {
    expect(() => parseQualifiedIdentifier('"orgs"')).toThrow(/Invalid identifier/);
  });

  it('rejects identifiers with spaces', () => {
    expect(() => parseQualifiedIdentifier('public orgs')).toThrow(/Invalid identifier/);
  });

  it('rejects identifiers with three or more dot-separated parts', () => {
    expect(() => parseQualifiedIdentifier('a.b.c')).toThrow(/Invalid identifier/);
  });

  it('rejects identifiers starting with a digit', () => {
    expect(() => parseQualifiedIdentifier('1orgs')).toThrow(/Invalid identifier/);
  });
});

describe('validateOrgSchemaFlags', () => {
  it('returns null when no flags are supplied', () => {
    expect(validateOrgSchemaFlags({})).toBeNull();
  });

  it('parses a complete minimal config', () => {
    const flags: OrgSchemaFlags = {
      orgTable: 'public.organizations',
      orgIdColumn: 'id',
      orgNameColumn: 'name',
      membersTable: 'public.org_members',
      membershipUserColumn: 'user_id',
      membershipOrgColumn: 'organization_id',
    };
    expect(validateOrgSchemaFlags(flags)).toEqual({
      orgTable: { schema: 'public', name: 'organizations' },
      orgIdColumn: 'id',
      orgNameColumn: 'name',
      membersTable: { schema: 'public', name: 'org_members' },
      membershipUserColumn: 'user_id',
      membershipOrgColumn: 'organization_id',
    });
  });

  it('includes optional columns when supplied', () => {
    const config = validateOrgSchemaFlags({
      orgTable: 'public.workspaces',
      orgIdColumn: 'id',
      orgNameColumn: 'name',
      orgExternalIdColumn: 'slug',
      orgDomainsColumn: 'domain',
      membersTable: 'public.workspace_members',
      membershipUserColumn: 'user_id',
      membershipOrgColumn: 'workspace_id',
      membershipRoleColumn: 'role',
      roleSlugMapPath: './roles.json',
    });
    expect(config?.orgExternalIdColumn).toBe('slug');
    expect(config?.orgDomainsColumn).toBe('domain');
    expect(config?.membershipRoleColumn).toBe('role');
    expect(config?.roleSlugMapPath).toBe('./roles.json');
  });

  it('throws when only some required flags are present', () => {
    expect(() =>
      validateOrgSchemaFlags({
        orgTable: 'public.orgs',
        orgIdColumn: 'id',
      }),
    ).toThrow(/Incomplete org schema flags/);
  });

  it('throws with an injection attempt in the table flag', () => {
    expect(() =>
      validateOrgSchemaFlags({
        orgTable: 'public.organizations; DROP TABLE x',
        orgIdColumn: 'id',
        orgNameColumn: 'name',
        membersTable: 'public.members',
        membershipUserColumn: 'user_id',
        membershipOrgColumn: 'org_id',
      }),
    ).toThrow(/Invalid identifier/);
  });

  it('throws when a column flag contains invalid characters', () => {
    expect(() =>
      validateOrgSchemaFlags({
        orgTable: 'public.orgs',
        orgIdColumn: 'id; --',
        orgNameColumn: 'name',
        membersTable: 'public.members',
        membershipUserColumn: 'user_id',
        membershipOrgColumn: 'org_id',
      }),
    ).toThrow(/Invalid identifier for --org-id-column/);
  });
});
