import type { ExportSummary, SupabaseExportOptions } from '../../shared/types.js';
import * as logger from '../../shared/logger.js';
import { SupabaseAdminClient } from './admin-api-client.js';
import { mapSupabaseUser } from './user-mapper.js';
import { openSupabasePackage } from './package-writer.js';

const PHASE_1_ALLOWED_ENTITIES = new Set(['users', 'identities']);

export async function exportSupabase(options: SupabaseExportOptions): Promise<ExportSummary> {
  if (!options.outputDir) {
    throw new Error('--output-dir is required for Supabase package export');
  }

  const requested = options.entities.length > 0 ? options.entities : ['users'];
  const unsupported = requested.filter((entity) => !PHASE_1_ALLOWED_ENTITIES.has(entity));
  if (unsupported.length > 0) {
    throw new Error(
      `Phase 1 supports only 'users' and 'identities' entities; unsupported: ${unsupported.join(
        ', ',
      )}. MFA, SSO, and organizations land in later phases.`,
    );
  }

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

  await pkg.finalize({ url: options.url, entitiesRequested: requested });

  const duration = Date.now() - startTime;

  if (!options.quiet) {
    logger.success(`\nExport complete`);
    logger.info(`  Total fetched: ${pkg.stats.totalFetched}`);
    logger.info(`  Exported: ${pkg.stats.exported}`);
    logger.info(`  Skipped: ${pkg.stats.skipped}`);
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
