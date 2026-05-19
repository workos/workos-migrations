import pgFormatModule from 'pg-format';
import type { OrgSchemaConfig, QualifiedIdentifier } from '../../shared/types.js';

// `pg-format` is a CJS module; the default export carries the format function.
const format: (fmt: string, ...args: unknown[]) => string =
  (pgFormatModule as unknown as { default?: typeof pgFormatModule }).default ?? pgFormatModule;

const DEFAULT_SCHEMA = 'public';

function qualified(table: QualifiedIdentifier): { schema: string; name: string } {
  return { schema: table.schema ?? DEFAULT_SCHEMA, name: table.name };
}

export function buildOrgQuery(config: OrgSchemaConfig): string {
  const t = qualified(config.orgTable);

  const selectParts: string[] = [
    format('%I::text AS org_internal_id', config.orgIdColumn),
    format('%I AS org_name', config.orgNameColumn),
  ];

  if (config.orgExternalIdColumn) {
    selectParts.push(format('%I::text AS org_external_id', config.orgExternalIdColumn));
  } else {
    selectParts.push(format('%I::text AS org_external_id', config.orgIdColumn));
  }

  if (config.orgDomainsColumn) {
    selectParts.push(format('%I AS org_domains', config.orgDomainsColumn));
  } else {
    selectParts.push(`NULL::text AS org_domains`);
  }

  return format('SELECT %s FROM %I.%I', selectParts.join(', '), t.schema, t.name);
}

export function buildMembershipQuery(config: OrgSchemaConfig): string {
  const m = qualified(config.membersTable);

  const orgExternalIdExpr = config.orgExternalIdColumn
    ? format('o.%I::text', config.orgExternalIdColumn)
    : format('m.%I::text', config.membershipOrgColumn);

  const roleExpr = config.membershipRoleColumn
    ? format('m.%I::text', config.membershipRoleColumn)
    : 'NULL::text';

  const o = qualified(config.orgTable);

  return format(
    'SELECT u.email AS email, u.id::text AS user_external_id, %s AS org_external_id, %s AS role FROM %I.%I m JOIN auth.users u ON u.id = m.%I JOIN %I.%I o ON o.%I = m.%I',
    orgExternalIdExpr,
    roleExpr,
    m.schema,
    m.name,
    config.membershipUserColumn,
    o.schema,
    o.name,
    config.orgIdColumn,
    config.membershipOrgColumn,
  );
}

export function buildOrphanMembershipCountQuery(config: OrgSchemaConfig): string {
  const m = qualified(config.membersTable);
  return format(
    'SELECT count(*)::int AS count FROM %I.%I m LEFT JOIN auth.users u ON u.id = m.%I WHERE u.id IS NULL',
    m.schema,
    m.name,
    config.membershipUserColumn,
  );
}
