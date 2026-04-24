export interface Role {
    id: string;
    slug: string;
    name: string;
    description?: string;
    type: 'EnvironmentRole' | 'OrganizationRole';
    permissions: string[];
}
/**
 * List all roles for an organization (environment + org-specific).
 */
export declare function listRolesForOrganization(organizationId: string): Promise<Role[]>;
/**
 * Create an environment-level role.
 */
export declare function createEnvironmentRole(options: {
    name: string;
    slug: string;
    description?: string;
}): Promise<Role>;
/**
 * Create an organization-level role.
 */
export declare function createOrganizationRole(options: {
    organizationId: string;
    name: string;
    slug: string;
    description?: string;
}): Promise<Role>;
/**
 * Create a permission. Returns true if created, false if already exists.
 */
export declare function createPermission(options: {
    slug: string;
    name: string;
    description?: string;
}): Promise<boolean>;
/**
 * Set permissions on an environment role (replaces existing).
 */
export declare function assignPermissionsToRole(options: {
    roleSlug: string;
    permissions: string[];
    organizationId?: string;
}): Promise<void>;
