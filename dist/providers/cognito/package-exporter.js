import fs from 'node:fs/promises';
import path from 'node:path';
import { MIGRATION_PACKAGE_CSV_HEADERS, createMigrationPackageManifest, } from '../../package/manifest.js';
import { createEmptyPackageFiles, getPackageFilePath, writeMigrationPackageManifest, writePackageJsonlRecords, } from '../../package/writer.js';
import { packageMembershipToUploadMembershipRow, packageOrganizationToUploadOrganizationRow, packageUserToUploadUserRow, } from '../../package/upload.js';
import { createCSVWriter } from '../../shared/csv-utils.js';
import * as logger from '../../shared/logger.js';
import { writeCustomAttributeMappingsCsv, writeOidcConnectionsCsv, writeProxyRoutesCsv, writeSamlConnectionsCsv, createProxyRouteRow, } from '../../sso/handoff.js';
import { buildCustomAttributesJson, importedId as cognitoImportedId, isFederatedUser, isOidc, isSaml, toOidcRow, toSamlRow, toCustomAttrRows, toUserRow, } from './workos-csv.js';
const USER_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.users;
const ORG_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.organizations;
const MEMBERSHIP_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.memberships;
const UPLOAD_USER_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.uploadUsers;
const UPLOAD_ORG_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.uploadOrganizations;
const UPLOAD_MEMBERSHIP_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.uploadMemberships;
const DEFAULT_PACKAGE_ENTITIES = ['users', 'organizations', 'memberships'];
const SUPPORTED_PACKAGE_ENTITIES = new Set([...DEFAULT_PACKAGE_ENTITIES, 'sso']);
export async function exportCognitoPackage(inputs, options) {
    const resolvedOutputDir = path.resolve(options.outputDir);
    const requested = normalizeRequestedEntities(options.entities);
    const wantUsers = requested.includes('users');
    const wantOrgs = requested.includes('organizations');
    const wantMemberships = requested.includes('memberships');
    const wantSso = requested.includes('sso');
    await createEmptyPackageFiles(resolvedOutputDir, buildHandoffNotes({ includeSso: wantSso }));
    if (!options.quiet) {
        logger.info(`Writing Cognito migration package to ${resolvedOutputDir}`);
    }
    const stats = createEmptyStats();
    const orgStrategy = options.orgStrategy ?? 'user-pool';
    if (wantOrgs || wantUsers || wantMemberships) {
        await writeIdentityEntities({
            inputs,
            stats,
            outputDir: resolvedOutputDir,
            orgStrategy,
            skipExternalProviderUsers: options.skipExternalProviderUsers ?? true,
            writeOrgs: wantOrgs,
            writeUsers: wantUsers,
            writeMemberships: wantMemberships,
        });
    }
    if (wantSso) {
        await writeSsoEntities({
            providers: inputs.providers ?? [],
            stats,
            outputDir: resolvedOutputDir,
            proxy: options.proxy ?? {},
        });
    }
    await writePackageJsonlRecords(resolvedOutputDir, 'warnings', stats.warnings);
    await writePackageJsonlRecords(resolvedOutputDir, 'skippedUsers', stats.skipped);
    const manifest = createMigrationPackageManifest({
        provider: 'cognito',
        generatedAt: new Date(),
        entitiesRequested: requested,
        entitiesExported: {
            users: stats.totalUsers,
            organizations: stats.totalOrgs,
            memberships: stats.totalMemberships,
            samlConnections: stats.samlConnections,
            oidcConnections: stats.oidcConnections,
            customAttributeMappings: stats.customAttributeMappings,
            proxyRoutes: stats.proxyRoutes,
            uploadUsers: stats.uploadUsers,
            uploadOrganizations: stats.uploadOrganizations,
            uploadMemberships: stats.uploadMemberships,
            warnings: stats.warnings.length,
            skippedUsers: stats.skipped.length,
        },
        secretsRedacted: true,
        secretRedaction: buildSecretRedactionMetadata(wantSso),
        warnings: stats.warnings.map((warning) => warning.message),
    });
    await writeMigrationPackageManifest(resolvedOutputDir, manifest);
    if (!options.quiet) {
        logger.success('\nPackage export complete');
        logger.info(`  Organizations: ${stats.totalOrgs}`);
        logger.info(`  Memberships:   ${stats.totalMemberships}`);
        logger.info(`  Users:         ${stats.totalUsers}`);
        if (wantSso) {
            logger.info(`  SAML connections: ${stats.samlConnections}`);
            logger.info(`  OIDC connections: ${stats.oidcConnections}`);
        }
        if (stats.skipped.length > 0)
            logger.warn(`  Skipped users: ${stats.skipped.length}`);
        if (stats.warnings.length > 0)
            logger.warn(`  Warnings: ${stats.warnings.length}`);
    }
    return { outputDir: resolvedOutputDir, stats };
}
async function writeIdentityEntities(ctx) {
    const orgWriter = createCSVWriter(getPackageFilePath(ctx.outputDir, 'organizations'), [
        ...ORG_HEADERS,
    ]);
    const userWriter = createCSVWriter(getPackageFilePath(ctx.outputDir, 'users'), [...USER_HEADERS]);
    const membershipWriter = createCSVWriter(getPackageFilePath(ctx.outputDir, 'memberships'), [
        ...MEMBERSHIP_HEADERS,
    ]);
    const uploadUserWriter = createCSVWriter(getPackageFilePath(ctx.outputDir, 'uploadUsers'), [
        ...UPLOAD_USER_HEADERS,
    ]);
    const uploadOrgWriter = createCSVWriter(getPackageFilePath(ctx.outputDir, 'uploadOrganizations'), [...UPLOAD_ORG_HEADERS]);
    const uploadMembershipWriter = createCSVWriter(getPackageFilePath(ctx.outputDir, 'uploadMemberships'), [...UPLOAD_MEMBERSHIP_HEADERS]);
    const seenUserIds = new Set();
    const seenOrgIds = new Set();
    const seenMembershipIds = new Set();
    try {
        const orgRows = computeOrgRows(ctx);
        if (ctx.writeOrgs) {
            for (const row of orgRows) {
                orgWriter.write(row);
                ctx.stats.totalOrgs++;
                const upload = packageOrganizationToUploadOrganizationRow(row);
                if (upload && !seenOrgIds.has(upload.organization_id)) {
                    seenOrgIds.add(upload.organization_id);
                    uploadOrgWriter.write(upload);
                    ctx.stats.uploadOrganizations++;
                }
            }
        }
        if (ctx.writeUsers || ctx.writeMemberships) {
            const orgByPoolId = new Map(orgRows.map((row) => [row.org_external_id, row]));
            const users = ctx.inputs.users ?? [];
            for (const user of users) {
                if (!user.attributes.email) {
                    ctx.stats.skipped.push({
                        timestamp: new Date().toISOString(),
                        user_pool_id: user.userPoolId,
                        username: user.username,
                        reason: 'no_email',
                    });
                    ctx.stats.skippedUsers++;
                    continue;
                }
                if (ctx.skipExternalProviderUsers && isFederatedUser(user)) {
                    ctx.stats.skipped.push({
                        timestamp: new Date().toISOString(),
                        user_pool_id: user.userPoolId,
                        username: user.username,
                        email: user.attributes.email,
                        reason: 'federated_user',
                    });
                    ctx.stats.skippedUsers++;
                    continue;
                }
                const orgRow = orgByPoolId.get(user.userPoolId);
                const userRowPartial = toUserRow(user);
                const fullRow = {
                    email: userRowPartial.email,
                    password: '',
                    password_hash: '',
                    password_hash_type: '',
                    first_name: userRowPartial.first_name,
                    last_name: userRowPartial.last_name,
                    email_verified: userRowPartial.email_verified,
                    external_id: userRowPartial.external_id,
                    metadata: '',
                    org_id: '',
                    org_external_id: orgRow?.org_external_id ?? '',
                    org_name: orgRow?.org_name ?? '',
                    role_slugs: '',
                };
                if (ctx.writeUsers) {
                    userWriter.write(fullRow);
                    ctx.stats.totalUsers++;
                    const uploadUser = packageUserToUploadUserRow(fullRow);
                    if (uploadUser && !seenUserIds.has(uploadUser.user_id)) {
                        seenUserIds.add(uploadUser.user_id);
                        uploadUserWriter.write(uploadUser);
                        ctx.stats.uploadUsers++;
                    }
                }
                if (ctx.writeMemberships && orgRow) {
                    const membershipRow = {
                        email: fullRow.email,
                        external_id: fullRow.external_id,
                        user_id: '',
                        org_id: '',
                        org_external_id: orgRow.org_external_id,
                        org_name: orgRow.org_name,
                        role_slugs: '',
                        metadata: '',
                    };
                    membershipWriter.write(membershipRow);
                    ctx.stats.totalMemberships++;
                    const uploadMembership = packageMembershipToUploadMembershipRow(membershipRow);
                    if (uploadMembership) {
                        const key = `${uploadMembership.organization_id}:${uploadMembership.user_id}`;
                        if (!seenMembershipIds.has(key)) {
                            seenMembershipIds.add(key);
                            uploadMembershipWriter.write(uploadMembership);
                            ctx.stats.uploadMemberships++;
                        }
                    }
                }
                else if (ctx.writeMemberships && !orgRow) {
                    addWarning(ctx.stats, {
                        code: 'membership_missing_org',
                        message: `User ${user.username} in pool ${user.userPoolId} has no matching organization row; membership skipped.`,
                        user_pool_id: user.userPoolId,
                        email: user.attributes.email,
                    });
                }
            }
        }
    }
    finally {
        await Promise.all([
            orgWriter.end(),
            userWriter.end(),
            membershipWriter.end(),
            uploadUserWriter.end(),
            uploadOrgWriter.end(),
            uploadMembershipWriter.end(),
        ]);
    }
}
function computeOrgRows(ctx) {
    if (ctx.orgStrategy === 'none')
        return [];
    if (ctx.orgStrategy === 'user-pool') {
        const poolIds = new Set();
        for (const user of ctx.inputs.users ?? [])
            poolIds.add(user.userPoolId);
        for (const provider of ctx.inputs.providers ?? [])
            poolIds.add(provider.userPoolId);
        return [...poolIds].sort().map((poolId) => ({
            org_id: '',
            org_external_id: poolId,
            org_name: poolId,
            domains: '',
            metadata: '',
        }));
    }
    // connection strategy: one org per provider; users cannot be auto-mapped to memberships.
    const seen = new Set();
    const rows = [];
    for (const provider of ctx.inputs.providers ?? []) {
        const id = cognitoImportedId(provider);
        if (seen.has(id))
            continue;
        seen.add(id);
        rows.push({
            org_id: '',
            org_external_id: id,
            org_name: provider.providerName,
            domains: '',
            metadata: '',
        });
    }
    if (ctx.inputs.users && ctx.inputs.users.length > 0) {
        addWarning(ctx.stats, {
            code: 'connection_strategy_no_memberships',
            message: 'Connection-based org strategy cannot infer per-user memberships from Cognito. Users were exported without membership rows.',
        });
    }
    return rows;
}
async function writeSsoEntities(ctx) {
    const samlRows = [];
    const oidcRows = [];
    const customAttrRows = [];
    const proxyRows = [];
    for (const provider of ctx.providers) {
        if (isSaml(provider)) {
            samlRows.push(toSamlRow(provider, ctx.proxy));
            proxyRows.push(buildProxyRoute(provider, ctx.proxy));
        }
        else if (isOidc(provider)) {
            oidcRows.push(toOidcRow(provider, ctx.proxy));
            proxyRows.push(buildProxyRoute(provider, ctx.proxy));
        }
        else {
            addWarning(ctx.stats, {
                code: 'unsupported_connection_protocol',
                message: `Cognito identity provider ${provider.providerName} (${provider.providerType}) is not SAML/OIDC; skipped.`,
                provider_name: provider.providerName,
                user_pool_id: provider.userPoolId,
            });
            continue;
        }
        customAttrRows.push(...toCustomAttrRows(provider));
        if (Object.keys(provider.providerDetails).some((key) => key.toLowerCase().includes('secret'))) {
            addWarning(ctx.stats, {
                code: 'secrets_redacted',
                message: `Connection ${cognitoImportedId(provider)} contained secret material; package keeps ${buildCustomAttributesJson(provider.attributeMapping) ? 'attribute mappings only' : 'redacted output only'}.`,
                provider_name: provider.providerName,
                user_pool_id: provider.userPoolId,
            });
        }
    }
    await Promise.all([
        writeSamlConnectionsCsv(getPackageFilePath(ctx.outputDir, 'samlConnections'), samlRows),
        writeOidcConnectionsCsv(getPackageFilePath(ctx.outputDir, 'oidcConnections'), oidcRows),
        writeCustomAttributeMappingsCsv(getPackageFilePath(ctx.outputDir, 'customAttributeMappings'), customAttrRows),
        writeProxyRoutesCsv(getPackageFilePath(ctx.outputDir, 'proxyRoutes'), proxyRows),
        writeRawCognitoProviders(ctx.outputDir, ctx.providers),
    ]);
    ctx.stats.samlConnections = samlRows.length;
    ctx.stats.oidcConnections = oidcRows.length;
    ctx.stats.customAttributeMappings = customAttrRows.length;
    ctx.stats.proxyRoutes = proxyRows.length;
}
function buildProxyRoute(provider, proxy) {
    const protocol = isSaml(provider) ? 'saml' : 'oidc';
    return createProxyRouteRow({
        importedId: cognitoImportedId(provider),
        organizationExternalId: provider.providerName,
        provider: 'cognito',
        protocol,
        sourceAcsUrl: '',
        sourceEntityId: provider.providerDetails.EntityId ?? '',
        sourceRedirectUri: provider.providerDetails.SSORedirectBindingURI ?? '',
        customAcsUrl: renderProxyTemplate(proxy.samlCustomAcsUrl ?? null, provider),
        customEntityId: renderProxyTemplate(proxy.samlCustomEntityId ?? null, provider),
        customRedirectUri: renderProxyTemplate(proxy.oidcCustomRedirectUri ?? null, provider),
        cutoverState: 'legacy',
        notes: '',
    });
}
function renderProxyTemplate(template, p) {
    if (!template)
        return '';
    return template
        .replace(/\{provider_name\}/g, p.providerName)
        .replace(/\{user_pool_id\}/g, p.userPoolId)
        .replace(/\{region\}/g, p.region);
}
async function writeRawCognitoProviders(outputDir, providers) {
    const rawDir = path.join(outputDir, 'raw');
    await fs.mkdir(rawDir, { recursive: true });
    const lines = providers.map((p) => JSON.stringify(p)).join('\n');
    await fs.writeFile(path.join(rawDir, 'cognito-providers.jsonl'), lines ? `${lines}\n` : '', 'utf-8');
}
function createEmptyStats() {
    return {
        totalUsers: 0,
        totalOrgs: 0,
        totalMemberships: 0,
        samlConnections: 0,
        oidcConnections: 0,
        customAttributeMappings: 0,
        proxyRoutes: 0,
        uploadUsers: 0,
        uploadOrganizations: 0,
        uploadMemberships: 0,
        skippedUsers: 0,
        warnings: [],
        skipped: [],
    };
}
function addWarning(stats, warning) {
    stats.warnings.push({ timestamp: new Date().toISOString(), ...warning });
}
function normalizeRequestedEntities(entities) {
    const requested = entities && entities.length > 0
        ? entities.flatMap((entity) => entity.split(','))
        : [...DEFAULT_PACKAGE_ENTITIES];
    const normalized = [
        ...new Set(requested.map((entity) => entity.trim().toLowerCase()).filter((entity) => entity.length > 0)),
    ];
    if (normalized.includes('all'))
        return [...SUPPORTED_PACKAGE_ENTITIES];
    for (const entity of normalized) {
        if (!SUPPORTED_PACKAGE_ENTITIES.has(entity)) {
            throw new Error(`Unsupported Cognito package entity "${entity}". Supported entities: ${[
                ...SUPPORTED_PACKAGE_ENTITIES,
            ].join(', ')}`);
        }
    }
    return normalized.length > 0 ? normalized : [...DEFAULT_PACKAGE_ENTITIES];
}
function buildHandoffNotes(input) {
    if (!input.includeSso) {
        return [
            '# Cognito SSO handoff notes',
            '',
            'This package was generated without Cognito SSO connection handoff files.',
            'Re-run with --entities sso (or include sso in a comma-separated entity list) when SSO handoff is needed.',
            '',
        ].join('\n');
    }
    return [
        '# Cognito SSO handoff notes',
        '',
        'Cognito SSO export is handoff-only. SAML and OIDC identity providers are mapped onto WorkOS connection CSVs but no WorkOS connections are created automatically.',
        'Use the proxy templates and proxy_routes.csv when staging a callback proxy during enterprise-connection cutover.',
        '',
    ].join('\n');
}
function buildSecretRedactionMetadata(includeSso) {
    if (!includeSso) {
        return {
            mode: 'not-applicable',
            redacted: true,
            notes: ['Cognito package mode does not export user passwords or connection secrets.'],
        };
    }
    return {
        mode: 'redacted',
        redacted: true,
        redactedFields: ['client_secret'],
        files: ['raw/cognito-providers.jsonl', 'sso/oidc_connections.csv'],
        notes: ['Cognito does not export OIDC client secrets through DescribeIdentityProvider.'],
    };
}
