import { buildRoleAssignmentRows, normalizeAuth0Roles, normalizeRoleSlug } from '../role-mapper';

describe('normalizeRoleSlug', () => {
  it('lowercases and replaces non-alphanumeric runs with single hyphens', () => {
    expect(normalizeRoleSlug('Sales Manager')).toBe('sales-manager');
    expect(normalizeRoleSlug('Billing/Admin')).toBe('billing-admin');
    expect(normalizeRoleSlug('  Lead  Engineer  ')).toBe('lead-engineer');
    expect(normalizeRoleSlug('Data:Pipelines.Owner')).toBe('data-pipelines-owner');
  });

  it('strips leading/trailing hyphens and collapses runs', () => {
    expect(normalizeRoleSlug('---hello---world---')).toBe('hello-world');
    expect(normalizeRoleSlug('***!')).toBe('');
  });

  it('returns empty string for falsy input', () => {
    expect(normalizeRoleSlug('')).toBe('');
    expect(normalizeRoleSlug(undefined)).toBe('');
    expect(normalizeRoleSlug(null)).toBe('');
  });
});

describe('normalizeAuth0Roles', () => {
  it('maps Auth0 role names to stable kebab-case slugs', () => {
    const result = normalizeAuth0Roles([
      { id: 'rol_1', name: 'Sales Manager' },
      { id: 'rol_2', name: 'Billing Admin', description: 'Billing-only access' },
    ]);

    expect(result.warnings).toEqual([]);
    expect(result.roles).toMatchObject([
      { slug: 'sales-manager', name: 'Sales Manager' },
      { slug: 'billing-admin', name: 'Billing Admin', description: 'Billing-only access' },
    ]);
    expect(result.slugByRoleId.get('rol_1')).toBe('sales-manager');
    expect(result.slugByRoleId.get('rol_2')).toBe('billing-admin');
  });

  it('appends a numeric suffix when two roles produce the same slug', () => {
    const result = normalizeAuth0Roles([
      { id: 'rol_1', name: 'Admin' },
      { id: 'rol_2', name: 'admin' },
      { id: 'rol_3', name: 'ADMIN' },
    ]);

    expect(result.roles.map((role) => role.slug)).toEqual([
      'admin-role',
      'admin-role-2',
      'admin-role-3',
    ]);
    expect(result.warnings.filter((w) => w.code === 'duplicate_role_slug')).toHaveLength(2);
  });

  it('synthesizes a fallback slug when the role name is empty', () => {
    const result = normalizeAuth0Roles([
      { id: 'rol_unnamed', name: '' },
      { id: 'rol_symbols', name: '!!!' },
    ]);

    expect(result.roles[0]?.slug).toMatch(/^auth0-role-/);
    expect(result.roles[0]?.synthesized).toBe(true);
    expect(result.roles[1]?.slug).toMatch(/^auth0-role-/);
    expect(result.warnings.filter((w) => w.code === 'unmappable_role_name')).toHaveLength(2);
  });

  it('skips and warns about repeated role ids', () => {
    const result = normalizeAuth0Roles([
      { id: 'rol_1', name: 'Member' },
      { id: 'rol_1', name: 'Member (duplicate)' },
    ]);

    expect(result.roles).toHaveLength(1);
    expect(result.warnings.find((w) => w.code === 'duplicate_role_id')).toMatchObject({
      role_id: 'rol_1',
    });
  });
});

describe('buildRoleAssignmentRows', () => {
  it('emits one row per role and dedupes within a single user', () => {
    const slugByRoleId = new Map<string, string>([
      ['rol_admin', 'admin-role'],
      ['rol_member', 'member-role'],
    ]);

    const result = buildRoleAssignmentRows(
      {
        email: 'user@example.com',
        externalId: 'auth0|abc',
        orgExternalId: 'org_xyz',
        roles: [
          { id: 'rol_admin', name: 'Admin' },
          { id: 'rol_member', name: 'Member' },
          { id: 'rol_member', name: 'Member' },
        ],
      },
      slugByRoleId,
    );

    expect(result.warnings).toEqual([]);
    expect(result.slugs).toEqual(['admin-role', 'member-role']);
    expect(result.rows).toEqual([
      {
        email: 'user@example.com',
        user_id: '',
        external_id: 'auth0|abc',
        role_slug: 'admin-role',
        org_id: '',
        org_external_id: 'org_xyz',
      },
      {
        email: 'user@example.com',
        user_id: '',
        external_id: 'auth0|abc',
        role_slug: 'member-role',
        org_id: '',
        org_external_id: 'org_xyz',
      },
    ]);
  });

  it('warns and skips assignments whose role id is not in the catalog', () => {
    const result = buildRoleAssignmentRows(
      {
        externalId: 'auth0|abc',
        orgExternalId: 'org_xyz',
        roles: [{ id: 'rol_unknown', name: 'Unknown' }],
      },
      new Map<string, string>(),
    );

    expect(result.rows).toEqual([]);
    expect(result.slugs).toEqual([]);
    expect(result.warnings).toMatchObject([
      {
        code: 'unknown_role_assignment',
        role_id: 'rol_unknown',
      },
    ]);
  });
});
