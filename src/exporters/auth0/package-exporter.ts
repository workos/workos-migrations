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
import { createCSVWriter } from '../../shared/csv-utils.js';
import type {
  Auth0ExportOptions,
  Auth0Organization,
  Auth0User,
  CSVRow,
  ExportSummary,
} from '../../shared/types.js';
import * as logger from '../../shared/logger.js';
import { Auth0Client } from './client.js';
import { extractOrgFromMetadata, isFederatedAuth0User, mapAuth0UserToWorkOS } from './mapper.js';

export interface Auth0ExportClient {
  testConnection?(): Promise<{ success: boolean; error?: string }>;
  getOrganizations(page?: number, perPage?: number): Promise<Auth0Organization[]>;
  getOrganizationMembers(
    orgId: string,
    page?: number,
    perPage?: number,
  ): Promise<Array<{ user_id: string }>>;
  getUser(userId: string): Promise<Auth0User | null>;
  getUsers(page?: number, perPage?: number): Promise<Auth0User[]>;
}

interface Auth0SkippedUserRecord {
  timestamp: string;
  user_id: string;
  email: string;
  org_id: string;
  org_name: string;
  reason: string;
  error?: string;
}

interface Auth0WarningRecord {
  timestamp: string;
  code: string;
  message: string;
  org_id?: string;
  org_name?: string;
  user_id?: string;
}

interface Auth0PackageStats {
  totalUsers: number;
  totalOrgs: number;
  totalMemberships: number;
  skippedUsers: number;
  warnings: Auth0WarningRecord[];
  skipped: Auth0SkippedUserRecord[];
}

const USER_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.users;
const ORG_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.organizations;
const MEMBERSHIP_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.memberships;

export async function exportAuth0Package(options: Auth0ExportOptions): Promise<ExportSummary> {
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

export async function exportAuth0PackageWithClient(
  client: Auth0ExportClient,
  options: Auth0ExportOptions,
): Promise<ExportSummary> {
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

async function exportPackageOrganizations(
  client: Auth0ExportClient,
  outputDir: string,
  options: Auth0ExportOptions,
): Promise<Auth0PackageStats> {
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

  const stats: Auth0PackageStats = {
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
  } finally {
    await Promise.all([orgWriter.end(), userWriter.end(), membershipWriter.end()]);
  }

  return stats;
}

async function exportOneOrganizationMembers(
  client: Auth0ExportClient,
  org: Auth0Organization,
  userWriter: ReturnType<typeof createCSVWriter>,
  membershipWriter: ReturnType<typeof createCSVWriter>,
  options: Auth0ExportOptions,
  stats: Auth0PackageStats,
): Promise<void> {
  let orgUserCount = 0;
  let orgSkippedCount = 0;
  let page = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      const members = await client.getOrganizationMembers(org.id, page, options.pageSize);
      if (members.length === 0) break;

      const batchSize = options.userFetchConcurrency;
      for (let i = 0; i < members.length; i += batchSize) {
        const batch = members.slice(i, i + batchSize);

        const results = await Promise.allSettled(
          batch.map(async (member) => {
            if (!member.user_id) return null;
            return client.getUser(member.user_id);
          }),
        );

        for (const result of results) {
          if (result.status === 'rejected') {
            addSkipped(stats, undefined, undefined, org, 'fetch_failed', String(result.reason));
            orgSkippedCount++;
            continue;
          }

          const user = result.value;
          const exportResult = writePackageUserAndMembership(
            user,
            org,
            userWriter,
            membershipWriter,
            options,
            stats,
          );

          if (exportResult === 'exported') {
            orgUserCount++;
          } else {
            orgSkippedCount++;
          }
        }
      }

      hasMore = members.length >= options.pageSize;
      page++;
    }
  } catch (error: unknown) {
    addWarning(
      stats,
      'org_export_failed',
      `Failed to export org ${org.name}: ${(error as Error).message}`,
      org,
    );
  }

  if (!options.quiet) {
    logger.info(
      `  ${org.display_name || org.name}: ${orgUserCount} user row(s)${
        orgSkippedCount > 0 ? ` (${orgSkippedCount} skipped)` : ''
      }`,
    );
  }
}

async function exportPackageUsersWithMetadata(
  client: Auth0ExportClient,
  outputDir: string,
  options: Auth0ExportOptions,
): Promise<Auth0PackageStats> {
  const orgWriter = createCSVWriter(getPackageFilePath(outputDir, 'organizations'), [
    ...ORG_HEADERS,
  ]);
  const userWriter = createCSVWriter(getPackageFilePath(outputDir, 'users'), [...USER_HEADERS]);
  const membershipWriter = createCSVWriter(getPackageFilePath(outputDir, 'memberships'), [
    ...MEMBERSHIP_HEADERS,
  ]);

  const stats: Auth0PackageStats = {
    totalUsers: 0,
    totalOrgs: 0,
    totalMemberships: 0,
    skippedUsers: 0,
    warnings: [],
    skipped: [],
  };
  const seenOrgs = new Set<string>();

  if (!options.quiet) {
    logger.info('Using metadata-based org discovery');
  }

  try {
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const users = await client.getUsers(page, options.pageSize);
      if (users.length === 0) break;

      for (const user of users) {
        const orgInfo = extractOrgFromMetadata(
          user,
          options.metadataOrgIdField,
          options.metadataOrgNameField,
        );

        if (!orgInfo || !orgInfo.orgId) {
          addSkipped(stats, user.user_id, user.email, undefined, 'no_org_in_metadata');
          continue;
        }

        if (options.orgs && !options.orgs.includes(orgInfo.orgId)) {
          continue;
        }

        const org: Auth0Organization = {
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
  } finally {
    await Promise.all([orgWriter.end(), userWriter.end(), membershipWriter.end()]);
  }

  return stats;
}

function writePackageUserAndMembership(
  user: Auth0User | null,
  org: Auth0Organization | undefined,
  userWriter: ReturnType<typeof createCSVWriter>,
  membershipWriter: ReturnType<typeof createCSVWriter>,
  options: Auth0ExportOptions,
  stats: Auth0PackageStats,
): 'exported' | 'skipped' {
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
    addWarning(
      stats,
      'blocked_user_metadata_only',
      `Blocked Auth0 user ${user.user_id} was exported without credentials.`,
      org,
      user.user_id,
    );
  }

  return 'exported';
}

async function fetchAllOrganizations(
  client: Auth0ExportClient,
  pageSize: number,
): Promise<Auth0Organization[]> {
  const allOrgs: Auth0Organization[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const orgs = await client.getOrganizations(page, pageSize);
    if (orgs.length === 0) break;
    allOrgs.push(...orgs);
    hasMore = orgs.length >= pageSize;
    page++;
  }

  return allOrgs;
}

function toOrganizationRow(org: Auth0Organization): Record<string, string> {
  return {
    org_id: '',
    org_external_id: org.id,
    org_name: org.display_name || org.name,
    domains: extractDomains(org.metadata).join(','),
    metadata: org.metadata ? JSON.stringify(org.metadata) : '',
  };
}

function toMembershipRow(
  user: Auth0User,
  org: Auth0Organization,
  row: CSVRow,
): Record<string, string> {
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

function normalizeCsvRow(row: CSVRow, headers: readonly string[]): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const header of headers) {
    const value = row[header];
    if (value === undefined || value === null) {
      normalized[header] = '';
    } else if (typeof value === 'boolean') {
      normalized[header] = value ? 'true' : 'false';
    } else {
      normalized[header] = String(value);
    }
  }

  return normalized;
}

function addSkipped(
  stats: Auth0PackageStats,
  userId: string | undefined,
  email: string | undefined,
  org: Auth0Organization | undefined,
  reason: string,
  error?: string,
): void {
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

function addWarning(
  stats: Auth0PackageStats,
  code: string,
  message: string,
  org?: Auth0Organization,
  userId?: string,
): void {
  stats.warnings.push({
    timestamp: new Date().toISOString(),
    code,
    message,
    ...(org ? { org_id: org.id, org_name: org.display_name || org.name } : {}),
    ...(userId ? { user_id: userId } : {}),
  });
}

function extractDomains(metadata: Record<string, unknown> | undefined): string[] {
  const raw = metadata?.domains ?? metadata?.domain;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(/[;,]/)
      .map((domain) => domain.trim())
      .filter(Boolean);
  }
  return [];
}

function buildHandoffNotes(): string {
  return [
    '# Auth0 SSO handoff notes',
    '',
    'This package was generated by Auth0 package core and does not include SAML/OIDC connection handoff files yet.',
    'Run the Auth0 SSO handoff export phase when connection export support is enabled.',
    '',
  ].join('\n');
}
