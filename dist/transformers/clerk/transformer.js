import { createReadStream, createWriteStream } from 'node:fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import { loadOrgMapping, applyOrgMapping, buildOutputColumns } from '../shared/org-mapper.js';
import { loadRoleMapping } from '../shared/role-mapper.js';
import * as logger from '../../shared/logger.js';
/**
 * Map a Clerk CSV row to WorkOS CSV format.
 */
function mapClerkUser(row, orgMapping) {
    const warnings = [];
    const email = row.primary_email_address?.trim();
    if (!email) {
        return {
            csvRow: {},
            warnings: [],
            skipped: true,
            skipReason: 'Missing primary_email_address',
        };
    }
    // Password: bcrypt only
    let passwordHash;
    let passwordHashType;
    const hasher = row.password_hasher?.trim().toLowerCase();
    const digest = row.password_digest?.trim();
    if (digest && hasher) {
        if (hasher === 'bcrypt') {
            passwordHash = digest;
            passwordHashType = 'bcrypt';
        }
        else {
            warnings.push(`Unsupported password hasher "${row.password_hasher}" for user ${row.id} — password skipped`);
        }
    }
    // Build metadata from extra Clerk fields
    const metadata = {};
    if (row.id?.trim())
        metadata.clerk_user_id = row.id.trim();
    if (row.username?.trim())
        metadata.username = row.username.trim();
    if (row.primary_phone_number?.trim())
        metadata.primary_phone_number = row.primary_phone_number.trim();
    if (row.verified_phone_numbers?.trim())
        metadata.verified_phone_numbers = row.verified_phone_numbers.trim();
    if (row.unverified_phone_numbers?.trim())
        metadata.unverified_phone_numbers = row.unverified_phone_numbers.trim();
    if (row.verified_email_addresses?.trim())
        metadata.verified_email_addresses = row.verified_email_addresses.trim();
    if (row.unverified_email_addresses?.trim())
        metadata.unverified_email_addresses = row.unverified_email_addresses.trim();
    if (row.totp_secret?.trim())
        metadata.totp_secret = row.totp_secret.trim();
    const csvRow = {
        email,
        first_name: row.first_name?.trim() || undefined,
        last_name: row.last_name?.trim() || undefined,
        email_verified: 'true',
        external_id: row.id?.trim() || undefined,
        password_hash: passwordHash,
        password_hash_type: passwordHashType,
        metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : undefined,
    };
    if (orgMapping) {
        applyOrgMapping(csvRow, orgMapping);
    }
    return { csvRow, warnings, skipped: false };
}
/**
 * Transform a Clerk CSV export to WorkOS-compatible CSV format.
 */
export async function transformClerkExport(options) {
    const { input, output, quiet } = options;
    // Load org mapping if provided
    let orgMap = null;
    if (options.orgMapping) {
        if (!quiet)
            logger.info('Loading org mapping...');
        orgMap = await loadOrgMapping(options.orgMapping, { userIdColumn: 'clerk_user_id', quiet });
        if (!quiet)
            logger.info(`  Loaded ${orgMap.size} org mapping entries\n`);
    }
    // Load role mapping if provided
    let roleMap = null;
    if (options.roleMapping) {
        if (!quiet)
            logger.info('Loading role mapping...');
        roleMap = await loadRoleMapping(options.roleMapping, { userIdColumn: 'clerk_user_id', quiet });
        if (!quiet)
            logger.info('');
    }
    const outputColumns = buildOutputColumns(orgMap, roleMap);
    const summary = {
        totalUsers: 0,
        transformedUsers: 0,
        skippedUsers: 0,
        usersWithPasswords: 0,
        usersWithoutPasswords: 0,
        usersWithOrgMapping: 0,
        usersWithoutOrgMapping: 0,
        usersWithRoleMapping: 0,
        skippedReasons: {},
    };
    const skippedPath = output.replace('.csv', '-skipped.jsonl');
    const skippedStream = createWriteStream(skippedPath, { encoding: 'utf-8' });
    return new Promise((resolve, reject) => {
        let headerValidated = false;
        const inputStream = createReadStream(input);
        const outputStream = createWriteStream(output);
        const parser = parse({
            columns: true,
            skip_empty_lines: true,
            relax_column_count: true,
            trim: true,
        });
        const stringifier = stringify({ header: true, columns: outputColumns });
        // Pipe must be set up BEFORE writing data
        stringifier
            .pipe(outputStream)
            .on('finish', () => {
            skippedStream.end();
            if (summary.totalUsers === 0) {
                reject(new Error('No users found in Clerk CSV'));
                return;
            }
            resolve(summary);
        })
            .on('error', (err) => {
            skippedStream.end();
            reject(err);
        });
        inputStream
            .pipe(parser)
            .on('data', (row) => {
            if (!headerValidated) {
                headerValidated = true;
                const headers = Object.keys(row);
                if (!headers.includes('primary_email_address')) {
                    reject(new Error(`Clerk CSV must have a 'primary_email_address' column. Found columns: ${headers.join(', ')}`));
                    return;
                }
                if (!headers.includes('id')) {
                    reject(new Error(`Clerk CSV must have an 'id' column. Found columns: ${headers.join(', ')}`));
                    return;
                }
            }
            summary.totalUsers++;
            const clerkUserId = row.id?.trim();
            const userOrg = clerkUserId && orgMap ? orgMap.get(clerkUserId) : undefined;
            const result = mapClerkUser(row, userOrg);
            if (result.skipped) {
                summary.skippedUsers++;
                const reason = result.skipReason || 'unknown';
                summary.skippedReasons[reason] = (summary.skippedReasons[reason] || 0) + 1;
                logSkipped(skippedStream, clerkUserId, row.primary_email_address, reason);
                return;
            }
            for (const w of result.warnings) {
                if (w.includes('Unsupported password hasher')) {
                    const reason = 'non-bcrypt password (user imported, password skipped)';
                    summary.skippedReasons[reason] = (summary.skippedReasons[reason] || 0) + 1;
                }
            }
            summary.transformedUsers++;
            if (result.csvRow.password_hash) {
                summary.usersWithPasswords++;
            }
            else {
                summary.usersWithoutPasswords++;
            }
            if (userOrg) {
                summary.usersWithOrgMapping++;
            }
            else {
                summary.usersWithoutOrgMapping++;
            }
            // Merge role slugs
            if (roleMap && clerkUserId) {
                const roleSlugs = roleMap.get(clerkUserId);
                if (roleSlugs?.length) {
                    result.csvRow.role_slugs = roleSlugs.join(',');
                    summary.usersWithRoleMapping++;
                }
            }
            stringifier.write(result.csvRow);
            if (!quiet && summary.totalUsers % 1000 === 0) {
                logger.info(`  Processed ${summary.totalUsers} users (${summary.transformedUsers} transformed)...`);
            }
        })
            .on('end', () => {
            stringifier.end();
        })
            .on('error', (err) => {
            skippedStream.end();
            reject(err);
        });
    });
}
function logSkipped(stream, userId, email, reason) {
    stream.write(JSON.stringify({
        clerk_user_id: userId ?? 'unknown',
        email: email ?? 'unknown',
        reason,
    }) + '\n');
}
