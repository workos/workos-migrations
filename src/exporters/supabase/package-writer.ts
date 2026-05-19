import path from 'node:path';
import { createCSVWriter } from '../../shared/csv-utils.js';
import {
  USER_CSV_HEADERS,
  TOTP_SECRET_CSV_HEADERS,
  createMigrationPackageManifest,
} from '../../package/manifest.js';
import {
  createEmptyPackageFiles,
  getPackageFilePath,
  writeMigrationPackageManifest,
  writePackageCsvRows,
  writePackageJsonlRecords,
} from '../../package/writer.js';
import type { CsvRow as PackageCsvRow } from '../../package/writer.js';
import { writeSamlConnectionsCsv, type SamlRowInput } from '../../sso/handoff.js';
import type { CSVRow, TotpRecord } from '../../shared/types.js';
import type { SupabaseExportStats } from './types.js';

export interface SupabaseWriterContext {
  rootDir: string;
  stats: SupabaseExportStats;
  writeUser: (row: CSVRow) => void;
  writeTotpRecords: (records: TotpRecord[]) => Promise<void>;
  writeSamlConnections: (rows: SamlRowInput[]) => Promise<void>;
  finalize: (options: { url: string; entitiesRequested: string[] }) => Promise<void>;
}

function normalizeUserRow(row: CSVRow): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const header of USER_CSV_HEADERS) {
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

export async function openSupabasePackage(outputDir: string): Promise<SupabaseWriterContext> {
  const rootDir = path.resolve(outputDir);
  await createEmptyPackageFiles(rootDir);

  const usersWriter = createCSVWriter(getPackageFilePath(rootDir, 'users'), [...USER_CSV_HEADERS]);

  const stats: SupabaseExportStats = {
    totalFetched: 0,
    exported: 0,
    skipped: 0,
    totpExported: 0,
    samlExported: 0,
    warnings: [],
    skippedRecords: [],
  };

  return {
    rootDir,
    stats,
    writeUser(row: CSVRow) {
      usersWriter.write(normalizeUserRow(row));
    },
    async writeTotpRecords(records: TotpRecord[]) {
      if (records.length === 0) return;
      const rows: PackageCsvRow[] = records.map((record) => ({
        email: record.email,
        totp_secret: record.totpSecret,
        totp_issuer: record.totpIssuer ?? '',
        totp_user: record.totpUser ?? record.email,
      }));
      await writePackageCsvRows(rootDir, 'totpSecrets', rows, TOTP_SECRET_CSV_HEADERS);
      stats.totpExported += records.length;
    },
    async writeSamlConnections(rows: SamlRowInput[]) {
      if (rows.length === 0) return;
      const filePath = getPackageFilePath(rootDir, 'samlConnections');
      await writeSamlConnectionsCsv(filePath, rows);
      stats.samlExported += rows.length;
    },
    async finalize(options) {
      await usersWriter.end();

      await writePackageJsonlRecords(rootDir, 'warnings', stats.warnings);
      await writePackageJsonlRecords(rootDir, 'skippedUsers', stats.skippedRecords);

      const manifest = createMigrationPackageManifest({
        provider: 'supabase',
        sourceTenant: options.url,
        entitiesRequested: options.entitiesRequested,
        entitiesExported: {
          users: stats.exported,
          organizations: 0,
          memberships: 0,
          roleDefinitions: 0,
          userRoleAssignments: 0,
          totpSecrets: stats.totpExported,
          samlConnections: stats.samlExported,
          oidcConnections: 0,
          customAttributeMappings: 0,
          proxyRoutes: 0,
          uploadUsers: 0,
          uploadOrganizations: 0,
          uploadMemberships: 0,
          warnings: stats.warnings.length,
          skippedUsers: stats.skippedRecords.length,
        },
        warnings: stats.warnings,
      });

      await writeMigrationPackageManifest(rootDir, manifest);
    },
  };
}
