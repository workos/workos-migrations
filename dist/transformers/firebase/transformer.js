import { readFileSync, createWriteStream } from 'node:fs';
import { stringify } from 'csv-stringify';
import { loadOrgMapping, applyOrgMapping, buildOutputColumns } from '../shared/org-mapper.js';
import { loadRoleMapping } from '../shared/role-mapper.js';
import { encodeFirebaseScryptPHC } from './scrypt.js';
import * as logger from '../../shared/logger.js';
/**
 * Split a display name into first and last name using the given strategy.
 */
export function splitDisplayName(displayName, strategy) {
    if (!displayName?.trim()) {
        return { firstName: '', lastName: '' };
    }
    const name = displayName.trim();
    switch (strategy) {
        case 'first-space': {
            const idx = name.indexOf(' ');
            if (idx === -1)
                return { firstName: name, lastName: '' };
            return { firstName: name.slice(0, idx), lastName: name.slice(idx + 1) };
        }
        case 'last-space': {
            const idx = name.lastIndexOf(' ');
            if (idx === -1)
                return { firstName: name, lastName: '' };
            return { firstName: name.slice(0, idx), lastName: name.slice(idx + 1) };
        }
        case 'first-name-only':
            return { firstName: name, lastName: '' };
        default:
            return { firstName: name, lastName: '' };
    }
}
function msEpochToISO(msString) {
    const ms = parseInt(msString, 10);
    if (isNaN(ms))
        return undefined;
    return new Date(ms).toISOString();
}
/**
 * Map a Firebase user record to WorkOS CSV format.
 */
function mapFirebaseUser(user, nameSplitStrategy, scryptConfig, includeDisabled, skipPasswords, orgMapping) {
    const warnings = [];
    const email = user.email?.trim();
    if (!email) {
        return { csvRow: {}, warnings: [], skipped: true, skipReason: 'Missing email address' };
    }
    if (user.disabled && !includeDisabled) {
        return { csvRow: {}, warnings: [], skipped: true, skipReason: 'User is disabled' };
    }
    const { firstName, lastName } = splitDisplayName(user.displayName, nameSplitStrategy);
    // Map password hash
    let passwordHash;
    let passwordHashType;
    if (!skipPasswords && user.passwordHash && user.salt) {
        if (scryptConfig) {
            passwordHash = encodeFirebaseScryptPHC({ passwordHash: user.passwordHash, salt: user.salt }, scryptConfig);
            passwordHashType = 'firebase-scrypt';
        }
        else {
            warnings.push(`No scrypt parameters provided for user ${user.localId} — password skipped`);
        }
    }
    // Build metadata
    const metadata = {};
    if (user.localId?.trim())
        metadata.firebase_uid = user.localId.trim();
    if (user.phoneNumber?.trim())
        metadata.phone_number = user.phoneNumber.trim();
    if (user.photoUrl?.trim())
        metadata.photo_url = user.photoUrl.trim();
    if (user.customAttributes?.trim()) {
        try {
            metadata.custom_attributes = JSON.parse(user.customAttributes);
        }
        catch {
            metadata.custom_attributes = user.customAttributes.trim();
        }
    }
    if (user.providerUserInfo?.length)
        metadata.provider_info = user.providerUserInfo;
    if (user.mfaInfo?.length)
        metadata.mfa_info = user.mfaInfo;
    if (user.createdAt) {
        const iso = msEpochToISO(user.createdAt);
        if (iso)
            metadata.created_at = iso;
    }
    if (user.lastSignedInAt) {
        const iso = msEpochToISO(user.lastSignedInAt);
        if (iso)
            metadata.last_signed_in_at = iso;
    }
    if (user.disabled && includeDisabled)
        metadata.disabled = true;
    const csvRow = {
        email,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        email_verified: user.emailVerified === true ? 'true' : 'false',
        external_id: user.localId?.trim() || undefined,
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
 * Parse Firebase JSON export and return users array.
 */
function parseFirebaseExport(filePath) {
    const raw = readFileSync(filePath, 'utf8');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error(`Invalid JSON in Firebase export file: ${filePath}`);
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Firebase export must be a JSON object with a "users" array');
    }
    const data = parsed;
    if (!Array.isArray(data.users)) {
        throw new Error(`Firebase export must have a "users" array at the top level. Found keys: ${Object.keys(data).join(', ')}`);
    }
    return data.users;
}
/**
 * Transform a Firebase Auth JSON export to WorkOS-compatible CSV format.
 */
export async function transformFirebaseExport(options) {
    const { input, output, scryptConfig, nameSplitStrategy, includeDisabled, skipPasswords, quiet } = options;
    if (!quiet)
        logger.info('Parsing Firebase JSON export...');
    const users = parseFirebaseExport(input);
    if (!quiet)
        logger.info(`  Found ${users.length} users\n`);
    // Load org mapping if provided
    let orgMap = null;
    if (options.orgMapping) {
        if (!quiet)
            logger.info('Loading org mapping...');
        orgMap = await loadOrgMapping(options.orgMapping, { userIdColumn: 'firebase_uid', quiet });
        if (!quiet)
            logger.info(`  Loaded ${orgMap.size} org mapping entries\n`);
    }
    // Load role mapping if provided
    let roleMap = null;
    if (options.roleMapping) {
        if (!quiet)
            logger.info('Loading role mapping...');
        roleMap = await loadRoleMapping(options.roleMapping, { userIdColumn: 'firebase_uid', quiet });
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
        const outputStream = createWriteStream(output);
        const stringifier = stringify({ header: true, columns: outputColumns });
        // Pipe must be set up BEFORE writing data
        stringifier
            .pipe(outputStream)
            .on('finish', () => {
            skippedStream.end();
            resolve(summary);
        })
            .on('error', (err) => {
            skippedStream.end();
            reject(err);
        });
        for (const user of users) {
            summary.totalUsers++;
            const uid = user.localId?.trim();
            const userOrg = uid && orgMap ? orgMap.get(uid) : undefined;
            const result = mapFirebaseUser(user, nameSplitStrategy, scryptConfig, includeDisabled, skipPasswords, userOrg);
            if (result.skipped) {
                summary.skippedUsers++;
                const reason = result.skipReason || 'unknown';
                summary.skippedReasons[reason] = (summary.skippedReasons[reason] || 0) + 1;
                logSkipped(skippedStream, uid, user.email, reason);
                continue;
            }
            for (const w of result.warnings) {
                if (w.includes('No scrypt parameters')) {
                    const reason = 'no scrypt params (user imported, password skipped)';
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
            if (roleMap && uid) {
                const roleSlugs = roleMap.get(uid);
                if (roleSlugs?.length) {
                    result.csvRow.role_slugs = roleSlugs.join(',');
                    summary.usersWithRoleMapping++;
                }
            }
            stringifier.write(result.csvRow);
            if (!quiet && summary.totalUsers % 1000 === 0) {
                logger.info(`  Processed ${summary.totalUsers} users (${summary.transformedUsers} transformed)...`);
            }
        }
        stringifier.end();
        if (!quiet && summary.totalUsers >= 1000) {
            logger.info('');
        }
    });
}
function logSkipped(stream, userId, email, reason) {
    stream.write(JSON.stringify({
        firebase_uid: userId ?? 'unknown',
        email: email ?? 'unknown',
        reason,
    }) + '\n');
}
