import { withRetry, isRateLimitError } from '../shared/rate-limiter.js';
const WORKOS_BASE_URL = 'https://api.workos.com';
function getApiKey() {
    const key = process.env.WORKOS_SECRET_KEY;
    if (!key) {
        throw new Error('WORKOS_SECRET_KEY environment variable is required');
    }
    return key;
}
/**
 * List all roles for an organization (environment + org-specific).
 */
export async function listRolesForOrganization(organizationId) {
    const apiKey = getApiKey();
    const roles = [];
    let after;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const params = new URLSearchParams({ limit: '100' });
        if (after)
            params.set('after', after);
        const response = await fetch(`${WORKOS_BASE_URL}/organizations/${organizationId}/roles?${params}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Failed to list roles for org ${organizationId}: ${response.status} ${body}`);
        }
        const json = (await response.json());
        for (const role of json.data) {
            roles.push({
                id: role.id,
                slug: role.slug,
                name: role.name,
                description: role.description,
                type: role.type,
                permissions: role.permissions ?? [],
            });
        }
        if (!json.list_metadata?.after)
            break;
        after = json.list_metadata.after;
    }
    return roles;
}
/**
 * Create an environment-level role.
 */
export async function createEnvironmentRole(options) {
    return withRetry(async () => {
        const apiKey = getApiKey();
        const body = {
            name: options.name,
            slug: options.slug,
        };
        if (options.description)
            body.description = options.description;
        const response = await fetch(`${WORKOS_BASE_URL}/authorization/roles`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            const err = new Error(`Failed to create environment role "${options.slug}": ${response.status} ${errorBody}`);
            err.status = response.status;
            throw err;
        }
        const data = (await response.json());
        return {
            id: data.id,
            slug: data.slug,
            name: data.name,
            description: data.description,
            type: 'EnvironmentRole',
            permissions: data.permissions ?? [],
        };
    }, { retryOn: isRateLimitError });
}
/**
 * Create an organization-level role.
 */
export async function createOrganizationRole(options) {
    return withRetry(async () => {
        const apiKey = getApiKey();
        const body = {
            name: options.name,
            slug: options.slug,
        };
        if (options.description)
            body.description = options.description;
        const response = await fetch(`${WORKOS_BASE_URL}/authorization/organizations/${options.organizationId}/roles`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            const err = new Error(`Failed to create org role "${options.slug}" for org ${options.organizationId}: ${response.status} ${errorBody}`);
            err.status = response.status;
            throw err;
        }
        const data = (await response.json());
        return {
            id: data.id,
            slug: data.slug,
            name: data.name,
            description: data.description,
            type: 'OrganizationRole',
            permissions: data.permissions ?? [],
        };
    }, { retryOn: isRateLimitError });
}
/**
 * Create a permission. Returns true if created, false if already exists.
 */
export async function createPermission(options) {
    return withRetry(async () => {
        const apiKey = getApiKey();
        const body = {
            slug: options.slug,
            name: options.name,
        };
        if (options.description)
            body.description = options.description;
        const response = await fetch(`${WORKOS_BASE_URL}/authorization/permissions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            if (response.status === 409 || errorBody.includes('already exists') || errorBody.includes('already been taken')) {
                return false;
            }
            const err = new Error(`Failed to create permission "${options.slug}": ${response.status} ${errorBody}`);
            err.status = response.status;
            throw err;
        }
        return true;
    }, { retryOn: isRateLimitError });
}
/**
 * Set permissions on an environment role (replaces existing).
 */
export async function assignPermissionsToRole(options) {
    return withRetry(async () => {
        const apiKey = getApiKey();
        const url = options.organizationId
            ? `${WORKOS_BASE_URL}/authorization/organizations/${options.organizationId}/roles/${options.roleSlug}/permissions`
            : `${WORKOS_BASE_URL}/authorization/roles/${options.roleSlug}/permissions`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ permissions: options.permissions }),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            const scope = options.organizationId ? `org role in ${options.organizationId}` : 'environment role';
            const err = new Error(`Failed to assign permissions to ${scope} "${options.roleSlug}": ${response.status} ${errorBody}`);
            err.status = response.status;
            throw err;
        }
    }, { retryOn: isRateLimitError });
}
