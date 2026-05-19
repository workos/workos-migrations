import type { PoolConfig } from 'pg';
import type { OrgSchemaConfig } from '../../../shared/types.js';
import {
  exportOrganizations,
  mapMembershipRow,
  mapOrgRow,
  type MembershipQueryRow,
  type OrgQueryRow,
} from '../org-mapper.js';
import { SupabasePgClient, type PgPoolLike } from '../pg-client.js';

const CONFIG: OrgSchemaConfig = {
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

function fakeClient(handler: (sql: string) => unknown[]): SupabasePgClient {
  const factory = (_config: PoolConfig): PgPoolLike => ({
    async query(sql: string) {
      return { rows: handler(sql) };
    },
    async end() {},
  });
  return new SupabasePgClient({ connectionString: 'postgresql://x', poolFactory: factory });
}

describe('mapOrgRow', () => {
  it('passes org_external_id through and leaves org_id blank', () => {
    const row: OrgQueryRow = {
      org_internal_id: 'uuid-1',
      org_name: 'Acme',
      org_external_id: 'acme',
      org_domains: 'acme.com',
    };
    const { csvRow, warning } = mapOrgRow(row);
    expect(csvRow).toEqual({
      org_id: '',
      org_external_id: 'acme',
      org_name: 'Acme',
      domains: 'acme.com',
      metadata: '',
    });
    expect(warning).toBeUndefined();
  });

  it('joins an array of domains with commas', () => {
    expect(
      mapOrgRow({
        org_internal_id: 'u',
        org_name: 'X',
        org_external_id: 'x',
        org_domains: ['a.com', 'b.com'],
      }).csvRow.domains,
    ).toBe('a.com,b.com');
  });

  it('emits empty domains when null', () => {
    expect(
      mapOrgRow({
        org_internal_id: 'u',
        org_name: 'X',
        org_external_id: 'x',
        org_domains: null,
      }).csvRow.domains,
    ).toBe('');
  });

  it('falls back to org_internal_id when org_external_id is missing', () => {
    expect(
      mapOrgRow({
        org_internal_id: 'fallback',
        org_name: 'X',
        org_external_id: '',
        org_domains: null,
      }).csvRow.org_external_id,
    ).toBe('fallback');
  });

  it('JSON-stringifies object-shaped domains and emits a warning', () => {
    const result = mapOrgRow({
      org_internal_id: 'u',
      org_name: 'X',
      org_external_id: 'org-1',
      org_domains: { primary: 'acme.com' } as unknown as string,
    });
    expect(result.csvRow.domains).toBe('{"primary":"acme.com"}');
    expect(result.warning).toMatch(/Unrecognized domains shape for org org-1/);
  });
});

describe('mapMembershipRow', () => {
  const ROW: MembershipQueryRow = {
    email: 'alice@example.com',
    user_external_id: 'uuid-1',
    org_external_id: 'acme',
    role: 'owner',
  };

  it('maps role through the slug map when supplied', () => {
    const map = new Map([['owner', 'admin']]);
    const { csvRow, warning } = mapMembershipRow(ROW, map);
    expect(csvRow.role_slugs).toBe('admin');
    expect(warning).toBeUndefined();
  });

  it('passes the raw role through when no slug map is provided', () => {
    const { csvRow, warning } = mapMembershipRow(ROW, undefined);
    expect(csvRow.role_slugs).toBe('owner');
    expect(warning).toBeUndefined();
  });

  it('returns a warning when the role is not in the slug map', () => {
    const map = new Map([['admin', 'admin']]);
    const { csvRow, warning } = mapMembershipRow(ROW, map);
    expect(csvRow.role_slugs).toBe('');
    expect(warning).toBe('Unmapped role: owner');
  });

  it('leaves role_slugs empty for null role', () => {
    const { csvRow } = mapMembershipRow({ ...ROW, role: null }, new Map());
    expect(csvRow.role_slugs).toBe('');
  });
});

describe('exportOrganizations', () => {
  it('runs the three queries and aggregates rows', async () => {
    const pg = fakeClient((sql) => {
      if (/AS org_internal_id/.test(sql)) {
        return [
          {
            org_internal_id: 'u1',
            org_name: 'Acme',
            org_external_id: 'acme',
            org_domains: 'acme.com',
          },
        ];
      }
      if (/u\.email AS email/.test(sql)) {
        return [
          {
            email: 'alice@example.com',
            user_external_id: 'uuid-1',
            org_external_id: 'acme',
            role: 'owner',
          },
        ];
      }
      if (/LEFT JOIN auth\.users/.test(sql)) {
        return [{ count: 2 }];
      }
      return [];
    });

    const map = new Map([['owner', 'admin']]);
    const result = await exportOrganizations(pg, CONFIG, map);
    expect(result.organizationRows).toHaveLength(1);
    expect(result.organizationRows[0].org_external_id).toBe('acme');
    expect(result.membershipRows).toHaveLength(1);
    expect(result.membershipRows[0].role_slugs).toBe('admin');
    expect(result.orphanCount).toBe(2);
    expect(result.warnings.some((w) => /2 membership row\(s\)/.test(w))).toBe(true);
  });

  it('warns and returns empty when the org table does not exist', async () => {
    const pg = fakeClient((sql) => {
      if (/AS org_internal_id/.test(sql)) {
        throw new Error('relation "public.workspaces" does not exist');
      }
      return [];
    });
    const result = await exportOrganizations(pg, CONFIG, undefined);
    expect(result.organizationRows).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/Org table not found/);
  });

  it('warns and returns empty memberships when the members table does not exist', async () => {
    const pg = fakeClient((sql) => {
      if (/AS org_internal_id/.test(sql)) {
        return [
          { org_internal_id: 'u1', org_name: 'Acme', org_external_id: 'acme', org_domains: null },
        ];
      }
      if (/u\.email AS email/.test(sql)) {
        throw new Error('relation "public.workspace_members" does not exist');
      }
      return [];
    });
    const result = await exportOrganizations(pg, CONFIG, undefined);
    expect(result.organizationRows).toHaveLength(1);
    expect(result.membershipRows).toHaveLength(0);
    expect(result.warnings.some((w) => /Members table not found/.test(w))).toBe(true);
  });
});
