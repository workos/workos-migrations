export interface OrgMappingRow {
    userId: string;
    orgId?: string;
    orgExternalId?: string;
    orgName?: string;
}
export interface LoadOrgMappingOptions {
    userIdColumn: string;
    quiet?: boolean;
}
/**
 * Load org mapping CSV into a lookup Map keyed by user ID.
 * The user ID column name is configurable (e.g. 'clerk_user_id', 'firebase_uid').
 */
export declare function loadOrgMapping(filePath: string, options: LoadOrgMappingOptions): Promise<Map<string, OrgMappingRow>>;
/**
 * Apply org mapping to a CSV row object.
 * When org_id is present, only org_id is used.
 * When org_id is absent, pass through org_external_id and/or org_name.
 */
export declare function applyOrgMapping(row: Record<string, string | undefined>, mapping: OrgMappingRow): void;
/**
 * Determine output CSV columns based on available mapping data.
 */
export declare function buildOutputColumns(orgMapping: Map<string, OrgMappingRow> | null, roleMapping: Map<string, string[]> | null): string[];
