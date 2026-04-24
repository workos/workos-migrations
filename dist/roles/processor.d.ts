import type { WorkOS } from '@workos-inc/node';
import type { ParsedRoleDefinition, RoleDefinitionsSummary, RoleAssignmentSummary } from '../shared/types.js';
/**
 * Parse permissions string: tries JSON array first, falls back to comma-split.
 */
export declare function parsePermissions(raw: string): string[];
/**
 * Parse role definitions from a CSV file.
 */
export declare function parseRoleDefinitionsCsv(csvPath: string): Promise<{
    definitions: ParsedRoleDefinition[];
    warnings: string[];
    errors: string[];
}>;
/**
 * Process role definitions from CSV: create roles and assign permissions in WorkOS.
 */
export declare function processRoleDefinitions(definitionsPath: string, options: {
    orgId?: string;
    dryRun: boolean;
}): Promise<RoleDefinitionsSummary>;
/**
 * Assign roles to users' organization memberships.
 */
export declare function assignRolesToUsers(mappingPath: string, workos: WorkOS, options: {
    orgId: string;
    dryRun: boolean;
}): Promise<RoleAssignmentSummary>;
