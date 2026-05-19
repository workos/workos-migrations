import {
  ORGANIZATION_CSV_HEADERS,
  ORGANIZATION_MEMBERSHIP_CSV_HEADERS,
} from '../../package/manifest.js';
import type { OrgSchemaConfig } from '../../shared/types.js';
import type { SupabasePgQueryClient } from './pg-client.js';
import {
  buildMembershipQuery,
  buildOrgQuery,
  buildOrphanMembershipCountQuery,
} from './org-query-builder.js';
import { applyRoleSlugMap, type RoleSlugMap } from './role-slug-map.js';

export interface OrgQueryRow {
  org_internal_id: string;
  org_name: string;
  org_external_id: string;
  org_domains: string | string[] | null;
}

export interface MembershipQueryRow {
  email: string;
  user_external_id: string;
  org_external_id: string;
  role: string | null;
}

type OrgCsvRow = Record<(typeof ORGANIZATION_CSV_HEADERS)[number], string>;
type MembershipCsvRow = Record<(typeof ORGANIZATION_MEMBERSHIP_CSV_HEADERS)[number], string>;

export interface OrgExportResult {
  organizationRows: OrgCsvRow[];
  membershipRows: MembershipCsvRow[];
  warnings: string[];
  orphanCount: number;
}

export function mapOrgRow(row: OrgQueryRow): { csvRow: OrgCsvRow; warning?: string } {
  const externalId = row.org_external_id?.toString().trim() || row.org_internal_id?.toString().trim() || '';
  const { domains, warning } = normalizeDomains(row.org_domains, externalId);
  const csvRow: OrgCsvRow = {
    org_id: '',
    org_external_id: externalId,
    org_name: row.org_name ?? '',
    domains,
    metadata: '',
  };
  return warning ? { csvRow, warning } : { csvRow };
}

export function mapMembershipRow(
  row: MembershipQueryRow,
  roleSlugMap: RoleSlugMap | undefined,
): { csvRow: MembershipCsvRow; warning?: string } {
  const { slug, warning } = applyRoleSlugMap(roleSlugMap, row.role);
  const csvRow: MembershipCsvRow = {
    email: row.email ?? '',
    external_id: row.user_external_id ?? '',
    user_id: '',
    org_id: '',
    org_external_id: row.org_external_id ?? '',
    org_name: '',
    role_slugs: slug ?? '',
    metadata: '',
  };
  return warning ? { csvRow, warning } : { csvRow };
}

export async function exportOrganizations(
  pg: SupabasePgQueryClient,
  config: OrgSchemaConfig,
  roleSlugMap: RoleSlugMap | undefined,
): Promise<OrgExportResult> {
  const warnings: string[] = [];

  let orgRows: OrgQueryRow[];
  try {
    orgRows = await pg.query<OrgQueryRow>(buildOrgQuery(config));
  } catch (error: unknown) {
    const message = (error as Error).message ?? 'unknown error';
    if (isMissingRelationError(message)) {
      warnings.push(
        `Org table not found (${formatTable(config.orgTable.schema, config.orgTable.name)}): ${message}. Organizations export skipped.`,
      );
      return { organizationRows: [], membershipRows: [], warnings, orphanCount: 0 };
    }
    throw error;
  }

  const organizationRows: OrgCsvRow[] = [];
  for (const row of orgRows) {
    const { csvRow, warning } = mapOrgRow(row);
    organizationRows.push(csvRow);
    if (warning) warnings.push(warning);
  }

  let membershipRowsRaw: MembershipQueryRow[];
  try {
    membershipRowsRaw = await pg.query<MembershipQueryRow>(buildMembershipQuery(config));
  } catch (error: unknown) {
    const message = (error as Error).message ?? 'unknown error';
    if (isMissingRelationError(message)) {
      warnings.push(
        `Members table not found (${formatTable(config.membersTable.schema, config.membersTable.name)}): ${message}. Memberships export skipped.`,
      );
      return { organizationRows, membershipRows: [], warnings, orphanCount: 0 };
    }
    throw error;
  }

  const membershipRows: MembershipCsvRow[] = [];
  for (const row of membershipRowsRaw) {
    const { csvRow, warning } = mapMembershipRow(row, roleSlugMap);
    membershipRows.push(csvRow);
    if (warning) warnings.push(warning);
  }

  let orphanCount = 0;
  try {
    const orphanRows = await pg.query<{ count: number }>(buildOrphanMembershipCountQuery(config));
    orphanCount = Number(orphanRows[0]?.count ?? 0);
    if (orphanCount > 0) {
      warnings.push(
        `${orphanCount} membership row(s) in ${formatTable(config.membersTable.schema, config.membersTable.name)} reference a user_id not present in auth.users; dropped from output.`,
      );
    }
  } catch {
    // Orphan count is best-effort; failures don't block the export.
  }

  return { organizationRows, membershipRows, warnings, orphanCount };
}

function normalizeDomains(
  value: string | string[] | null | undefined,
  orgIdentifier: string,
): { domains: string; warning?: string } {
  if (value === null || value === undefined) return { domains: '' };
  if (Array.isArray(value)) return { domains: value.filter(Boolean).join(',') };
  if (typeof value === 'string') return { domains: value.trim() };
  // JSONB or other object shape — surface a warning so it's not silently degraded.
  return {
    domains: JSON.stringify(value),
    warning: `Unrecognized domains shape for org ${orgIdentifier || '<unknown>'}; serialized as JSON.`,
  };
}

function isMissingRelationError(message: string): boolean {
  return /does not exist/i.test(message) && /relation|table/i.test(message);
}

function formatTable(schema: string | undefined, name: string): string {
  return schema ? `${schema}.${name}` : name;
}
