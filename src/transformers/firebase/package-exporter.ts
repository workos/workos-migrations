import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MIGRATION_PACKAGE_CSV_HEADERS,
  createMigrationPackageManifest,
} from '../../package/manifest.js';
import {
  createEmptyPackageFiles,
  getPackageFilePath,
  writeMigrationPackageManifest,
  writePackageJsonlRecords,
} from '../../package/writer.js';
import {
  packageMembershipToUploadMembershipRow,
  packageOrganizationToUploadOrganizationRow,
  packageUserToUploadUserRow,
} from '../../package/upload.js';
import { createCSVWriter } from '../../shared/csv-utils.js';
import * as logger from '../../shared/logger.js';
import type {
  FirebaseScryptConfig,
  FirebaseUserRecord,
  NameSplitStrategy,
} from '../../shared/types.js';
import { loadOrgMapping, type OrgMappingRow } from '../shared/org-mapper.js';
import { loadRoleMapping } from '../shared/role-mapper.js';
import { encodeFirebaseScryptPHC } from './scrypt.js';
import { splitDisplayName } from './transformer.js';
import {
  writeOidcConnectionsCsv,
  writeSamlConnectionsCsv,
  type OidcRow,
  type SamlRow,
  type SsoHandoffWarning,
} from '../../sso/handoff.js';
import {
  IdentityPlatformClient,
  type IdentityPlatformAccessTokenProvider,
} from './identity-platform-client.js';
import {
  mapFirebaseOidcConfig,
  mapFirebaseSamlConfig,
  type FirebaseInboundSamlConfig,
  type FirebaseOAuthIdpConfig,
} from './sso-mapper.js';
import { writeFile } from 'node:fs/promises';

export interface FirebasePackageExportOptions {
  input: string;
  outputDir: string;
  scryptConfig?: FirebaseScryptConfig;
  nameSplitStrategy: NameSplitStrategy;
  includeDisabled?: boolean;
  skipPasswords?: boolean;
  orgMapping?: string;
  roleMapping?: string;
  sourceTenant?: string;
  quiet?: boolean;
  /**
   * Google Cloud project ID. Required when SSO export is requested. When
   * `accessTokenProvider` is supplied (or env vars resolve a default), the
   * exporter calls the Identity Platform admin API and writes
   * `sso/saml_connections.csv` and `sso/oidc_connections.csv`.
   */
  gcpProjectId?: string;
  /** Pluggable access token provider — supply for tests or custom auth flows. */
  accessTokenProvider?: IdentityPlatformAccessTokenProvider;
  /** Override the Identity Platform base URL (default `https://identitytoolkit.googleapis.com`). */
  identityPlatformBaseUrl?: string;
  /** Inject a fetch implementation (used by tests). */
  identityPlatformFetchImpl?: typeof fetch;
  /**
   * Limit the SSO export to the project scope only (skip per-tenant
   * inboundSamlConfigs / oauthIdpConfigs).
   */
  skipTenantSsoScopes?: boolean;
}

export interface FirebasePackageWarning {
  timestamp: string;
  code: string;
  message: string;
  firebase_uid?: string;
  email?: string;
}

export interface FirebasePackageSkipped {
  timestamp: string;
  firebase_uid?: string;
  email?: string;
  reason: string;
}

export interface FirebasePackageStats {
  totalUsers: number;
  totalOrgs: number;
  totalMemberships: number;
  roleDefinitions: number;
  userRoleAssignments: number;
  uploadUsers: number;
  uploadOrganizations: number;
  uploadMemberships: number;
  skippedUsers: number;
  samlConnections: number;
  oidcConnections: number;
  warnings: FirebasePackageWarning[];
  skipped: FirebasePackageSkipped[];
}

const USER_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.users;
const ORG_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.organizations;
const MEMBERSHIP_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.memberships;
const ROLE_DEFINITION_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.roleDefinitions;
const USER_ROLE_ASSIGNMENT_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.userRoleAssignments;
const UPLOAD_USER_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.uploadUsers;
const UPLOAD_ORG_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.uploadOrganizations;
const UPLOAD_MEMBERSHIP_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.uploadMemberships;

export async function exportFirebasePackage(
  options: FirebasePackageExportOptions,
): Promise<FirebasePackageStats> {
  const outputDir = path.resolve(options.outputDir);
  const stats = createEmptyStats();

  await createEmptyPackageFiles(outputDir, buildHandoffNotes());

  let orgMap: Map<string, OrgMappingRow> | null = null;
  if (options.orgMapping) {
    orgMap = await loadOrgMapping(options.orgMapping, {
      userIdColumn: 'firebase_uid',
      quiet: true,
    });
  }
  let roleMap: Map<string, string[]> | null = null;
  if (options.roleMapping) {
    roleMap = await loadRoleMapping(options.roleMapping, {
      userIdColumn: 'firebase_uid',
      quiet: true,
    });
  }

  const users = parseFirebaseExport(options.input);

  if (!options.quiet) logger.info(`Writing Firebase migration package to ${outputDir}`);

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
  const uploadMembershipWriter = createCSVWriter(
    getPackageFilePath(outputDir, 'uploadMemberships'),
    [...UPLOAD_MEMBERSHIP_HEADERS],
  );
  const roleDefWriter = createCSVWriter(getPackageFilePath(outputDir, 'roleDefinitions'), [
    ...ROLE_DEFINITION_HEADERS,
  ]);
  const roleAssignWriter = createCSVWriter(getPackageFilePath(outputDir, 'userRoleAssignments'), [
    ...USER_ROLE_ASSIGNMENT_HEADERS,
  ]);

  const seenUserIds = new Set<string>();
  const seenOrgIds = new Set<string>();
  const seenMembershipIds = new Set<string>();
  const seenRoleSlugs = new Set<string>();
  const seenOrgRowsWritten = new Set<string>();

  try {
    for (const user of users) {
      const result = mapFirebaseUser(user, options, orgMap, roleMap, stats);
      if (result.skipped) continue;

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
  } finally {
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

  const ssoEnabled = Boolean(options.accessTokenProvider && options.gcpProjectId);
  let ssoHandoffNotes: string | null = null;
  let secretRedaction = {
    mode: 'not-applicable' as 'not-applicable' | 'redacted',
    redacted: true,
    notes: ['Firebase Auth export does not include connection secrets.'],
  };

  if (ssoEnabled) {
    const ssoResult = await exportFirebaseSsoConnections({
      outputDir,
      stats,
      projectId: options.gcpProjectId!,
      accessTokenProvider: options.accessTokenProvider!,
      baseUrl: options.identityPlatformBaseUrl,
      fetchImpl: options.identityPlatformFetchImpl,
      skipTenantScopes: options.skipTenantSsoScopes ?? false,
      quiet: options.quiet,
    });
    ssoHandoffNotes = ssoResult.handoffNotes;
    if (ssoResult.secretsRedacted) {
      secretRedaction = {
        mode: 'redacted',
        redacted: true,
        notes: [
          'Firebase OIDC client secrets are intentionally redacted from sso/oidc_connections.csv.',
          'The customer must re-enter the client secret in the WorkOS dashboard.',
        ],
      };
    }
  }

  await writePackageJsonlRecords(outputDir, 'warnings', stats.warnings);
  await writePackageJsonlRecords(outputDir, 'skippedUsers', stats.skipped);

  if (ssoHandoffNotes) {
    await writeFile(getPackageFilePath(outputDir, 'handoffNotes'), ssoHandoffNotes, 'utf-8');
  }

  const entitiesRequested = ['users', 'organizations', 'memberships', 'roles'];
  if (ssoEnabled) entitiesRequested.push('sso');

  const manifest = createMigrationPackageManifest({
    provider: 'firebase',
    sourceTenant: options.sourceTenant,
    generatedAt: new Date(),
    entitiesRequested,
    entitiesExported: {
      users: stats.totalUsers,
      organizations: stats.totalOrgs,
      memberships: stats.totalMemberships,
      roleDefinitions: stats.roleDefinitions,
      userRoleAssignments: stats.userRoleAssignments,
      uploadUsers: stats.uploadUsers,
      uploadOrganizations: stats.uploadOrganizations,
      uploadMemberships: stats.uploadMemberships,
      samlConnections: stats.samlConnections,
      oidcConnections: stats.oidcConnections,
      warnings: stats.warnings.length,
      skippedUsers: stats.skipped.length,
    },
    secretsRedacted: true,
    secretRedaction,
    warnings: stats.warnings.map((w) => w.message),
  });

  await writeMigrationPackageManifest(outputDir, manifest);

  if (!options.quiet) {
    logger.success('\nFirebase package export complete');
    logger.info(`  Users: ${stats.totalUsers}`);
    logger.info(`  Orgs:  ${stats.totalOrgs}`);
    logger.info(`  Memberships: ${stats.totalMemberships}`);
    if (ssoEnabled) {
      logger.info(`  SAML connections: ${stats.samlConnections}`);
      logger.info(`  OIDC connections: ${stats.oidcConnections}`);
    }
    if (stats.skipped.length > 0) logger.warn(`  Skipped: ${stats.skipped.length}`);
    if (stats.warnings.length > 0) logger.warn(`  Warnings: ${stats.warnings.length}`);
  }

  return stats;
}

interface ExportFirebaseSsoOptions {
  outputDir: string;
  stats: FirebasePackageStats;
  projectId: string;
  accessTokenProvider: IdentityPlatformAccessTokenProvider;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  skipTenantScopes: boolean;
  quiet?: boolean;
}

async function exportFirebaseSsoConnections(options: ExportFirebaseSsoOptions): Promise<{
  handoffNotes: string;
  secretsRedacted: boolean;
}> {
  const client = new IdentityPlatformClient({
    projectId: options.projectId,
    accessTokenProvider: options.accessTokenProvider,
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
  });

  const samlRows: SamlRow[] = [];
  const oidcRows: OidcRow[] = [];
  const handoffWarnings: SsoHandoffWarning[] = [];
  let secretsRedacted = false;
  let totalFetched = 0;
  let totalSkipped = 0;
  const scopeSummary: string[] = [];

  const scopes: Array<{ tenantId?: string; tenantDisplayName?: string; label: string }> = [
    { label: 'project' },
  ];

  if (!options.skipTenantScopes) {
    try {
      const tenants = await client.listTenants();
      for (const tenant of tenants) {
        const tenantId = extractResourceId(tenant.name);
        if (!tenantId) continue;
        scopes.push({
          tenantId,
          tenantDisplayName: tenant.displayName ?? undefined,
          label: `tenant:${tenantId}`,
        });
      }
    } catch (error) {
      const message = `Failed to list Identity Platform tenants: ${(error as Error).message}`;
      options.stats.warnings.push({
        timestamp: new Date().toISOString(),
        code: 'sso_fetch_failed',
        message,
      });
      if (!options.quiet) logger.warn(`  ${message}`);
    }
  }

  for (const scope of scopes) {
    let samlConfigs: FirebaseInboundSamlConfig[] = [];
    let oidcConfigs: FirebaseOAuthIdpConfig[] = [];
    try {
      samlConfigs = await client.listInboundSamlConfigs(scope.tenantId);
    } catch (error) {
      const message = `Failed to fetch inboundSamlConfigs (${scope.label}): ${(error as Error).message}`;
      options.stats.warnings.push({
        timestamp: new Date().toISOString(),
        code: 'sso_fetch_failed',
        message,
      });
      if (!options.quiet) logger.warn(`  ${message}`);
    }
    try {
      oidcConfigs = await client.listOAuthIdpConfigs(scope.tenantId);
    } catch (error) {
      const message = `Failed to fetch oauthIdpConfigs (${scope.label}): ${(error as Error).message}`;
      options.stats.warnings.push({
        timestamp: new Date().toISOString(),
        code: 'sso_fetch_failed',
        message,
      });
      if (!options.quiet) logger.warn(`  ${message}`);
    }

    totalFetched += samlConfigs.length + oidcConfigs.length;

    for (const config of samlConfigs) {
      const result = mapFirebaseSamlConfig({
        config,
        scope: {
          tenantId: scope.tenantId,
          tenantDisplayName: scope.tenantDisplayName,
        },
      });
      handoffWarnings.push(...result.warnings);
      if (result.status === 'mapped') {
        samlRows.push(result.row);
      } else {
        totalSkipped += 1;
      }
    }

    for (const config of oidcConfigs) {
      const result = mapFirebaseOidcConfig({
        config,
        scope: {
          tenantId: scope.tenantId,
          tenantDisplayName: scope.tenantDisplayName,
        },
      });
      handoffWarnings.push(...result.warnings);
      if (result.status === 'mapped') {
        oidcRows.push(result.row);
      } else {
        totalSkipped += 1;
      }
    }

    if (samlConfigs.length > 0 || oidcConfigs.length > 0) {
      scopeSummary.push(`${scope.label}: ${samlConfigs.length} SAML, ${oidcConfigs.length} OIDC`);
    }
  }

  await writeSamlConnectionsCsv(getPackageFilePath(options.outputDir, 'samlConnections'), samlRows);
  await writeOidcConnectionsCsv(getPackageFilePath(options.outputDir, 'oidcConnections'), oidcRows);

  options.stats.samlConnections = samlRows.length;
  options.stats.oidcConnections = oidcRows.length;

  for (const warning of handoffWarnings) {
    if (warning.code === 'secrets_redacted') secretsRedacted = true;
    options.stats.warnings.push({
      timestamp: new Date().toISOString(),
      code: warning.code,
      message: warning.message,
    });
  }

  return {
    handoffNotes: buildHandoffNotes({
      attempted: true,
      fetched: totalFetched,
      samlMapped: samlRows.length,
      oidcMapped: oidcRows.length,
      skipped: totalSkipped,
      scopeSummary,
    }),
    secretsRedacted,
  };
}

function extractResourceId(resourceName: string | null | undefined): string | undefined {
  if (!resourceName) return undefined;
  const segments = resourceName.split('/');
  const last = segments[segments.length - 1];
  return last && last.length > 0 ? last : undefined;
}

interface MappedFirebaseUser {
  skipped: boolean;
  userRow: Record<string, string>;
  orgInfo?: OrgMappingRow;
  roleSlugs: string[];
}

function mapFirebaseUser(
  user: FirebaseUserRecord,
  options: FirebasePackageExportOptions,
  orgMap: Map<string, OrgMappingRow> | null,
  roleMap: Map<string, string[]> | null,
  stats: FirebasePackageStats,
): MappedFirebaseUser {
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
      passwordHash = encodeFirebaseScryptPHC(
        { passwordHash: user.passwordHash, salt: user.salt },
        options.scryptConfig,
      );
      passwordHashType = 'firebase-scrypt';
    } else {
      stats.warnings.push({
        timestamp: new Date().toISOString(),
        code: 'missing_scrypt_parameters',
        message: `No scrypt parameters provided for user ${user.localId}; password omitted.`,
        firebase_uid: user.localId,
        email,
      });
    }
  }

  const metadata: Record<string, unknown> = {};
  if (user.localId?.trim()) metadata.firebase_uid = user.localId.trim();
  if (user.phoneNumber?.trim()) metadata.phone_number = user.phoneNumber.trim();
  if (user.photoUrl?.trim()) metadata.photo_url = user.photoUrl.trim();
  if (user.customAttributes?.trim()) {
    try {
      metadata.custom_attributes = JSON.parse(user.customAttributes);
    } catch {
      metadata.custom_attributes = user.customAttributes.trim();
    }
  }
  if (user.providerUserInfo?.length) metadata.provider_info = user.providerUserInfo;
  if (user.mfaInfo?.length) metadata.mfa_info = user.mfaInfo;

  if (user.createdAt) {
    const ms = parseInt(user.createdAt, 10);
    if (!isNaN(ms)) metadata.created_at = new Date(ms).toISOString();
  }
  if (user.lastSignedInAt) {
    const ms = parseInt(user.lastSignedInAt, 10);
    if (!isNaN(ms)) metadata.last_signed_in_at = new Date(ms).toISOString();
  }

  if (user.disabled && options.includeDisabled) metadata.disabled = true;

  const uid = user.localId?.trim();
  const orgInfo = uid && orgMap ? orgMap.get(uid) : undefined;
  const roleSlugs = uid && roleMap ? (roleMap.get(uid) ?? []) : [];

  const userRow: Record<string, string> = {
    email,
    password: '',
    password_hash: passwordHash,
    password_hash_type: passwordHashType,
    first_name: firstName,
    last_name: lastName,
    email_verified: user.emailVerified === true ? 'true' : 'false',
    external_id: uid ?? '',
    metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '',
    org_id: '',
    org_external_id: orgInfo?.orgExternalId ?? '',
    org_name: orgInfo?.orgName ?? '',
    role_slugs: roleSlugs.join(','),
  };

  return { skipped: false, userRow, orgInfo, roleSlugs };
}

function parseFirebaseExport(filePath: string): FirebaseUserRecord[] {
  const raw = readFileSync(filePath, 'utf8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in Firebase export file: ${filePath}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Firebase export must be a JSON object with a "users" array');
  }

  const data = parsed as Record<string, unknown>;

  if (!Array.isArray(data.users)) {
    throw new Error(
      `Firebase export must have a "users" array at the top level. Found keys: ${Object.keys(data).join(', ')}`,
    );
  }

  return data.users as FirebaseUserRecord[];
}

function createEmptyStats(): FirebasePackageStats {
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
    samlConnections: 0,
    oidcConnections: 0,
    warnings: [],
    skipped: [],
  };
}

function buildHandoffNotes(ssoSummary?: {
  attempted: boolean;
  fetched: number;
  samlMapped: number;
  oidcMapped: number;
  skipped: number;
  scopeSummary: string[];
}): string {
  const lines = ['# Firebase / Identity Platform handoff notes', ''];

  if (!ssoSummary?.attempted) {
    lines.push(
      'Firebase Auth JSON exports do not include SAML/OIDC connection material.',
      'Re-run with `--service-account <key.json>` and `--project-id <gcp-project>`',
      'to fetch Identity Platform SAML/OIDC configs via the admin REST API, or',
      'populate sso/ files manually and run validate-package before importing.',
      '',
    );
    return lines.join('\n');
  }

  lines.push(
    `Identity Platform admin API returned ${ssoSummary.fetched} provider config(s) across ${ssoSummary.scopeSummary.length || 1} scope(s).`,
    `${ssoSummary.samlMapped} SAML provider config(s) were mapped to sso/saml_connections.csv.`,
    `${ssoSummary.oidcMapped} OIDC provider config(s) were mapped to sso/oidc_connections.csv.`,
  );
  if (ssoSummary.skipped > 0) {
    lines.push(
      `${ssoSummary.skipped} config(s) were skipped because required fields were missing — see warnings.jsonl.`,
    );
  }
  if (ssoSummary.scopeSummary.length > 0) {
    lines.push('', 'Scope breakdown:');
    for (const summary of ssoSummary.scopeSummary) lines.push(`- ${summary}`);
  }
  lines.push(
    '',
    'OIDC client secrets are redacted by design — re-enter them in the WorkOS dashboard.',
    'SAML responses contain only public IdP certificates; no SP signing private keys are returned by the admin API.',
    '',
  );
  return lines.join('\n');
}
