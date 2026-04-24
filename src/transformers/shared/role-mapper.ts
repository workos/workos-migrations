import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import * as logger from '../../shared/logger.js';

export interface LoadRoleMappingOptions {
  userIdColumn: string;
  quiet?: boolean;
}

/**
 * Load role mapping CSV into a lookup Map keyed by user ID.
 * The user ID column name is configurable (e.g. 'clerk_user_id', 'firebase_uid').
 * Returns a map of user_id -> [role_slugs] (supports multi-role per user).
 */
export async function loadRoleMapping(
  filePath: string,
  options: LoadRoleMappingOptions,
): Promise<Map<string, string[]>> {
  const { userIdColumn, quiet } = options;
  const lookup = new Map<string, string[]>();

  return new Promise((resolve, reject) => {
    let headerValidated = false;

    const inputStream = createReadStream(filePath);
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    inputStream
      .pipe(parser)
      .on('data', (row: Record<string, string>) => {
        if (!headerValidated) {
          headerValidated = true;
          const headers = Object.keys(row);

          const hasJoinKey = headers.includes(userIdColumn) || headers.includes('external_id');
          if (!hasJoinKey) {
            reject(
              new Error(
                `Role mapping CSV must have a '${userIdColumn}' or 'external_id' column. ` +
                  `Found columns: ${headers.join(', ')}`,
              ),
            );
            return;
          }

          if (!headers.includes('role_slug')) {
            reject(
              new Error(
                `Role mapping CSV must have a 'role_slug' column. ` +
                  `Found columns: ${headers.join(', ')}`,
              ),
            );
            return;
          }
        }

        const userId = (row[userIdColumn]?.trim() || row.external_id?.trim()) ?? '';
        const roleSlug = row.role_slug?.trim() ?? '';
        if (!userId || !roleSlug) return;

        const existing = lookup.get(userId);
        if (existing) {
          if (!existing.includes(roleSlug)) {
            existing.push(roleSlug);
          }
        } else {
          lookup.set(userId, [roleSlug]);
        }
      })
      .on('end', () => {
        if (!quiet) {
          logger.info(`  Loaded ${lookup.size} user role mappings`);
        }
        resolve(lookup);
      })
      .on('error', reject);
  });
}
