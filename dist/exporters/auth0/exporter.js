import { createWriteStream } from 'node:fs';
import { Auth0Client } from './client.js';
import { mapAuth0UserToWorkOS, validateMappedRow, extractOrgFromMetadata } from './mapper.js';
import { exportAuth0Package } from './package-exporter.js';
import * as logger from '../../shared/logger.js';
const CSV_COLUMNS = [
    'email',
    'first_name',
    'last_name',
    'email_verified',
    'external_id',
    'org_external_id',
    'org_name',
    'metadata',
];
export async function exportAuth0(options) {
    if (options.package) {
        return exportAuth0Package(options);
    }
    if (!options.output) {
        throw new Error('--output is required unless --package is set');
    }
    const client = new Auth0Client({
        domain: options.domain,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        rateLimit: options.rateLimit,
    });
    // Validate connection
    if (!options.quiet) {
        logger.info('Connecting to Auth0...');
    }
    const connectionTest = await client.testConnection();
    if (!connectionTest.success) {
        throw new Error(`Auth0 connection failed: ${connectionTest.error}`);
    }
    if (!options.quiet) {
        logger.success('Connected to Auth0');
    }
    return exportAuth0CsvWithClient(client, options);
}
export async function exportAuth0CsvWithClient(client, options) {
    if (!options.output) {
        throw new Error('--output is required unless --package is set');
    }
    const startTime = Date.now();
    const warnings = [];
    let totalUsers = 0;
    let totalOrgs = 0;
    let skippedUsers = 0;
    // Open output streams
    const output = options.output;
    const writeStream = createWriteStream(output, { encoding: 'utf-8' });
    const skippedPath = output.replace('.csv', '-skipped.jsonl');
    const skippedStream = createWriteStream(skippedPath, { encoding: 'utf-8' });
    try {
        // Write CSV header
        writeStream.write(CSV_COLUMNS.join(',') + '\n');
        if (options.useMetadata) {
            const stats = await exportUsersWithMetadata(client, writeStream, skippedStream, options, warnings);
            totalUsers = stats.totalUsers;
            totalOrgs = stats.totalOrgs;
            skippedUsers = stats.skippedUsers;
        }
        else {
            const stats = await exportOrganizations(client, writeStream, skippedStream, options, warnings);
            totalUsers = stats.totalUsers;
            totalOrgs = stats.totalOrgs;
            skippedUsers = stats.skippedUsers;
        }
        await closeStream(writeStream);
        await closeStream(skippedStream);
        const duration = Date.now() - startTime;
        if (!options.quiet) {
            logger.success(`\nExport complete`);
            logger.info(`  Organizations: ${totalOrgs}`);
            logger.info(`  Users exported: ${totalUsers}`);
            if (skippedUsers > 0) {
                logger.warn(`  Users skipped: ${skippedUsers} (see ${skippedPath})`);
            }
            logger.info(`  Duration: ${(duration / 1000).toFixed(1)}s`);
            logger.info(`  Output: ${output}`);
        }
        return { totalUsers, totalOrgs, skippedUsers, duration };
    }
    catch (error) {
        writeStream.end();
        skippedStream.end();
        throw error;
    }
}
async function exportOrganizations(client, writeStream, skippedStream, options, warnings) {
    let totalUsers = 0;
    let totalOrgs = 0;
    let skippedUsers = 0;
    // Fetch all organizations
    const organizations = await fetchAllOrganizations(client, options.pageSize);
    totalOrgs = organizations.length;
    if (!options.quiet) {
        logger.info(`Found ${totalOrgs} organizations`);
    }
    for (const org of organizations) {
        // Filter by org IDs if specified
        if (options.orgs && !options.orgs.includes(org.id)) {
            continue;
        }
        let orgUserCount = 0;
        let orgSkippedCount = 0;
        let page = 0;
        let hasMore = true;
        try {
            while (hasMore) {
                const members = await client.getOrganizationMembers(org.id, page, options.pageSize);
                if (members.length === 0)
                    break;
                // Fetch full user details in parallel batches
                const batchSize = options.userFetchConcurrency;
                for (let i = 0; i < members.length; i += batchSize) {
                    const batch = members.slice(i, i + batchSize);
                    const results = await Promise.allSettled(batch.map(async (member) => {
                        if (!member.user_id)
                            return null;
                        return client.getUser(member.user_id);
                    }));
                    for (const result of results) {
                        if (result.status === 'rejected') {
                            logSkipped(skippedStream, undefined, undefined, org.id, org.name, 'fetch_failed', String(result.reason));
                            orgSkippedCount++;
                            continue;
                        }
                        const user = result.value;
                        if (!user || !user.email) {
                            logSkipped(skippedStream, user?.user_id, undefined, org.id, org.name, 'no_email');
                            orgSkippedCount++;
                            continue;
                        }
                        const csvRow = mapAuth0UserToWorkOS(user, org);
                        const validationError = validateMappedRow(csvRow);
                        if (validationError) {
                            logSkipped(skippedStream, user.user_id, user.email, org.id, org.name, 'validation_failed', validationError);
                            orgSkippedCount++;
                            continue;
                        }
                        writeCsvRow(writeStream, csvRow);
                        orgUserCount++;
                        totalUsers++;
                    }
                }
                hasMore = members.length >= options.pageSize;
                page++;
            }
            skippedUsers += orgSkippedCount;
            if (!options.quiet) {
                logger.info(`  ${org.display_name || org.name}: ${orgUserCount} users${orgSkippedCount > 0 ? ` (${orgSkippedCount} skipped)` : ''}`);
            }
        }
        catch (error) {
            const msg = error.message;
            warnings.push(`Failed to export org ${org.name}: ${msg}`);
            if (!options.quiet) {
                logger.error(`  ${org.name}: FAILED — ${msg}`);
            }
        }
    }
    return { totalUsers, totalOrgs, skippedUsers };
}
async function exportUsersWithMetadata(client, writeStream, skippedStream, options, _warnings) {
    let totalUsers = 0;
    let skippedUsers = 0;
    const orgSet = new Set();
    if (!options.quiet) {
        logger.info('Using metadata-based org discovery');
    }
    let page = 0;
    let hasMore = true;
    while (hasMore) {
        const users = await client.getUsers(page, options.pageSize);
        if (users.length === 0)
            break;
        for (const user of users) {
            const orgInfo = extractOrgFromMetadata(user, options.metadataOrgIdField, options.metadataOrgNameField);
            if (!orgInfo || !orgInfo.orgId) {
                logSkipped(skippedStream, user.user_id, user.email, undefined, undefined, 'no_org_in_metadata');
                skippedUsers++;
                continue;
            }
            if (options.orgs && !options.orgs.includes(orgInfo.orgId)) {
                continue;
            }
            orgSet.add(orgInfo.orgId);
            const mockOrg = {
                id: orgInfo.orgId,
                name: orgInfo.orgName || orgInfo.orgId,
                display_name: orgInfo.orgName,
            };
            const csvRow = mapAuth0UserToWorkOS(user, mockOrg);
            const validationError = validateMappedRow(csvRow);
            if (validationError) {
                logSkipped(skippedStream, user.user_id, user.email, orgInfo.orgId, orgInfo.orgName, 'validation_failed', validationError);
                skippedUsers++;
                continue;
            }
            writeCsvRow(writeStream, csvRow);
            totalUsers++;
        }
        hasMore = users.length >= options.pageSize;
        page++;
        if (!options.quiet && totalUsers % 100 === 0 && totalUsers > 0) {
            logger.info(`  Processed ${totalUsers} users (${orgSet.size} orgs found)...`);
        }
    }
    return { totalUsers, totalOrgs: orgSet.size, skippedUsers };
}
async function fetchAllOrganizations(client, pageSize) {
    const allOrgs = [];
    let page = 0;
    let hasMore = true;
    while (hasMore) {
        const orgs = await client.getOrganizations(page, pageSize);
        if (orgs.length === 0)
            break;
        allOrgs.push(...orgs);
        hasMore = orgs.length >= pageSize;
        page++;
    }
    return allOrgs;
}
function writeCsvRow(stream, row) {
    const values = CSV_COLUMNS.map((col) => {
        const value = row[col];
        if (value === undefined || value === null)
            return '';
        if (typeof value === 'boolean')
            return value ? 'true' : 'false';
        const strValue = String(value);
        if (/[,"\n\r]/.test(strValue)) {
            return `"${strValue.replace(/"/g, '""')}"`;
        }
        return strValue;
    });
    stream.write(values.join(',') + '\n');
}
function logSkipped(stream, userId, email, orgId, orgName, reason, error) {
    stream.write(JSON.stringify({
        timestamp: new Date().toISOString(),
        user_id: userId ?? 'unknown',
        email: email ?? 'unknown',
        org_id: orgId ?? 'unknown',
        org_name: orgName ?? 'unknown',
        reason,
        error,
    }) + '\n');
}
function closeStream(stream) {
    return new Promise((resolve, reject) => {
        stream.end((err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
    });
}
