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
          email_verified: 'true',
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

  await writePackageJsonlRecords(outputDir, 'warnings', stats.warnings);
  await writePackageJsonlRecords(outputDir, 'skippedUsers', stats.skipped);

  const manifest = createMigrationPackageManifest({
    provider: 'clerk',
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
      notes: ['Clerk dashboard CSV does not include connection secrets.'],
    },
    warnings: stats.warnings.map((w) => w.message),
  });

  await writeMigrationPackageManifest(outputDir, manifest);

  if (!options.quiet) {
    logger.success('\nPackage export complete');
    logger.info(`  Users: ${stats.totalUsers}`);
    logger.info(`  Orgs:  ${stats.totalOrgs}`);
    logger.info(`  Memberships: ${stats.totalMemberships}`);
    if (stats.skipped.length > 0) logger.warn(`  Skipped: ${stats.skipped.length}`);
    if (stats.warnings.length > 0) logger.warn(`  Warnings: ${stats.warnings.length}`);
  }

  return stats;
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
    warnings: [],
    skipped: [],
  };
}

function buildHandoffNotes(): string {
  return [
    '# Clerk handoff notes',
    '',
    'Clerk dashboard CSV export does not surface SAML/OIDC connection material.',
    'When you have SAML connections to migrate, populate sso/saml_connections.csv',
    'manually and run `validate-package` before importing.',
    '',
  ].join('\n');
}
