import fs from 'node:fs/promises';
import path from 'node:path';
import {
  MIGRATION_PACKAGE_CSV_HEADERS,
  createMigrationPackageManifest,
  type SecretRedactionMetadata,
} from '../../package/manifest.js';
import {
  createEmptyPackageFiles,
  getPackageFilePath,
  writeMigrationPackageManifest,
  writePackageJsonlRecords,
} from '../../package/writer.js';
import { createCSVWriter } from '../../shared/csv-utils.js';
import type {
  Auth0Connection,
  Auth0ExportOptions,
  Auth0Organization,
  Auth0OrganizationConnection,
  Auth0User,
  CSVRow,
  ExportSummary,
} from '../../shared/types.js';
import {
  writeCustomAttributeMappingsCsv,
  writeOidcConnectionsCsv,
  writeProxyRoutesCsv,
  writeSamlConnectionsCsv,
  type CustomAttrRow,
  type OidcRow,
  type ProxyRouteRow,
  type SamlRow,
  type SsoHandoffWarning,
} from '../../sso/handoff.js';
import * as logger from '../../shared/logger.js';
import { Auth0Client, isMissingConnectionOptionsScopeError } from './client.js';
import { extractOrgFromMetadata, isFederatedAuth0User, mapAuth0UserToWorkOS } from './mapper.js';
import {
  AUTH0_REDACTED_SECRET_FIELDS,
  classifyAuth0ConnectionProtocol,
  mapAuth0ConnectionToSsoHandoff,
  redactAuth0ConnectionSecrets,
  type Auth0SsoConnectionOrgBinding,
} from './sso-mapper.js';

export interface Auth0ExportClient {
  testConnection?(): Promise<{ success: boolean; error?: string }>;
  getConnections?(
    page?: number,
    perPage?: number,
    strategy?: string | string[],
  ): Promise<Auth0Connection[]>;
  getConnection?(connectionId: string): Promise<Auth0Connection>;
  getOrganizations(page?: number, perPage?: number): Promise<Auth0Organization[]>;
  getOrganizationConnections?(
    orgId: string,
    page?: number,
    perPage?: number,
  ): Promise<Auth0OrganizationConnection[]>;
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
  connection_id?: string;
  protocol?: string;
  details?: Record<string, unknown>;
}

interface Auth0PackageStats {
  totalUsers: number;
  totalOrgs: number;
  totalMemberships: number;
  samlConnections: number;
  oidcConnections: number;
  customAttributeMappings: number;
  proxyRoutes: number;
  skippedUsers: number;
  warnings: Auth0WarningRecord[];
  skipped: Auth0SkippedUserRecord[];
}

const USER_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.users;
const ORG_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.organizations;
const MEMBERSHIP_HEADERS = MIGRATION_PACKAGE_CSV_HEADERS.memberships;
const DEFAULT_PACKAGE_ENTITIES = ['users', 'organizations', 'memberships'] as const;
const SUPPORTED_PACKAGE_ENTITIES = new Set([...DEFAULT_PACKAGE_ENTITIES, 'sso']);

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
  const requestedEntities = normalizeRequestedEntities(options.entities);
  const shouldExportIdentityEntities = requestedEntities.some((entity) =>
    DEFAULT_PACKAGE_ENTITIES.includes(entity as (typeof DEFAULT_PACKAGE_ENTITIES)[number]),
  );
  const shouldExportSso = requestedEntities.includes('sso');

  await createEmptyPackageFiles(
    resolvedOutputDir,
    buildHandoffNotes({
      includeSso: shouldExportSso,
      includeSecrets: options.includeSecrets ?? false,
    }),
  );

  if (!options.quiet) {
    logger.info(`Writing Auth0 migration package to ${resolvedOutputDir}`);
  }

  const stats = createEmptyPackageStats();

  if (shouldExportIdentityEntities) {
    const identityStats = options.useMetadata
      ? await exportPackageUsersWithMetadata(client, resolvedOutputDir, options)
      : await exportPackageOrganizations(client, resolvedOutputDir, options);
    mergePackageStats(stats, identityStats);
  }

  if (shouldExportSso) {
    const ssoStats = await exportPackageSso(client, resolvedOutputDir, options);
    mergePackageStats(stats, ssoStats);
  }

  await writePackageJsonlRecords(resolvedOutputDir, 'warnings', stats.warnings);
  await writePackageJsonlRecords(resolvedOutputDir, 'skippedUsers', stats.skipped);

  const manifest = createMigrationPackageManifest({
    provider: 'auth0',
    sourceTenant: options.domain,
    generatedAt: new Date(),
    entitiesRequested: requestedEntities,
    entitiesExported: {
      users: stats.totalUsers,
      organizations: stats.totalOrgs,
      memberships: stats.totalMemberships,
      samlConnections: stats.samlConnections,
      oidcConnections: stats.oidcConnections,
      customAttributeMappings: stats.customAttributeMappings,
      proxyRoutes: stats.proxyRoutes,
      warnings: stats.warnings.length,
      skippedUsers: stats.skipped.length,
    },
    secretsRedacted: shouldExportSso ? !(options.includeSecrets ?? false) : true,
    secretRedaction: buildSecretRedactionMetadata(shouldExportSso, options.includeSecrets ?? false),
    warnings: stats.warnings.map((warning) => warning.message),
  });

  await writeMigrationPackageManifest(resolvedOutputDir, manifest);

  const duration = Date.now() - startTime;
  if (!options.quiet) {
    logger.success('\nPackage export complete');
    logger.info(`  Organizations: ${stats.totalOrgs}`);
    logger.info(`  Memberships: ${stats.totalMemberships}`);
    logger.info(`  User rows exported: ${stats.totalUsers}`);
    if (shouldExportSso) {
      logger.info(`  SAML connections: ${stats.samlConnections}`);
      logger.info(`  OIDC connections: ${stats.oidcConnections}`);
      logger.info(`  Proxy routes: ${stats.proxyRoutes}`);
    }
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

  const stats = createEmptyPackageStats();
  stats.totalOrgs = organizations.length;

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

  const stats = createEmptyPackageStats();
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

async function exportPackageSso(
  client: Auth0ExportClient,
  outputDir: string,
  options: Auth0ExportOptions,
): Promise<Auth0PackageStats> {
  if (!client.getConnections) {
    throw new Error('Auth0 SSO package export requires Management API connection support.');
  }

  const stats = createEmptyPackageStats();

  let connections: Auth0Connection[];
  try {
    connections = await fetchAllConnections(client, options.pageSize);
  } catch (error: unknown) {
    if (!isMissingConnectionOptionsScopeError(error)) throw error;
    addWarning(
      stats,
      'missing_connections_options_scope',
      'Auth0 SSO connection export was skipped because the Management API token is missing read:connections_options.',
    );
    await writeRawAuth0Connections(outputDir, [], options.includeSecrets ?? false);
    return stats;
  }

  const organizations = await fetchOrganizationsForSso(client, options);
  const orgBindingsByConnectionId = await fetchOrganizationConnectionBindings(
    client,
    organizations,
    options,
    stats,
  );

  const hydratedConnections = await hydrateSsoConnections(client, connections, stats);
  const samlRows: SamlRow[] = [];
  const oidcRows: OidcRow[] = [];
  const customAttributeRows: CustomAttrRow[] = [];
  const proxyRouteRows: ProxyRouteRow[] = [];
  const candidateConnections = hydratedConnections.filter(
    (connection) => !options.orgs || orgBindingsByConnectionId.has(connection.id),
  );

  for (const connection of candidateConnections) {
    const mapping = mapAuth0ConnectionToSsoHandoff({
      connection,
      domain: options.domain,
      orgBindings: orgBindingsByConnectionId.get(connection.id) ?? [],
      includeSecrets: options.includeSecrets ?? false,
    });

    for (const warning of mapping.warnings) {
      addSsoWarning(stats, warning);
    }

    if (mapping.status !== 'mapped') continue;

    if (mapping.samlRow) samlRows.push(mapping.samlRow);
    if (mapping.oidcRow) oidcRows.push(mapping.oidcRow);
    customAttributeRows.push(...mapping.customAttributeRows);
    proxyRouteRows.push(mapping.proxyRouteRow);
  }

  await Promise.all([
    writeSamlConnectionsCsv(getPackageFilePath(outputDir, 'samlConnections'), samlRows),
    writeOidcConnectionsCsv(getPackageFilePath(outputDir, 'oidcConnections'), oidcRows),
    writeCustomAttributeMappingsCsv(
      getPackageFilePath(outputDir, 'customAttributeMappings'),
      customAttributeRows,
    ),
    writeProxyRoutesCsv(getPackageFilePath(outputDir, 'proxyRoutes'), proxyRouteRows),
    writeRawAuth0Connections(outputDir, candidateConnections, options.includeSecrets ?? false),
  ]);

  stats.samlConnections = samlRows.length;
  stats.oidcConnections = oidcRows.length;
  stats.customAttributeMappings = customAttributeRows.length;
  stats.proxyRoutes = proxyRouteRows.length;

  if (!options.quiet) {
    logger.info(
      `Exported ${stats.samlConnections + stats.oidcConnections} SSO handoff connection row(s)`,
    );
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

async function fetchOrganizationsForSso(
  client: Auth0ExportClient,
  options: Auth0ExportOptions,
): Promise<Auth0Organization[]> {
  try {
    const organizations = await fetchAllOrganizations(client, options.pageSize);
    return options.orgs
      ? organizations.filter((organization) => options.orgs?.includes(organization.id))
      : organizations;
  } catch (error: unknown) {
    if (!options.quiet) {
      logger.warn(
        `Unable to fetch Auth0 organizations for SSO binding: ${(error as Error).message}`,
      );
    }
    return [];
  }
}

async function fetchAllConnections(
  client: Auth0ExportClient,
  pageSize: number,
): Promise<Auth0Connection[]> {
  if (!client.getConnections) return [];

  const connections: Auth0Connection[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const batch = await client.getConnections(page, pageSize);
    if (batch.length === 0) break;
    connections.push(...batch);
    hasMore = batch.length >= pageSize;
    page++;
  }

  return connections;
}

async function fetchOrganizationConnectionBindings(
  client: Auth0ExportClient,
  organizations: Auth0Organization[],
  options: Auth0ExportOptions,
  stats: Auth0PackageStats,
): Promise<Map<string, Auth0SsoConnectionOrgBinding[]>> {
  const bindings = new Map<string, Auth0SsoConnectionOrgBinding[]>();
  if (!client.getOrganizationConnections || organizations.length === 0) return bindings;

  for (const organization of organizations) {
    try {
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const orgConnections = await client.getOrganizationConnections(
          organization.id,
          page,
          options.pageSize,
        );
        if (orgConnections.length === 0) break;

        for (const organizationConnection of orgConnections) {
          const connectionId =
            organizationConnection.connection_id || organizationConnection.connection?.id;
          if (!connectionId) continue;
          const existing = bindings.get(connectionId) ?? [];
          existing.push({
            organization,
            organizationConnection,
          });
          bindings.set(connectionId, existing);
        }

        hasMore = orgConnections.length >= options.pageSize;
        page++;
      }
    } catch (error: unknown) {
      addWarning(
        stats,
        'org_connection_fetch_failed',
        `Failed to fetch enabled Auth0 connections for org ${organization.id}: ${
          (error as Error).message
        }`,
        organization,
      );
    }
  }

  return bindings;
}

async function hydrateSsoConnections(
  client: Auth0ExportClient,
  connections: Auth0Connection[],
  stats: Auth0PackageStats,
): Promise<Auth0Connection[]> {
  if (!client.getConnection) return connections;

  const hydrated: Auth0Connection[] = [];
  for (const connection of connections) {
    const protocol = classifyAuth0ConnectionProtocol(connection);
    if (protocol === 'unsupported' || hasReadableOptions(connection)) {
      hydrated.push(connection);
      continue;
    }

    try {
      hydrated.push(await client.getConnection(connection.id));
    } catch (error: unknown) {
      if (!isMissingConnectionOptionsScopeError(error)) throw error;
      addWarning(
        stats,
        'missing_connections_options_scope',
        `Auth0 connection ${connection.id} options could not be read because the token is missing read:connections_options.`,
        undefined,
        undefined,
        connection,
      );
      hydrated.push(connection);
    }
  }

  return hydrated;
}

function hasReadableOptions(connection: Auth0Connection): boolean {
  return Boolean(connection.options && Object.keys(connection.options).length > 0);
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

async function writeRawAuth0Connections(
  outputDir: string,
  connections: Auth0Connection[],
  includeSecrets: boolean,
): Promise<void> {
  const rawDir = path.join(outputDir, 'raw');
  await fs.mkdir(rawDir, { recursive: true });
  const records = connections.map((connection) =>
    includeSecrets ? connection : redactAuth0ConnectionSecrets(connection),
  );
  const contents = records.map((record) => JSON.stringify(record)).join('\n');
  await fs.writeFile(
    path.join(rawDir, 'auth0-connections.jsonl'),
    contents ? `${contents}\n` : '',
    'utf-8',
  );
}

function createEmptyPackageStats(): Auth0PackageStats {
  return {
    totalUsers: 0,
    totalOrgs: 0,
    totalMemberships: 0,
    samlConnections: 0,
    oidcConnections: 0,
    customAttributeMappings: 0,
    proxyRoutes: 0,
    skippedUsers: 0,
    warnings: [],
    skipped: [],
  };
}

function mergePackageStats(target: Auth0PackageStats, source: Auth0PackageStats): void {
  target.totalUsers += source.totalUsers;
  target.totalOrgs += source.totalOrgs;
  target.totalMemberships += source.totalMemberships;
  target.samlConnections += source.samlConnections;
  target.oidcConnections += source.oidcConnections;
  target.customAttributeMappings += source.customAttributeMappings;
  target.proxyRoutes += source.proxyRoutes;
  target.skippedUsers += source.skippedUsers;
  target.warnings.push(...source.warnings);
  target.skipped.push(...source.skipped);
}

function normalizeRequestedEntities(entities: string[] | undefined): string[] {
  const requested =
    entities && entities.length > 0
      ? entities.flatMap((entity) => entity.split(','))
      : [...DEFAULT_PACKAGE_ENTITIES];

  const normalized = [
    ...new Set(
      requested.map((entity) => entity.trim().toLowerCase()).filter((entity) => entity.length > 0),
    ),
  ];

  if (normalized.includes('all')) {
    return [...SUPPORTED_PACKAGE_ENTITIES];
  }

  for (const entity of normalized) {
    if (!SUPPORTED_PACKAGE_ENTITIES.has(entity)) {
      throw new Error(
        `Unsupported Auth0 package entity "${entity}". Supported entities: ${[
          ...SUPPORTED_PACKAGE_ENTITIES,
        ].join(', ')}`,
      );
    }
  }

  return normalized.length > 0 ? normalized : [...DEFAULT_PACKAGE_ENTITIES];
}

function buildSecretRedactionMetadata(
  includeSso: boolean,
  includeSecrets: boolean,
): SecretRedactionMetadata {
  if (!includeSso) {
    return {
      mode: 'not-applicable',
      redacted: true,
      notes: ['Auth0 package core does not export connection secrets or password hashes.'],
    };
  }

  if (includeSecrets) {
    return {
      mode: 'included',
      redacted: false,
      files: [
        'raw/auth0-connections.jsonl',
        'sso/oidc_connections.csv',
        'sso/saml_connections.csv',
      ],
      notes: ['Auth0 SSO connection secrets were included because --include-secrets was set.'],
    };
  }

  return {
    mode: 'redacted',
    redacted: true,
    redactedFields: [...AUTH0_REDACTED_SECRET_FIELDS],
    files: ['raw/auth0-connections.jsonl', 'sso/oidc_connections.csv', 'sso/saml_connections.csv'],
    notes: [
      'Auth0 SSO connection secrets are redacted by default. Re-run with --include-secrets only when the output directory can safely store secrets.',
    ],
  };
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
  connection?: Auth0Connection,
  details?: Record<string, unknown>,
): void {
  stats.warnings.push({
    timestamp: new Date().toISOString(),
    code,
    message,
    ...(org ? { org_id: org.id, org_name: org.display_name || org.name } : {}),
    ...(userId ? { user_id: userId } : {}),
    ...(connection
      ? { connection_id: connection.id, protocol: classifyAuth0ConnectionProtocol(connection) }
      : {}),
    ...(details ? { details } : {}),
  });
}

function addSsoWarning(stats: Auth0PackageStats, warning: SsoHandoffWarning): void {
  stats.warnings.push({
    timestamp: new Date().toISOString(),
    code: warning.code,
    message: warning.message,
    ...(warning.organizationExternalId ? { org_id: warning.organizationExternalId } : {}),
    ...(warning.importedId
      ? { connection_id: auth0ConnectionIdFromImportedId(warning.importedId) }
      : {}),
    ...(warning.protocol ? { protocol: warning.protocol } : {}),
    ...(warning.details ? { details: warning.details } : {}),
  });
}

function auth0ConnectionIdFromImportedId(importedId: string): string {
  return importedId.startsWith('auth0:') ? importedId.slice('auth0:'.length) : importedId;
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

function buildHandoffNotes(input: { includeSso: boolean; includeSecrets: boolean }): string {
  if (!input.includeSso) {
    return [
      '# Auth0 SSO handoff notes',
      '',
      'This package was generated without Auth0 SSO connection handoff files.',
      'Run package mode with --entities sso, or include sso in a comma-separated entity list, when SSO handoff is needed.',
      '',
    ].join('\n');
  }

  return [
    '# Auth0 SSO handoff notes',
    '',
    'Auth0 SSO export is handoff-only. The package writes SAML and OIDC connection CSVs for WorkOS/manual processing and does not create WorkOS SSO connections automatically.',
    'Auth0 enterprise strategies are inspected for SAML/OIDC configuration, and only connections with enough reliable handoff data are emitted. Database, passwordless, social, generic OAuth, non-SAML/OIDC enterprise, and incomplete connections are skipped with warnings.',
    'If one Auth0 connection is enabled for multiple Auth0 organizations, the exporter writes one handoff row with the union of source organization domains and a confirmation warning.',
    input.includeSecrets
      ? 'Connection secrets were included because --include-secrets was set.'
      : 'Connection secrets were redacted. Re-run with --include-secrets only if the output directory can safely store secrets.',
    '',
  ].join('\n');
}
