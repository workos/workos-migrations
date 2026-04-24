export interface LoadRoleMappingOptions {
    userIdColumn: string;
    quiet?: boolean;
}
/**
 * Load role mapping CSV into a lookup Map keyed by user ID.
 * The user ID column name is configurable (e.g. 'clerk_user_id', 'firebase_uid').
 * Returns a map of user_id -> [role_slugs] (supports multi-role per user).
 */
export declare function loadRoleMapping(filePath: string, options: LoadRoleMappingOptions): Promise<Map<string, string[]>>;
