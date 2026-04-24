import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import * as logger from '../../shared/logger.js';
/**
 * Load org mapping CSV into a lookup Map keyed by user ID.
 * The user ID column name is configurable (e.g. 'clerk_user_id', 'firebase_uid').
 */
export async function loadOrgMapping(filePath, options) {
    const { userIdColumn, quiet } = options;
    const lookup = new Map();
    return new Promise((resolve, reject) => {
        let headerValidated = false;
        let duplicateCount = 0;
        const inputStream = createReadStream(filePath);
        const parser = parse({
            columns: true,
            skip_empty_lines: true,
            trim: true,
        });
        inputStream
            .pipe(parser)
            .on('data', (row) => {
            if (!headerValidated) {
                headerValidated = true;
                const headers = Object.keys(row);
                if (!headers.includes(userIdColumn)) {
                    reject(new Error(`Org mapping CSV must have a '${userIdColumn}' column. ` +
                        `Found columns: ${headers.join(', ')}`));
                    return;
                }
                const hasOrgColumn = headers.includes('org_id') ||
                    headers.includes('org_external_id') ||
                    headers.includes('org_name');
                if (!hasOrgColumn) {
                    reject(new Error(`Org mapping CSV must have at least one of: org_id, org_external_id, org_name. ` +
                        `Found columns: ${headers.join(', ')}`));
                    return;
                }
                if (!quiet) {
                    const mode = detectOrgMappingMode(headers);
                    logger.info(`  Org mapping mode: ${mode}`);
                }
            }
            const userId = row[userIdColumn]?.trim();
            if (!userId)
                return;
            if (lookup.has(userId)) {
                duplicateCount++;
            }
            lookup.set(userId, {
                userId,
                orgId: row.org_id?.trim() || undefined,
                orgExternalId: row.org_external_id?.trim() || undefined,
                orgName: row.org_name?.trim() || undefined,
            });
        })
            .on('end', () => {
            if (duplicateCount > 0 && !quiet) {
                logger.warn(`  Warning: ${duplicateCount} duplicate ${userIdColumn}(s) found in org mapping — using last occurrence`);
            }
            resolve(lookup);
        })
            .on('error', reject);
    });
}
function detectOrgMappingMode(headers) {
    const hasOrgId = headers.includes('org_id');
    const hasOrgExternalId = headers.includes('org_external_id');
    const hasOrgName = headers.includes('org_name');
    if (hasOrgId)
        return 'org_id (direct WorkOS org lookup)';
    if (hasOrgExternalId && hasOrgName)
        return 'org_external_id + org_name (create if missing)';
    if (hasOrgExternalId)
        return 'org_external_id (lookup by external ID)';
    if (hasOrgName)
        return 'org_name (lookup or create by name)';
    return 'unknown';
}
/**
 * Apply org mapping to a CSV row object.
 * When org_id is present, only org_id is used.
 * When org_id is absent, pass through org_external_id and/or org_name.
 */
export function applyOrgMapping(row, mapping) {
    if (mapping.orgId) {
        row.org_id = mapping.orgId;
    }
    else {
        if (mapping.orgExternalId) {
            row.org_external_id = mapping.orgExternalId;
        }
        if (mapping.orgName) {
            row.org_name = mapping.orgName;
        }
    }
}
/**
 * Determine output CSV columns based on available mapping data.
 */
export function buildOutputColumns(orgMapping, roleMapping) {
    const columns = [
        'email',
        'first_name',
        'last_name',
        'email_verified',
        'external_id',
        'password_hash',
        'password_hash_type',
        'metadata',
    ];
    if (orgMapping && orgMapping.size > 0) {
        const firstEntry = orgMapping.values().next().value;
        if (firstEntry) {
            if (firstEntry.orgId !== undefined)
                columns.push('org_id');
            if (firstEntry.orgExternalId !== undefined)
                columns.push('org_external_id');
            if (firstEntry.orgName !== undefined)
                columns.push('org_name');
        }
    }
    if (roleMapping && roleMapping.size > 0) {
        columns.push('role_slugs');
    }
    return columns;
}
