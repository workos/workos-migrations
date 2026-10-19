import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
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
import type { ClerkUserRow } from '../../shared/types.js';
import { loadOrgMapping, type OrgMappingRow } from '../shared/org-mapper.js';
import { loadRoleMapping } from '../shared/role-mapper.js';
import {
  writeCustomAttributeMappingsCsv,
  writeOidcConnectionsCsv,
  writeSamlConnectionsCsv,
  type CustomAttrRow,
  type OidcRow,
  type SamlRow,
  type SsoHandoffWarning,
} from '../../sso/handoff.js';
import { ClerkClient, type ClerkClientOptions } from './client.js';
import { isClerkPrimaryEmailVerified } from './email-verification.js';
import { mapClerkEnterpriseConnection, type ClerkEnterpriseConnection } from './sso-mapper.js';

export interface ClerkPackageExportOptions {
  /** Path to the Clerk dashboard CSV export. */
  input: string;
  /** Output directory for the package. */
  outputDir: string;
  /** Optional org mapping CSV (clerk_user_id,org_external_id,org_name). */
  orgMapping?: string;
  /** Optional role mapping CSV (clerk_user_id,role_slug). */
  roleMapping?: string;
  /** Source tenant identifier to record in the manifest. */
  sourceTenant?: string;
  /** Suppress progress output. */
  quiet?: boolean;
  /**
   * Clerk Backend API secret key (e.g. `sk_live_...`). When provided, the
   * exporter fetches enterprise connections (SAML + OIDC) via
   * `/v1/enterprise_connections` and writes them to `sso/saml_connections.csv`,
   * `sso/oidc_connections.csv`, and `sso/custom_attribute_mappings.csv`.
   */
  clerkSecretKey?: string;
  /** Override the Clerk Backend API base URL (default `https://api.clerk.com/v1`). */
  clerkApiBaseUrl?: string;
  /** Inject a fetch implementation (used by tests). */
  clerkFetchImpl?: ClerkClientOptions['fetchImpl'];
}

export interface ClerkPackageWarning {
  timestamp: string;
  code: string;
  message: string;
  clerk_user_id?: string;
  email?: string;
}

export interface ClerkPackageSkipped {
  timestamp: string;
  clerk_user_id?: string;
  email?: string;
  reason: string;
}

export interface ClerkPackageStats {
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
  customAttributeMappings: number;
  warnings: ClerkPackageWarning[];
  skipped: ClerkPackageSkipped[];
}

const USER_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.users;
const ORG_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.organizations;
const MEMBERSHIP_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.memberships;
const ROLE_DEFINITION_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.roleDefinitions;
const USER_ROLE_ASSIGNMENT_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.userRoleAssignments;
const UPLOAD_USER_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.uploadUsers;
const UPLOAD_ORG_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.uploadOrganizations;
const UPLOAD_MEMBERSHIP_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.uploadMemberships;

export async function exportClerkPackage(
  options: ClerkPackageExportOptions,
): Promise<ClerkPackageStats> {
  const outputDir = path.resolve(options.outputDir);
  const stats = createEmptyStats();

  await createEmptyPackageFiles(outputDir, buildHandoffNotes());

  let orgMap: Map<string, OrgMappingRow> | null = null;
  if (options.orgMapping) {
    orgMap = await loadOrgMapping(options.orgMapping, {
      userIdColumn: 'clerk_user_id',
      quiet: true,
    });
  }
  let roleMap: Map<string, string[]> | null = null;
  if (options.roleMapping) {
    roleMap = await loadRoleMapping(options.roleMapping, {
      userIdColumn: 'clerk_user_id',
      quiet: true,
    });
  }

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

  if (!options.quiet) logger.info(`Writing Clerk migration package to ${outputDir}`);

  await new Promise<void>((resolve, reject) => {
    const inputStream = fs.createReadStream(options.input);
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });

    let headerValidated = false;

    inputStream
      .pipe(parser)
      .on('data', (row: ClerkUserRow) => {
        if (!headerValidated) {
          const headers = Object.keys(row);
          if (!headers.includes('primary_email_address') || !headers.includes('id')) {
            reject(
              new Error(
                "Clerk CSV must have 'primary_email_address' and 'id' columns. Found: " +
                  headers.join(', '),
              ),
            );
            return;
          }
          headerValidated = true;
        }

        stats.totalUsers++;
        const clerkUserId = row.id?.trim();
        const email = row.primary_email_address?.trim();
        if (!email) {
          stats.skippedUsers++;
          stats.skipped.push({
            timestamp: new Date().toISOString(),
            clerk_user_id: clerkUserId,
            reason: 'no_email',
          });
          stats.totalUsers--;
          return;
        }

        const orgInfo = clerkUserId && orgMap ? orgMap.get(clerkUserId) : undefined;
        const userRoleSlugs = clerkUserId && roleMap ? (roleMap.get(clerkUserId) ?? []) : [];

        const password = parseClerkPassword(row);
        if (password.warning) {
          stats.warnings.push({
            timestamp: new Date().toISOString(),
            code: 'unsupported_password_hasher',
            message: password.warning,
            clerk_user_id: clerkUserId,
            email,
          });
        }

        const metadata = buildClerkMetadata(row);
        const userRow: Record<string, string> = {
          email,
          password: '',
          password_hash: password.hash ?? '',
          password_hash_type: password.algorithm ?? '',
          first_name: row.first_name?.trim() ?? '',
          last_name: row.last_name?.trim() ?? '',
          email_verified: isClerkPrimaryEmailVerified(row, email) ? 'true' : 'false',
          external_id: clerkUserId ?? '',
          metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '',
          org_id: '',
          org_external_id: orgInfo?.orgExternalId ?? '',
          org_name: orgInfo?.orgName ?? '',
          role_slugs: userRoleSlugs.join(','),
        };

        userWriter.write(userRow);
        const uploadUser = packageUserToUploadUserRow(userRow);
        if (uploadUser && !seenUserIds.has(uploadUser.user_id)) {
          seenUserIds.add(uploadUser.user_id);
          uploadUserWriter.write(uploadUser);
          stats.uploadUsers++;
        }

        if (orgInfo && (orgInfo.orgExternalId || orgInfo.orgId)) {
          const orgKey = orgInfo.orgExternalId ?? orgInfo.orgId ?? '';
          if (orgKey && !seenOrgRowsWritten.has(orgKey)) {
            seenOrgRowsWritten.add(orgKey);
            const orgRow = {
              org_id: orgInfo.orgId ?? '',
              org_external_id: orgInfo.orgExternalId ?? '',
              org_name: orgInfo.orgName ?? orgInfo.orgExternalId ?? '',
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
            email,
            external_id: clerkUserId ?? '',
            user_id: '',
            org_id: orgInfo.orgId ?? '',
            org_external_id: orgInfo.orgExternalId ?? '',
            org_name: orgInfo.orgName ?? '',
            role_slugs: userRoleSlugs.join(','),
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

        for (const slug of userRoleSlugs) {
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
          if (orgInfo) {
            roleAssignWriter.write({
              email,
              user_id: '',
              external_id: clerkUserId ?? '',
              role_slug: slug,
              org_id: orgInfo.orgId ?? '',
              org_external_id: orgInfo.orgExternalId ?? '',
            });
            stats.userRoleAssignments++;
          }
        }
      })
      .on('end', () => resolve())
      .on('error', reject);
  });

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

  let ssoHandoffNotes: string | null = null;
  if (options.clerkSecretKey) {
    const ssoResult = await exportClerkSsoConnections({
      outputDir,
      stats,
      secretKey: options.clerkSecretKey,
      baseUrl: options.clerkApiBaseUrl,
      fetchImpl: options.clerkFetchImpl,
      quiet: options.quiet,
    });
    ssoHandoffNotes = ssoResult.handoffNotes;
  }

  await writePackageJsonlRecords(outputDir, 'warnings', stats.warnings);
  await writePackageJsonlRecords(outputDir, 'skippedUsers', stats.skipped);

  if (ssoHandoffNotes) {
    await fs.promises.writeFile(
      getPackageFilePath(outputDir, 'handoffNotes'),
      ssoHandoffNotes,
      'utf-8',
    );
  }

  const entitiesRequested = ['users', 'organizations', 'memberships', 'roles'];
  if (options.clerkSecretKey) entitiesRequested.push('sso');

  const manifest = createMigrationPackageManifest({
    provider: 'clerk',
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
      customAttributeMappings: stats.customAttributeMappings,
      warnings: stats.warnings.length,
      skippedUsers: stats.skipped.length,
    },
    secretsRedacted: true,
    secretRedaction: {
      mode: 'not-applicable',
      redacted: true,
      notes: [
        'Clerk dashboard CSV does not include connection secrets.',
        'Clerk enterprise connections (SAML + OIDC) expose only public material via the Backend API — IdP certificates for SAML and client_id + discovery_url for OIDC. No secret material is fetched.',
      ],
    },
    warnings: stats.warnings.map((w) => w.message),
  });

  await writeMigrationPackageManifest(outputDir, manifest);

  if (!options.quiet) {
    logger.success('\nPackage export complete');
    logger.info(`  Users: ${stats.totalUsers}`);
    logger.info(`  Orgs:  ${stats.totalOrgs}`);
    logger.info(`  Memberships: ${stats.totalMemberships}`);
    if (options.clerkSecretKey) {
      logger.info(`  SAML connections: ${stats.samlConnections}`);
      logger.info(`  OIDC connections: ${stats.oidcConnections}`);
      if (stats.customAttributeMappings > 0) {
        logger.info(`  Custom attribute mappings: ${stats.customAttributeMappings}`);
      }
    }
    if (stats.skipped.length > 0) logger.warn(`  Skipped: ${stats.skipped.length}`);
    if (stats.warnings.length > 0) logger.warn(`  Warnings: ${stats.warnings.length}`);
  }

  return stats;
}

interface ExportClerkSsoOptions {
  outputDir: string;
  stats: ClerkPackageStats;
  secretKey: string;
  baseUrl?: string;
  fetchImpl?: ClerkClientOptions['fetchImpl'];
  quiet?: boolean;
}

async function exportClerkSsoConnections(
  options: ExportClerkSsoOptions,
): Promise<{ handoffNotes: string }> {
  const client = new ClerkClient({
    secretKey: options.secretKey,
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
  });

  let connections: ClerkEnterpriseConnection[];
  try {
    connections = await client.listEnterpriseConnections();
  } catch (error) {
    const message = `Failed to fetch Clerk enterprise connections: ${(error as Error).message}`;
    options.stats.warnings.push({
      timestamp: new Date().toISOString(),
      code: 'sso_fetch_failed',
      message,
    });
    if (!options.quiet) logger.warn(`  ${message}`);
    return {
      handoffNotes: buildHandoffNotes({
        attempted: true,
        fetched: 0,
        samlMapped: 0,
        oidcMapped: 0,
      }),
    };
  }

  const samlRows: SamlRow[] = [];
  const oidcRows: OidcRow[] = [];
  const customAttrRows: CustomAttrRow[] = [];
  const handoffWarnings: SsoHandoffWarning[] = [];
  let skippedConnections = 0;

  for (const connection of connections) {
    const result = mapClerkEnterpriseConnection({ connection });
    handoffWarnings.push(...result.warnings);
    if (result.status === 'mapped') {
      if (result.protocol === 'saml') {
        samlRows.push(result.samlRow);
        customAttrRows.push(...result.customAttributeRows);
      } else {
        oidcRows.push(result.oidcRow);
      }
    } else {
      skippedConnections += 1;
    }
  }

  await writeSamlConnectionsCsv(getPackageFilePath(options.outputDir, 'samlConnections'), samlRows);
  await writeOidcConnectionsCsv(getPackageFilePath(options.outputDir, 'oidcConnections'), oidcRows);
  await writeCustomAttributeMappingsCsv(
    getPackageFilePath(options.outputDir, 'customAttributeMappings'),
    customAttrRows,
  );

  options.stats.samlConnections = samlRows.length;
  options.stats.oidcConnections = oidcRows.length;
  options.stats.customAttributeMappings = customAttrRows.length;

  for (const warning of handoffWarnings) {
    options.stats.warnings.push({
      timestamp: new Date().toISOString(),
      code: warning.code,
      message: warning.message,
    });
  }

  return {
    handoffNotes: buildHandoffNotes({
      attempted: true,
      fetched: connections.length,
      samlMapped: samlRows.length,
      oidcMapped: oidcRows.length,
      skipped: skippedConnections,
    }),
  };
}

function parseClerkPassword(row: ClerkUserRow): {
  hash?: string;
  algorithm?: string;
  warning?: string;
} {
  const hasher = row.password_hasher?.trim().toLowerCase();
  const digest = row.password_digest?.trim();
  if (!digest || !hasher) return {};
  if (hasher === 'bcrypt') return { hash: digest, algorithm: 'bcrypt' };
  return {
    warning: `Unsupported password hasher "${row.password_hasher}" for user ${row.id}; password omitted.`,
  };
}

function buildClerkMetadata(row: ClerkUserRow): Record<string, string> {
  const metadata: Record<string, string> = {};
  if (row.id?.trim()) metadata.clerk_user_id = row.id.trim();
  if (row.username?.trim()) metadata.username = row.username.trim();
  if (row.primary_phone_number?.trim()) {
    metadata.primary_phone_number = row.primary_phone_number.trim();
  }
  if (row.verified_phone_numbers?.trim())
    metadata.verified_phone_numbers = row.verified_phone_numbers.trim();
  if (row.unverified_phone_numbers?.trim())
    metadata.unverified_phone_numbers = row.unverified_phone_numbers.trim();
  if (row.verified_email_addresses?.trim())
    metadata.verified_email_addresses = row.verified_email_addresses.trim();
  if (row.unverified_email_addresses?.trim())
    metadata.unverified_email_addresses = row.unverified_email_addresses.trim();
  if (row.totp_secret?.trim()) metadata.totp_secret = row.totp_secret.trim();
  return metadata;
}

function createEmptyStats(): ClerkPackageStats {
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
    customAttributeMappings: 0,
    warnings: [],
    skipped: [],
  };
}

function buildHandoffNotes(ssoSummary?: {
  attempted: boolean;
  fetched: number;
  samlMapped: number;
  oidcMapped: number;
  skipped?: number;
}): string {
  const lines = ['# Clerk handoff notes', ''];

  if (!ssoSummary?.attempted) {
    lines.push(
      'Clerk dashboard CSV export does not surface SAML/OIDC connection material.',
      'Re-run with `--clerk-secret-key <sk_...>` to fetch enterprise connections',
      'via the Clerk Backend API (`/v1/enterprise_connections`), or populate the',
      'sso/ CSVs manually and run `validate-package` before importing.',
      '',
    );
    return lines.join('\n');
  }

  lines.push(
    `Clerk Backend API returned ${ssoSummary.fetched} enterprise connection(s) from /v1/enterprise_connections.`,
    `${ssoSummary.samlMapped} SAML connection(s) were mapped to sso/saml_connections.csv.`,
    `${ssoSummary.oidcMapped} OIDC connection(s) were mapped to sso/oidc_connections.csv.`,
  );
  if (ssoSummary.skipped && ssoSummary.skipped > 0) {
    lines.push(
      `${ssoSummary.skipped} were skipped because required fields were missing — see warnings.jsonl.`,
    );
  }
  lines.push(
    '',
    'No connection secrets were fetched — Clerk exposes only public IdP certificates',
    'for SAML and client_id + discovery_url for OIDC via the Backend API. Customers',
    'will need to re-enter OIDC client secrets in the WorkOS dashboard regardless.',
    '',
  );
  return lines.join('\n');
}
