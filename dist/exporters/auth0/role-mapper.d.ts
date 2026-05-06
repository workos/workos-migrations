import type { Auth0Role } from '../../shared/types.js';
export interface NormalizedAuth0Role {
    source: Auth0Role;
    slug: string;
    name: string;
    description?: string;
    /** True when the slug was synthesized because the source name was empty. */
    synthesized: boolean;
    /** True when a numeric suffix was appended to avoid colliding with another role slug. */
    collisionSuffixed: boolean;
}
export interface NormalizeAuth0RolesResult {
    roles: NormalizedAuth0Role[];
    warnings: NormalizedRoleWarning[];
    /** Lookup from Auth0 role id → normalized slug. */
    slugByRoleId: Map<string, string>;
}
export interface NormalizedRoleWarning {
    code: 'unmappable_role_name' | 'duplicate_role_slug' | 'duplicate_role_id' | 'unknown_role_assignment';
    message: string;
    role_id?: string;
    role_name?: string;
    slug?: string;
}
/**
 * Convert an Auth0 role name into a stable kebab-case slug. Returns an empty
 * string when the name has no slug-able characters so callers can decide
 * whether to synthesize a fallback.
 */
export declare function normalizeRoleSlug(input: string | undefined | null): string;
export declare function normalizeAuth0Roles(roles: Auth0Role[]): NormalizeAuth0RolesResult;
export interface RoleAssignmentInput {
    email?: string;
    externalId: string;
    orgExternalId: string;
    /** Auth0 role objects returned for the user/org pair. */
    roles: Auth0Role[];
}
export interface RoleAssignmentRow {
    email: string;
    user_id: string;
    external_id: string;
    role_slug: string;
    org_id: string;
    org_external_id: string;
}
export interface BuildRoleAssignmentRowsResult {
    rows: RoleAssignmentRow[];
    slugs: string[];
    warnings: NormalizedRoleWarning[];
}
/**
 * Convert an Auth0 member's role list into normalized assignment rows and the
 * deduplicated slug list to merge into the user/membership rows.
 */
export declare function buildRoleAssignmentRows(input: RoleAssignmentInput, slugByRoleId: Map<string, string>): BuildRoleAssignmentRowsResult;
