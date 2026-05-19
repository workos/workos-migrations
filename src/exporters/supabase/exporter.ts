import type { ExportSummary, SupabaseExportOptions } from '../../shared/types.js';
import * as logger from '../../shared/logger.js';
import { SupabaseAdminClient } from './admin-api-client.js';
import { SupabasePgClient } from './pg-client.js';
import { mapSupabaseUser } from './user-mapper.js';
import { exportMfaFactors } from './mfa-mapper.js';
import { exportSamlProviders } from './sso-mapper.js';
import { exportOrganizations } from './org-mapper.js';
import { loadRoleSlugMap, type RoleSlugMap } from './role-slug-map.js';
import { openSupabasePackage, type SupabaseWriterContext } from './package-writer.js';
import type { SupabasePgQueryClient } from './pg-client.js';

const SUPPORTED_ENTITIES = new Set(['users', 'identities', 'mfa', 'sso', 'organizations']);
const PG_ENTITIES = new Set(['mfa', 'sso', 'organizations']);

export interface ExportSupabaseInternal extends SupabaseExportOptions {
  /** Test seam — replace the Postgres client used for mfa/sso exports. */
  pgClientFactory?: (dbUrl: string) => SupabasePgQueryClient;
}

export async function exportSupabase(options: ExportSupabaseInternal): Promise<ExportSummary> {
  if (!options.outputDir) {
    throw new Error('--output-dir is required for Supabase package export');
  }

  const requested = options.entities.length > 0 ? options.entities : ['users'];
  const unsupported = requested.filter((entity) => !SUPPORTED_ENTITIES.has(entity));
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported entities for Supabase export: ${unsupported.join(', ')}. Supported: users, identities, mfa, sso, organizations.`,
    );
  }

  // Fail fast on a bad role-slug-map path — before opening any network connection.
  const roleSlugMap = await maybeLoadRoleSlugMap(options);

  const client = new SupabaseAdminClient({
    url: options.url,
    serviceRoleKey: options.serviceRoleKey,
    rateLimit: options.rateLimit,
    pageSize: options.pageSize,
  });

  if (!options.quiet) logger.info('Connecting to Supabase Admin API...');

  const connectionTest = await client.testConnection();
  if (!connectionTest.success) {
    throw new Error(`Supabase connection failed: ${connectionTest.error}`);
  }

  if (!options.quiet) logger.success('Connected to Supabase');

  const startTime = Date.now();
  const pkg = await openSupabasePackage(options.outputDir);

  await exportUsers(client, pkg, options);
  await exportPgEntities(pkg, options, requested, roleSlugMap);

  await pkg.finalize({ url: options.url, entitiesRequested: requested });

  const duration = Date.now() - startTime;

  if (!options.quiet) {
    logger.success(`\nExport complete`);
    logger.info(`  Total fetched: ${pkg.stats.totalFetched}`);
    logger.info(`  Exported: ${pkg.stats.exported}`);
    logger.info(`  Skipped: ${pkg.stats.skipped}`);
    if (pkg.stats.totpExported > 0) logger.info(`  TOTP factors: ${pkg.stats.totpExported}`);
    if (pkg.stats.samlExported > 0) logger.info(`  SAML providers: ${pkg.stats.samlExported}`);
    if (pkg.stats.orgsExported > 0) logger.info(`  Organizations: ${pkg.stats.orgsExported}`);
    if (pkg.stats.membershipsExported > 0)
      logger.info(`  Memberships: ${pkg.stats.membershipsExported}`);
    logger.info(`  Warnings: ${pkg.stats.warnings.length}`);
    logger.info(`  Duration: ${duration}ms`);
    logger.info(`  Output: ${pkg.rootDir}`);
  }

  return {
    totalUsers: pkg.stats.exported,
    totalOrgs: 0,
    skippedUsers: pkg.stats.skipped,
    duration,
  };
}

async function exportUsers(
  client: SupabaseAdminClient,
  pkg: SupabaseWriterContext,
  options: SupabaseExportOptions,
): Promise<void> {
  const iterator = client.listUsers({
    onDuplicate: (userId) => {
      pkg.stats.warnings.push(`Duplicate user.id encountered during pagination: ${userId}`);
    },
    onMalformedUser: (warning) => {
      pkg.stats.warnings.push(warning);
    },
  });

  for await (const user of iterator) {
    pkg.stats.totalFetched++;
    const mapped = mapSupabaseUser(user);

    if (mapped.warnings.length > 0) pkg.stats.warnings.push(...mapped.warnings);

    if (mapped.skipped) {
      pkg.stats.skipped++;
      pkg.stats.skippedRecords.push({
        supabase_uid: user.id,
        email: user.email ?? '',
        reason: mapped.skipReason ?? 'unknown',
      });
      continue;
    }

    pkg.writeUser(mapped.csvRow);
    pkg.stats.exported++;

    if (!options.quiet && pkg.stats.totalFetched % 1000 === 0) {
      logger.info(`  Processed ${pkg.stats.totalFetched} users (${pkg.stats.exported} exported)`);
    }
  }
}

async function maybeLoadRoleSlugMap(
  options: ExportSupabaseInternal,
): Promise<RoleSlugMap | undefined> {
  const path = options.orgSchema?.roleSlugMapPath;
  if (!path) return undefined;
  try {
    return await loadRoleSlugMap(path);
  } catch (error: unknown) {
    throw new Error(`Failed to load --role-slug-map ${path}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

async function exportPgEntities(
  pkg: SupabaseWriterContext,
  options: ExportSupabaseInternal,
  requested: string[],
  roleSlugMap: RoleSlugMap | undefined,
): Promise<void> {
  const pgRequested = requested.filter((entity) => PG_ENTITIES.has(entity));
  if (pgRequested.length === 0) return;

  if (!options.dbUrl) {
    pkg.stats.warnings.push(
      `Requested entities ${pgRequested.join(', ')} require --db-url; skipping (users.csv still produced).`,
    );
    return;
  }

  if (!options.quiet) logger.info('Connecting to Supabase Postgres...');

  const pg: SupabasePgQueryClient = options.pgClientFactory
    ? options.pgClientFactory(options.dbUrl)
    : new SupabasePgClient({ connectionString: options.dbUrl });
  if (pg.poolerWarning) pkg.stats.warnings.push(pg.poolerWarning);

  try {
    try {
      await pg.testConnection();
    } catch (error: unknown) {
      pkg.stats.warnings.push(
        `Supabase Postgres connection failed: ${(error as Error).message}. mfa/sso export skipped.`,
      );
      return;
    }

    if (!options.quiet) logger.success('Connected to Supabase Postgres');

    if (requested.includes('mfa')) {
      if (!options.quiet) logger.info('  Exporting MFA factors...');
      const mfa = await exportMfaFactors(pg, { totpIssuer: options.totpIssuer });
      if (mfa.warnings.length > 0) pkg.stats.warnings.push(...mfa.warnings);
      await pkg.writeTotpRecords(mfa.records);
    }

    if (requested.includes('sso')) {
      if (!options.quiet) logger.info('  Exporting SAML SSO providers...');
      const saml = await exportSamlProviders(pg);
      if (saml.warnings.length > 0) pkg.stats.warnings.push(...saml.warnings);
      await pkg.writeSamlConnections(saml.rows);
    }

    if (requested.includes('organizations')) {
      await runOrganizationsExport(pg, pkg, options, roleSlugMap);
    }
  } finally {
    await pg.close();
  }
}

async function runOrganizationsExport(
  pg: SupabasePgQueryClient,
  pkg: SupabaseWriterContext,
  options: ExportSupabaseInternal,
  roleSlugMap: RoleSlugMap | undefined,
): Promise<void> {
  if (!options.orgSchema) {
    pkg.stats.warnings.push(
      'Requested entity "organizations" but no org schema flags supplied; pass --org-table, --org-members-table, etc. Organizations export skipped.',
    );
    return;
  }

  if (!options.quiet) logger.info('  Exporting organizations...');

  const result = await exportOrganizations(pg, options.orgSchema, roleSlugMap);
  if (result.warnings.length > 0) pkg.stats.warnings.push(...result.warnings);
  pkg.stats.orphanMemberships += result.orphanCount;

  await pkg.writeOrganizations(result.organizationRows);
  await pkg.writeMemberships(result.membershipRows);
}
