import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MIGRATION_PACKAGE_CSV_HEADERS, createMigrationPackageManifest, } from '../../package/manifest.js';
import { createEmptyPackageFiles, getPackageFilePath, writeMigrationPackageManifest, writePackageJsonlRecords, } from '../../package/writer.js';
import { packageMembershipToUploadMembershipRow, packageOrganizationToUploadOrganizationRow, packageUserToUploadUserRow, } from '../../package/upload.js';
import { createCSVWriter } from '../../shared/csv-utils.js';
import * as logger from '../../shared/logger.js';
import { loadOrgMapping } from '../shared/org-mapper.js';
import { loadRoleMapping } from '../shared/role-mapper.js';
import { encodeFirebaseScryptPHC } from './scrypt.js';
import { splitDisplayName } from './transformer.js';
const USER_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.users;
const ORG_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.organizations;
const MEMBERSHIP_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.memberships;
const ROLE_DEFINITION_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.roleDefinitions;
const USER_ROLE_ASSIGNMENT_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.userRoleAssignments;
const UPLOAD_USER_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.uploadUsers;
const UPLOAD_ORG_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.uploadOrganizations;
const UPLOAD_MEMBERSHIP_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.uploadMemberships;
export async function exportFirebasePackage(options) {
    const outputDir = path.resolve(options.outputDir);
    const stats = createEmptyStats();
    await createEmptyPackageFiles(outputDir, buildHandoffNotes());
    let orgMap = null;
    if (options.orgMapping) {
        orgMap = await loadOrgMapping(options.orgMapping, {
            userIdColumn: 'firebase_uid',
            quiet: true,
        });
    }
    let roleMap = null;
    if (options.roleMapping) {
        roleMap = await loadRoleMapping(options.roleMapping, {
            userIdColumn: 'firebase_uid',
            quiet: true,
        });
    }
    const users = parseFirebaseExport(options.input);
    if (!options.quiet)
        logger.info(`Writing Firebase migration package to ${outputDir}`);
    const userWriter = createCSVWriter(getPackageFilePath(outputDir, 'users'), [...USER_HEADERS]);
    const orgWriter = createCSVWriter(getPackageFilePath(outputDir, 'organizations'), [
        ...ORG_HEADERS,
    ]);
    const membershipWriter = createCSVWriter(getPackageFilePath(outputDir, 'memberships'), [
        ...MEMBERSHIP_HEADERS,
    ]);
    const uploadUserWriter = createCSVWriter(getPackageFilePath(outputDir, 'uploadUsers'), [
        ...UPLOAD_USER_HEADERS,
    ]);
    const uploadOrgWriter = createCSVWriter(getPackageFilePath(outputDir, 'uploadOrganizations'), [
        ...UPLOAD_ORG_HEADERS,
    ]);
    const uploadMembershipWriter = createCSVWriter(getPackageFilePath(outputDir, 'uploadMemberships'), [...UPLOAD_MEMBERSHIP_HEADERS]);
    const roleDefWriter = createCSVWriter(getPackageFilePath(outputDir, 'roleDefinitions'), [
        ...ROLE_DEFINITION_HEADERS,
    ]);
    const roleAssignWriter = createCSVWriter(getPackageFilePath(outputDir, 'userRoleAssignments'), [
        ...USER_ROLE_ASSIGNMENT_HEADERS,
    ]);
    const seenUserIds = new Set();
    const seenOrgIds = new Set();
    const seenMembershipIds = new Set();
    const seenRoleSlugs = new Set();
    const seenOrgRowsWritten = new Set();
    try {
        for (const user of users) {
            const result = mapFirebaseUser(user, options, orgMap, roleMap, stats);
            if (result.skipped)
                continue;
            userWriter.write(result.userRow);
            stats.totalUsers++;
            const uploadUser = packageUserToUploadUserRow(result.userRow);
            if (uploadUser && !seenUserIds.has(uploadUser.user_id)) {
                seenUserIds.add(uploadUser.user_id);
                uploadUserWriter.write(uploadUser);
                stats.uploadUsers++;
            }
            if (result.orgInfo && (result.orgInfo.orgExternalId || result.orgInfo.orgId)) {
                const orgKey = result.orgInfo.orgExternalId ?? result.orgInfo.orgId ?? '';
                if (orgKey && !seenOrgRowsWritten.has(orgKey)) {
                    seenOrgRowsWritten.add(orgKey);
                    const orgRow = {
                        org_id: result.orgInfo.orgId ?? '',
                        org_external_id: result.orgInfo.orgExternalId ?? '',
                        org_name: result.orgInfo.orgName ?? result.orgInfo.orgExternalId ?? '',
                        domains: '',
                        metadata: '',
                    };
                    orgWriter.write(orgRow);
                    stats.totalOrgs++;
                    const uploadOrg = packageOrganizationToUploadOrganizationRow(orgRow);
                    if (uploadOrg && !seenOrgIds.has(uploadOrg.organization_id)) {
                        seenOrgIds.add(uploadOrg.organization_id);
                        uploadOrgWriter.write(uploadOrg);
                        stats.uploadOrganizations++;
                    }
                }
                const membershipRow = {
                    email: result.userRow.email,
                    external_id: result.userRow.external_id,
                    user_id: '',
                    org_id: result.orgInfo.orgId ?? '',
                    org_external_id: result.orgInfo.orgExternalId ?? '',
                    org_name: result.orgInfo.orgName ?? '',
                    role_slugs: result.roleSlugs.join(','),
                    metadata: '',
                };
                membershipWriter.write(membershipRow);
                stats.totalMemberships++;
                const uploadMembership = packageMembershipToUploadMembershipRow(membershipRow);
                if (uploadMembership) {
                    const key = `${uploadMembership.organization_id}:${uploadMembership.user_id}`;
                    if (!seenMembershipIds.has(key)) {
                        seenMembershipIds.add(key);
                        uploadMembershipWriter.write(uploadMembership);
                        stats.uploadMemberships++;
                    }
                }
            }
            for (const slug of result.roleSlugs) {
                if (!seenRoleSlugs.has(slug)) {
                    seenRoleSlugs.add(slug);
                    roleDefWriter.write({
                        role_slug: slug,
                        role_name: slug,
                        role_type: 'environment',
                        permissions: '',
                        org_id: '',
                        org_external_id: '',
                    });
                    stats.roleDefinitions++;
                }
                if (result.orgInfo) {
                    roleAssignWriter.write({
                        email: result.userRow.email,
                        user_id: '',
                        external_id: result.userRow.external_id,
                        role_slug: slug,
                        org_id: result.orgInfo.orgId ?? '',
                        org_external_id: result.orgInfo.orgExternalId ?? '',
                    });
                    stats.userRoleAssignments++;
                }
            }
        }
    }
    finally {
        await Promise.all([
            userWriter.end(),
            orgWriter.end(),
            membershipWriter.end(),
            uploadUserWriter.end(),
            uploadOrgWriter.end(),
            uploadMembershipWriter.end(),
            roleDefWriter.end(),
            roleAssignWriter.end(),
        ]);
    }
    await writePackageJsonlRecords(outputDir, 'warnings', stats.warnings);
    await writePackageJsonlRecords(outputDir, 'skippedUsers', stats.skipped);
    const manifest = createMigrationPackageManifest({
        provider: 'firebase',
        sourceTenant: options.sourceTenant,
        generatedAt: new Date(),
        entitiesRequested: ['users', 'organizations', 'memberships', 'roles'],
        entitiesExported: {
            users: stats.totalUsers,
            organizations: stats.totalOrgs,
            memberships: stats.totalMemberships,
            roleDefinitions: stats.roleDefinitions,
            userRoleAssignments: stats.userRoleAssignments,
            uploadUsers: stats.uploadUsers,
            uploadOrganizations: stats.uploadOrganizations,
            uploadMemberships: stats.uploadMemberships,
            warnings: stats.warnings.length,
            skippedUsers: stats.skipped.length,
        },
        secretsRedacted: true,
        secretRedaction: {
            mode: 'not-applicable',
            redacted: true,
            notes: ['Firebase Auth export does not include connection secrets.'],
        },
        warnings: stats.warnings.map((w) => w.message),
    });
    await writeMigrationPackageManifest(outputDir, manifest);
    if (!options.quiet) {
        logger.success('\nFirebase package export complete');
        logger.info(`  Users: ${stats.totalUsers}`);
        logger.info(`  Orgs:  ${stats.totalOrgs}`);
        logger.info(`  Memberships: ${stats.totalMemberships}`);
        if (stats.skipped.length > 0)
            logger.warn(`  Skipped: ${stats.skipped.length}`);
        if (stats.warnings.length > 0)
            logger.warn(`  Warnings: ${stats.warnings.length}`);
    }
    return stats;
}
function mapFirebaseUser(user, options, orgMap, roleMap, stats) {
    const email = user.email?.trim();
    if (!email) {
        stats.skipped.push({
            timestamp: new Date().toISOString(),
            firebase_uid: user.localId,
            reason: 'no_email',
        });
        stats.skippedUsers++;
        return {
            skipped: true,
            userRow: {},
            roleSlugs: [],
        };
    }
    if (user.disabled && !options.includeDisabled) {
        stats.skipped.push({
            timestamp: new Date().toISOString(),
            firebase_uid: user.localId,
            email,
            reason: 'disabled_user',
        });
        stats.skippedUsers++;
        return { skipped: true, userRow: {}, roleSlugs: [] };
    }
    const { firstName, lastName } = splitDisplayName(user.displayName, options.nameSplitStrategy);
    let passwordHash = '';
    let passwordHashType = '';
    if (!options.skipPasswords && user.passwordHash && user.salt) {
        if (options.scryptConfig) {
            passwordHash = encodeFirebaseScryptPHC({ passwordHash: user.passwordHash, salt: user.salt }, options.scryptConfig);
            passwordHashType = 'firebase-scrypt';
        }
        else {
            stats.warnings.push({
                timestamp: new Date().toISOString(),
                code: 'missing_scrypt_parameters',
                message: `No scrypt parameters provided for user ${user.localId}; password omitted.`,
                firebase_uid: user.localId,
                email,
            });
        }
    }
    const metadata = {};
    if (user.localId?.trim())
        metadata.firebase_uid = user.localId.trim();
    if (user.phoneNumber?.trim())
        metadata.phone_number = user.phoneNumber.trim();
    if (user.photoUrl?.trim())
        metadata.photo_url = user.photoUrl.trim();
    if (user.customAttributes?.trim()) {
        try {
            metadata.custom_attributes = JSON.parse(user.customAttributes);
        }
        catch {
            metadata.custom_attributes = user.customAttributes.trim();
        }
    }
    if (user.providerUserInfo?.length)
        metadata.provider_info = user.providerUserInfo;
    if (user.disabled && options.includeDisabled)
        metadata.disabled = true;
    const orgInfo = user.localId && orgMap ? orgMap.get(user.localId) : undefined;
    const roleSlugs = user.localId && roleMap ? (roleMap.get(user.localId) ?? []) : [];
    const userRow = {
        email,
        password: '',
        password_hash: passwordHash,
        password_hash_type: passwordHashType,
        first_name: firstName,
        last_name: lastName,
        email_verified: user.emailVerified === true ? 'true' : 'false',
        external_id: user.localId ?? '',
        metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '',
        org_id: '',
        org_external_id: orgInfo?.orgExternalId ?? '',
        org_name: orgInfo?.orgName ?? '',
        role_slugs: roleSlugs.join(','),
    };
    return { skipped: false, userRow, orgInfo, roleSlugs };
}
function parseFirebaseExport(filePath) {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.users || !Array.isArray(parsed.users)) {
        throw new Error('Firebase export must have a "users" array at the top level.');
    }
    return parsed.users;
}
function createEmptyStats() {
    return {
        totalUsers: 0,
        totalOrgs: 0,
        totalMemberships: 0,
        roleDefinitions: 0,
        userRoleAssignments: 0,
        uploadUsers: 0,
        uploadOrganizations: 0,
        uploadMemberships: 0,
        skippedUsers: 0,
        warnings: [],
        skipped: [],
    };
}
function buildHandoffNotes() {
    return [
        '# Firebase / Identity Platform handoff notes',
        '',
        'Firebase Auth JSON exports do not include SAML/OIDC connection material.',
        'For Identity Platform tenants with SAML providers, populate sso/ files',
        'manually and run validate-package before importing.',
        '',
    ].join('\n');
}
