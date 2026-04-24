import fs from 'node:fs';
import { parse } from 'csv-parse';
import { createEnvironmentRole, createOrganizationRole, createPermission, assignPermissionsToRole, listRolesForOrganization, } from './api-client.js';
// --- Role Definitions CSV Parser ---
const REQUIRED_DEFINITION_COLUMNS = ['role_slug', 'role_name', 'role_type', 'permissions'];
const VALID_ROLE_TYPES = new Set(['environment', 'organization']);
/**
 * Parse permissions string: tries JSON array first, falls back to comma-split.
 */
export function parsePermissions(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return [];
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((p) => String(p).trim()).filter(Boolean);
            }
        }
        catch {
            // Fall through to comma-split
        }
    }
    return trimmed.split(',').map(p => p.trim()).filter(Boolean);
}
/**
 * Parse role definitions from a CSV file.
 */
export async function parseRoleDefinitionsCsv(csvPath) {
    if (!fs.existsSync(csvPath)) {
        throw new Error(`Role definitions CSV not found: ${csvPath}`);
    }
    const definitions = [];
    const warnings = [];
    const errors = [];
    const seen = new Map();
    return new Promise((resolve, reject) => {
        let headerValidated = false;
        let rowNumber = 0;
        const input = fs.createReadStream(csvPath);
        const parser = parse({
            columns: true,
            skip_empty_lines: true,
            trim: true,
        });
        input
            .pipe(parser)
            .on('data', (row) => {
            rowNumber++;
            if (!headerValidated) {
                headerValidated = true;
                const headers = Object.keys(row);
                const missing = REQUIRED_DEFINITION_COLUMNS.filter(c => !headers.includes(c));
                if (missing.length > 0) {
                    reject(new Error(`Role definitions CSV missing required columns: ${missing.join(', ')}. Found: ${headers.join(', ')}`));
                    return;
                }
            }
            const typed = {
                role_slug: row.role_slug?.trim() ?? '',
                role_name: row.role_name?.trim() ?? '',
                role_type: row.role_type?.trim(),
                permissions: row.permissions ?? '',
                org_id: row.org_id?.trim() || undefined,
                org_external_id: row.org_external_id?.trim() || undefined,
            };
            if (!typed.role_slug) {
                errors.push(`Row ${rowNumber}: Missing role_slug`);
                return;
            }
            if (!typed.role_name) {
                errors.push(`Row ${rowNumber}: Missing role_name for slug "${typed.role_slug}"`);
                return;
            }
            if (!VALID_ROLE_TYPES.has(typed.role_type)) {
                warnings.push(`Row ${rowNumber}: Invalid role_type "${typed.role_type}" for slug "${typed.role_slug}" — skipping`);
                return;
            }
            if (typed.role_type === 'organization' && !typed.org_id && !typed.org_external_id) {
                warnings.push(`Row ${rowNumber}: Organization role "${typed.role_slug}" missing org_id or org_external_id — skipping`);
                return;
            }
            const dedupKey = typed.role_type === 'organization'
                ? `${typed.role_slug}:${typed.org_id || typed.org_external_id}`
                : typed.role_slug;
            const prevRow = seen.get(dedupKey);
            if (prevRow !== undefined) {
                warnings.push(`Row ${rowNumber}: Duplicate role_slug "${typed.role_slug}" (same scope as row ${prevRow}) — using first`);
                return;
            }
            seen.set(dedupKey, rowNumber);
            definitions.push({
                slug: typed.role_slug,
                name: typed.role_name,
                type: typed.role_type,
                permissions: parsePermissions(typed.permissions),
                orgId: typed.org_id,
                orgExternalId: typed.org_external_id,
            });
        })
            .on('end', () => resolve({ definitions, warnings, errors }))
            .on('error', reject);
    });
}
// --- Permission Comparison ---
function comparePermissions(csvPerms, existingPerms) {
    const csvSet = new Set(csvPerms);
    const existingSet = new Set(existingPerms);
    const missing = csvPerms.filter(p => !existingSet.has(p));
    const extra = existingPerms.filter(p => !csvSet.has(p));
    return { match: missing.length === 0 && extra.length === 0, missing, extra };
}
// --- Ensure Permissions Exist ---
async function ensurePermissionsExist(definitions, dryRun) {
    const uniquePerms = new Set();
    for (const def of definitions) {
        for (const perm of def.permissions) {
            uniquePerms.add(perm);
        }
    }
    if (uniquePerms.size === 0)
        return { created: 0, existed: 0, failed: 0 };
    let created = 0;
    let existed = 0;
    let failed = 0;
    for (const slug of Array.from(uniquePerms)) {
        if (dryRun) {
            created++;
            continue;
        }
        try {
            const name = slug
                .split(/[:._-]/)
                .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');
            const wasCreated = await createPermission({ slug, name });
            if (wasCreated)
                created++;
            else
                existed++;
        }
        catch {
            failed++;
        }
    }
    return { created, existed, failed };
}
// --- Process Role Definitions ---
/**
 * Process role definitions from CSV: create roles and assign permissions in WorkOS.
 */
export async function processRoleDefinitions(definitionsPath, options) {
    const { definitions, warnings: parseWarnings, errors: parseErrors } = await parseRoleDefinitionsCsv(definitionsPath);
    const envRoles = definitions.filter(d => d.type === 'environment');
    const orgRoles = definitions.filter(d => d.type === 'organization');
    // Ensure all permissions exist before creating roles
    await ensurePermissionsExist(definitions, options.dryRun);
    const results = [];
    const allWarnings = [...parseWarnings];
    // Cache existing roles per org to avoid repeated lookups
    const orgRoleCache = new Map();
    // Process environment roles
    for (const def of envRoles) {
        const result = await processOneRole(def, options.dryRun, orgRoleCache);
        results.push(result);
        allWarnings.push(...result.warnings);
    }
    // Process organization roles
    for (const def of orgRoles) {
        const resolvedDef = { ...def };
        if (!resolvedDef.orgId && options.orgId) {
            resolvedDef.orgId = options.orgId;
        }
        const result = await processOneRole(resolvedDef, options.dryRun, orgRoleCache);
        results.push(result);
        allWarnings.push(...result.warnings);
    }
    return {
        total: definitions.length,
        created: results.filter(r => r.action === 'created').length,
        alreadyExist: results.filter(r => r.action === 'exists').length,
        skipped: results.filter(r => r.action === 'skipped').length,
        errors: results.filter(r => r.action === 'error').length + parseErrors.length,
        warnings: allWarnings,
        results,
    };
}
async function processOneRole(def, dryRun, orgRoleCache) {
    const result = {
        slug: def.slug,
        action: 'error',
        warnings: [],
    };
    try {
        if (def.type === 'organization') {
            if (!def.orgId) {
                result.action = 'skipped';
                result.error = 'No org_id provided';
                return result;
            }
            // Warm cache for this org
            if (!orgRoleCache.has(def.orgId)) {
                try {
                    const roles = await listRolesForOrganization(def.orgId);
                    orgRoleCache.set(def.orgId, roles);
                }
                catch {
                    orgRoleCache.set(def.orgId, []);
                }
            }
            const existing = orgRoleCache.get(def.orgId).find(r => r.slug === def.slug);
            if (existing) {
                const comparison = comparePermissions(def.permissions, existing.permissions);
                if (!comparison.match) {
                    result.warnings.push(`Permission mismatch for org role "${def.slug}" in org ${def.orgId}: missing=[${comparison.missing.join(',')}] extra=[${comparison.extra.join(',')}]`);
                    result.permissionDiff = {
                        csvPermissions: def.permissions,
                        existingPermissions: existing.permissions,
                        missing: comparison.missing,
                        extra: comparison.extra,
                    };
                }
                result.action = 'exists';
                return result;
            }
            if (dryRun) {
                result.action = 'created';
                return result;
            }
            const created = await createOrganizationRole({
                organizationId: def.orgId,
                name: def.name,
                slug: def.slug,
            });
            if (def.permissions.length > 0) {
                await assignPermissionsToRole({
                    roleSlug: created.slug,
                    permissions: def.permissions,
                    organizationId: def.orgId,
                });
            }
            result.action = 'created';
        }
        else {
            // Environment role
            if (dryRun) {
                result.action = 'created';
                return result;
            }
            try {
                const created = await createEnvironmentRole({
                    name: def.name,
                    slug: def.slug,
                });
                if (def.permissions.length > 0) {
                    await assignPermissionsToRole({
                        roleSlug: created.slug,
                        permissions: def.permissions,
                    });
                }
                result.action = 'created';
            }
            catch (err) {
                const message = err?.message || '';
                const status = err?.status;
                // If role already exists (409), mark as exists
                if (status === 409 || message.includes('already exists') || message.includes('already been taken')) {
                    result.action = 'exists';
                    return result;
                }
                throw err;
            }
        }
    }
    catch (err) {
        result.action = 'error';
        result.error = err?.message || String(err);
    }
    return result;
}
/**
 * Parse user-role mapping CSV. Supports email,role_slug or user_id,role_slug columns.
 */
async function parseUserRoleMappingCsv(csvPath) {
    if (!fs.existsSync(csvPath)) {
        throw new Error(`User-role mapping CSV not found: ${csvPath}`);
    }
    const mappings = [];
    const warnings = [];
    return new Promise((resolve, reject) => {
        let headerValidated = false;
        let rowNumber = 0;
        let hasEmail = false;
        let hasUserId = false;
        const input = fs.createReadStream(csvPath);
        const parser = parse({
            columns: true,
            skip_empty_lines: true,
            trim: true,
        });
        input
            .pipe(parser)
            .on('data', (row) => {
            rowNumber++;
            if (!headerValidated) {
                headerValidated = true;
                const headers = Object.keys(row);
                hasEmail = headers.includes('email');
                hasUserId = headers.includes('user_id') || headers.includes('external_id');
                if (!hasEmail && !hasUserId) {
                    reject(new Error('User-role mapping CSV must have email, user_id, or external_id column'));
                    return;
                }
                if (!headers.includes('role_slug')) {
                    reject(new Error('User-role mapping CSV must have role_slug column'));
                    return;
                }
            }
            const roleSlug = row.role_slug?.trim();
            if (!roleSlug) {
                warnings.push(`Row ${rowNumber}: Missing role_slug — skipping`);
                return;
            }
            const email = row.email?.trim()?.toLowerCase();
            const userId = row.user_id?.trim() || row.external_id?.trim();
            if (!email && !userId) {
                warnings.push(`Row ${rowNumber}: Missing email/user_id — skipping`);
                return;
            }
            mappings.push({ email, userId, roleSlug });
        })
            .on('end', () => resolve({ mappings, warnings }))
            .on('error', reject);
    });
}
/**
 * Assign roles to users' organization memberships.
 */
export async function assignRolesToUsers(mappingPath, workos, options) {
    const { mappings, warnings } = await parseUserRoleMappingCsv(mappingPath);
    const summary = {
        totalMappings: mappings.length,
        assigned: 0,
        skipped: 0,
        failures: 0,
        userNotFound: 0,
        warnings,
    };
    for (const mapping of mappings) {
        try {
            // Resolve user ID
            let userId = mapping.userId;
            if (!userId && mapping.email) {
                const users = await workos.userManagement.listUsers({ email: mapping.email });
                if (users.data.length === 0) {
                    summary.userNotFound += 1;
                    summary.failures += 1;
                    warnings.push(`User not found: ${mapping.email}`);
                    continue;
                }
                userId = users.data[0].id;
            }
            if (!userId) {
                summary.failures += 1;
                continue;
            }
            if (options.dryRun) {
                summary.assigned += 1;
                continue;
            }
            // Look up membership for user in the target org
            const memberships = await workos.userManagement.listOrganizationMemberships({
                userId,
                organizationId: options.orgId,
            });
            if (memberships.data.length === 0) {
                summary.failures += 1;
                warnings.push(`No membership found for user ${userId} in org ${options.orgId}`);
                continue;
            }
            const membershipId = memberships.data[0].id;
            // Assign role to the membership
            await workos.userManagement.updateOrganizationMembership(membershipId, {
                roleSlugs: [mapping.roleSlug],
            });
            summary.assigned += 1;
        }
        catch (err) {
            summary.failures += 1;
            warnings.push(`Failed to assign role "${mapping.roleSlug}": ${err.message}`);
        }
    }
    return summary;
}
