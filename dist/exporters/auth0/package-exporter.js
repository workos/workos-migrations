import path from 'node:path';
import { MIGRATION_PACKAGE_CSV_HEADERS, createMigrationPackageManifest, } from '../../package/manifest.js';
import { createEmptyPackageFiles, getPackageFilePath, writeMigrationPackageManifest, writePackageJsonlRecords, } from '../../package/writer.js';
import { createCSVWriter } from '../../shared/csv-utils.js';
import * as logger from '../../shared/logger.js';
import { Auth0Client } from './client.js';
import { extractOrgFromMetadata, isFederatedAuth0User, mapAuth0UserToWorkOS } from './mapper.js';
const USER_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.users;
const ORG_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.organizations;
const MEMBERSHIP_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.memberships;
export async function exportAuth0Package(options) {
    const client = new Auth0Client({
        domain: options.domain,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        rateLimit: options.rateLimit,
    });
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
    return exportAuth0PackageWithClient(client, options);
}
export async function exportAuth0PackageWithClient(client, options) {
    const startTime = Date.now();
    const outputDir = options.outputDir ?? options.output;
    if (!outputDir) {
        throw new Error('--output-dir is required when using --package');
    }
    const resolvedOutputDir = path.resolve(outputDir);
    await createEmptyPackageFiles(resolvedOutputDir, buildHandoffNotes());
    if (!options.quiet) {
        logger.info(`Writing Auth0 migration package to ${resolvedOutputDir}`);
    }
    const stats = options.useMetadata
        ? await exportPackageUsersWithMetadata(client, resolvedOutputDir, options)
        : await exportPackageOrganizations(client, resolvedOutputDir, options);
    await writePackageJsonlRecords(resolvedOutputDir, 'warnings', stats.warnings);
    await writePackageJsonlRecords(resolvedOutputDir, 'skippedUsers', stats.skipped);
    const manifest = createMigrationPackageManifest({
        provider: 'auth0',
        sourceTenant: options.domain,
        generatedAt: new Date(),
        entitiesRequested: ['users', 'organizations', 'memberships'],
        entitiesExported: {
            users: stats.totalUsers,
            organizations: stats.totalOrgs,
            memberships: stats.totalMemberships,
            warnings: stats.warnings.length,
            skippedUsers: stats.skipped.length,
        },
        secretsRedacted: true,
        secretRedaction: {
            mode: 'not-applicable',
            redacted: true,
            notes: ['Auth0 package core does not export connection secrets or password hashes.'],
        },
        warnings: stats.warnings.map((warning) => warning.message),
    });
    await writeMigrationPackageManifest(resolvedOutputDir, manifest);
    const duration = Date.now() - startTime;
    if (!options.quiet) {
        logger.success('\nPackage export complete');
        logger.info(`  Organizations: ${stats.totalOrgs}`);
        logger.info(`  Memberships: ${stats.totalMemberships}`);
        logger.info(`  User rows exported: ${stats.totalUsers}`);
        if (stats.skippedUsers > 0) {
            logger.warn(`  Users skipped: ${stats.skippedUsers}`);
        }
        if (stats.warnings.length > 0) {
            logger.warn(`  Warnings: ${stats.warnings.length}`);
        }
        logger.info(`  Duration: ${(duration / 1000).toFixed(1)}s`);
        logger.info(`  Output directory: ${resolvedOutputDir}`);
    }
    return {
        totalUsers: stats.totalUsers,
        totalOrgs: stats.totalOrgs,
        skippedUsers: stats.skippedUsers,
        duration,
    };
}
async function exportPackageOrganizations(client, outputDir, options) {
    const fetchedOrganizations = await fetchAllOrganizations(client, options.pageSize);
    const organizations = options.orgs
        ? fetchedOrganizations.filter((org) => options.orgs?.includes(org.id))
        : fetchedOrganizations;
    if (!options.quiet) {
        logger.info(`Found ${organizations.length} organization(s)`);
    }
    const orgWriter = createCSVWriter(getPackageFilePath(outputDir, 'organizations'), [
        ...ORG_HEADERS,
    ]);
    const userWriter = createCSVWriter(getPackageFilePath(outputDir, 'users'), [...USER_HEADERS]);
    const membershipWriter = createCSVWriter(getPackageFilePath(outputDir, 'memberships'), [
        ...MEMBERSHIP_HEADERS,
    ]);
    const stats = {
        totalUsers: 0,
        totalOrgs: organizations.length,
        totalMemberships: 0,
        skippedUsers: 0,
        warnings: [],
        skipped: [],
    };
    try {
        for (const org of organizations) {
            orgWriter.write(toOrganizationRow(org));
            await exportOneOrganizationMembers(client, org, userWriter, membershipWriter, options, stats);
        }
    }
    finally {
        await Promise.all([orgWriter.end(), userWriter.end(), membershipWriter.end()]);
    }
    return stats;
}
async function exportOneOrganizationMembers(client, org, userWriter, membershipWriter, options, stats) {
    let orgUserCount = 0;
    let orgSkippedCount = 0;
    let page = 0;
    let hasMore = true;
    try {
        while (hasMore) {
            const members = await client.getOrganizationMembers(org.id, page, options.pageSize);
            if (members.length === 0)
                break;
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
                        addSkipped(stats, undefined, undefined, org, 'fetch_failed', String(result.reason));
                        orgSkippedCount++;
                        continue;
                    }
                    const user = result.value;
                    const exportResult = writePackageUserAndMembership(user, org, userWriter, membershipWriter, options, stats);
                    if (exportResult === 'exported') {
                        orgUserCount++;
                    }
                    else {
                        orgSkippedCount++;
                    }
                }
            }
            hasMore = members.length >= options.pageSize;
            page++;
        }
    }
    catch (error) {
        addWarning(stats, 'org_export_failed', `Failed to export org ${org.name}: ${error.message}`, org);
    }
    if (!options.quiet) {
        logger.info(`  ${org.display_name || org.name}: ${orgUserCount} user row(s)${orgSkippedCount > 0 ? ` (${orgSkippedCount} skipped)` : ''}`);
    }
}
async function exportPackageUsersWithMetadata(client, outputDir, options) {
    const orgWriter = createCSVWriter(getPackageFilePath(outputDir, 'organizations'), [
        ...ORG_HEADERS,
    ]);
    const userWriter = createCSVWriter(getPackageFilePath(outputDir, 'users'), [...USER_HEADERS]);
    const membershipWriter = createCSVWriter(getPackageFilePath(outputDir, 'memberships'), [
        ...MEMBERSHIP_HEADERS,
    ]);
    const stats = {
        totalUsers: 0,
        totalOrgs: 0,
        totalMemberships: 0,
        skippedUsers: 0,
        warnings: [],
        skipped: [],
    };
    const seenOrgs = new Set();
    if (!options.quiet) {
        logger.info('Using metadata-based org discovery');
    }
    try {
        let page = 0;
        let hasMore = true;
        while (hasMore) {
            const users = await client.getUsers(page, options.pageSize);
            if (users.length === 0)
                break;
            for (const user of users) {
                const orgInfo = extractOrgFromMetadata(user, options.metadataOrgIdField, options.metadataOrgNameField);
                if (!orgInfo || !orgInfo.orgId) {
                    addSkipped(stats, user.user_id, user.email, undefined, 'no_org_in_metadata');
                    continue;
                }
                if (options.orgs && !options.orgs.includes(orgInfo.orgId)) {
                    continue;
                }
                const org = {
                    id: orgInfo.orgId,
                    name: orgInfo.orgName || orgInfo.orgId,
                    display_name: orgInfo.orgName,
                };
                if (!seenOrgs.has(org.id)) {
                    seenOrgs.add(org.id);
                    orgWriter.write(toOrganizationRow(org));
                    stats.totalOrgs++;
                }
                writePackageUserAndMembership(user, org, userWriter, membershipWriter, options, stats);
            }
            hasMore = users.length >= options.pageSize;
            page++;
            if (!options.quiet && stats.totalUsers % 100 === 0 && stats.totalUsers > 0) {
                logger.info(`  Processed ${stats.totalUsers} user row(s) (${seenOrgs.size} orgs found)...`);
            }
        }
    }
    finally {
        await Promise.all([orgWriter.end(), userWriter.end(), membershipWriter.end()]);
    }
    return stats;
}
function writePackageUserAndMembership(user, org, userWriter, membershipWriter, options, stats) {
    if (!user || !user.email) {
        addSkipped(stats, user?.user_id, user?.email, org, 'no_email');
        return 'skipped';
    }
    if (!options.includeFederatedUsers && isFederatedAuth0User(user)) {
        addSkipped(stats, user.user_id, user.email, org, 'federated_user');
        return 'skipped';
    }
    if (!org) {
        addSkipped(stats, user.user_id, user.email, undefined, 'no_org');
        return 'skipped';
    }
    const row = mapAuth0UserToWorkOS(user, org);
    userWriter.write(normalizeCsvRow(row, USER_HEADERS));
    membershipWriter.write(toMembershipRow(user, org, row));
    stats.totalUsers++;
    stats.totalMemberships++;
    if (user.blocked === true) {
        addWarning(stats, 'blocked_user_metadata_only', `Blocked Auth0 user ${user.user_id} was exported without credentials.`, org, user.user_id);
    }
    return 'exported';
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
function toOrganizationRow(org) {
    return {
        org_id: '',
        org_external_id: org.id,
        org_name: org.display_name || org.name,
        domains: extractDomains(org.metadata).join(','),
        metadata: org.metadata ? JSON.stringify(org.metadata) : '',
    };
}
function toMembershipRow(user, org, row) {
    return {
        email: user.email ?? '',
        external_id: user.user_id,
        user_id: '',
        org_id: '',
        org_external_id: org.id,
        org_name: org.display_name || org.name,
        role_slugs: String(row.role_slugs ?? ''),
        metadata: '',
    };
}
function normalizeCsvRow(row, headers) {
    const normalized = {};
    for (const header of headers) {
        const value = row[header];
        if (value === undefined || value === null) {
            normalized[header] = '';
        }
        else if (typeof value === 'boolean') {
            normalized[header] = value ? 'true' : 'false';
        }
        else {
            normalized[header] = String(value);
        }
    }
    return normalized;
}
function addSkipped(stats, userId, email, org, reason, error) {
    stats.skippedUsers++;
    stats.skipped.push({
        timestamp: new Date().toISOString(),
        user_id: userId ?? 'unknown',
        email: email ?? 'unknown',
        org_id: org?.id ?? 'unknown',
        org_name: org?.display_name || org?.name || 'unknown',
        reason,
        ...(error ? { error } : {}),
    });
}
function addWarning(stats, code, message, org, userId) {
    stats.warnings.push({
        timestamp: new Date().toISOString(),
        code,
        message,
        ...(org ? { org_id: org.id, org_name: org.display_name || org.name } : {}),
        ...(userId ? { user_id: userId } : {}),
    });
}
function extractDomains(metadata) {
    const raw = metadata?.domains ?? metadata?.domain;
    if (!raw)
        return [];
    if (Array.isArray(raw))
        return raw.map(String).filter(Boolean);
    if (typeof raw === 'string') {
        return raw
            .split(/[;,]/)
            .map((domain) => domain.trim())
            .filter(Boolean);
    }
    return [];
}
function buildHandoffNotes() {
    return [
        '# Auth0 SSO handoff notes',
        '',
        'This package was generated by Auth0 package core and does not include SAML/OIDC connection handoff files yet.',
        'Run the Auth0 SSO handoff export phase when connection export support is enabled.',
        '',
    ].join('\n');
}
