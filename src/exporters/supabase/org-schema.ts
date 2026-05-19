import type { OrgSchemaConfig, QualifiedIdentifier } from '../../shared/types.js';

const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export interface OrgSchemaFlags {
  orgTable?: string;
  orgIdColumn?: string;
  orgNameColumn?: string;
  orgExternalIdColumn?: string;
  orgDomainsColumn?: string;
  membersTable?: string;
  membershipUserColumn?: string;
  membershipOrgColumn?: string;
  membershipRoleColumn?: string;
  roleSlugMapPath?: string;
}

const REQUIRED_FLAGS = [
  'orgTable',
  'orgIdColumn',
  'orgNameColumn',
  'membersTable',
  'membershipUserColumn',
  'membershipOrgColumn',
] as const satisfies readonly (keyof OrgSchemaFlags)[];

export function parseQualifiedIdentifier(input: string): QualifiedIdentifier {
  const parts = input.split('.');
  if (parts.length === 1) {
    assertSafeIdentifier(parts[0], input);
    return { name: parts[0] };
  }
  if (parts.length === 2) {
    assertSafeIdentifier(parts[0], input);
    assertSafeIdentifier(parts[1], input);
    return { schema: parts[0], name: parts[1] };
  }
  throw new Error(`Invalid identifier: ${input}`);
}

export function assertSafeIdentifier(value: string, context: string): void {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`Invalid identifier: ${context}`);
  }
}

/**
 * Validate the group of org/membership CLI flags. Returns null when none of the
 * required-group flags are present (org export not requested). Throws when any
 * but not all required flags are supplied.
 */
export function validateOrgSchemaFlags(flags: OrgSchemaFlags): OrgSchemaConfig | null {
  const supplied = REQUIRED_FLAGS.filter((key) => flags[key] !== undefined && flags[key] !== '');
  if (supplied.length === 0) return null;
  if (supplied.length < REQUIRED_FLAGS.length) {
    const missing = REQUIRED_FLAGS.filter((key) => !supplied.includes(key));
    throw new Error(
      `Incomplete org schema flags. Required flags must all be provided together: ${REQUIRED_FLAGS.join(', ')}. Missing: ${missing.join(', ')}`,
    );
  }

  const config: OrgSchemaConfig = {
    orgTable: parseQualifiedIdentifier(flags.orgTable!),
    orgIdColumn: validateColumn(flags.orgIdColumn!, '--org-id-column'),
    orgNameColumn: validateColumn(flags.orgNameColumn!, '--org-name-column'),
    membersTable: parseQualifiedIdentifier(flags.membersTable!),
    membershipUserColumn: validateColumn(flags.membershipUserColumn!, '--membership-user-column'),
    membershipOrgColumn: validateColumn(flags.membershipOrgColumn!, '--membership-org-column'),
  };

  if (flags.orgExternalIdColumn) {
    config.orgExternalIdColumn = validateColumn(
      flags.orgExternalIdColumn,
      '--org-external-id-column',
    );
  }
  if (flags.orgDomainsColumn) {
    config.orgDomainsColumn = validateColumn(flags.orgDomainsColumn, '--org-domains-column');
  }
  if (flags.membershipRoleColumn) {
    config.membershipRoleColumn = validateColumn(
      flags.membershipRoleColumn,
      '--membership-role-column',
    );
  }
  if (flags.roleSlugMapPath) {
    config.roleSlugMapPath = flags.roleSlugMapPath;
  }

  return config;
}

function validateColumn(value: string, flagName: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`Invalid identifier for ${flagName}: ${value}`);
  }
  return value;
}
