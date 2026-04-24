import fs from 'node:fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
/**
 * Stream-parse a CSV file row by row. Returns an async iterable of CSVRow objects.
 * Memory-efficient: only one row in memory at a time.
 */
export function streamCSV(filePath) {
    const parser = fs.createReadStream(filePath, { encoding: 'utf-8' }).pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
    }));
    return parser;
}
/**
 * Count the total number of data rows in a CSV file (excluding header).
 */
export async function countCSVRows(filePath) {
    let count = 0;
    for await (const _row of streamCSV(filePath)) {
        count++;
    }
    return count;
}
/**
 * Create a streaming CSV writer. Call write() for each row, then end().
 */
export function createCSVWriter(filePath, columns) {
    const stringifier = stringify({ header: true, columns });
    const output = fs.createWriteStream(filePath);
    stringifier.pipe(output);
    return {
        write(row) {
            stringifier.write(row);
        },
        end() {
            return new Promise((resolve, reject) => {
                stringifier.end();
                output.on('finish', resolve);
                output.on('error', reject);
            });
        },
    };
}
/**
 * Parse a metadata JSON string into a Record<string, string>.
 * Returns undefined if the input is empty or not valid JSON.
 */
export function parseMetadata(raw) {
    if (!raw || raw.trim() === '')
        return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return undefined;
        }
        const result = {};
        for (const [key, value] of Object.entries(parsed)) {
            result[key] = typeof value === 'string' ? value : JSON.stringify(value);
        }
        return result;
    }
    catch {
        return undefined;
    }
}
/**
 * Parse a boolean-like CSV value. Accepts true/false/yes/no/1/0 (case-insensitive).
 */
export function parseBooleanField(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value === 'boolean')
        return value;
    const lower = String(value).toLowerCase().trim();
    if (lower === 'true' || lower === 'yes' || lower === '1')
        return true;
    if (lower === 'false' || lower === 'no' || lower === '0')
        return false;
    return undefined;
}
/**
 * Parse role slugs from a CSV field. Supports comma-separated or JSON array format.
 */
export function parseRoleSlugs(value) {
    if (!value || value.trim() === '')
        return undefined;
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed))
                return parsed.map(String);
        }
        catch {
            // Fall through to comma-separated
        }
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}
/**
 * Convert a CSVRow to a UserRecord (parsed and normalized).
 */
export function csvRowToUserRecord(row) {
    return {
        email: row.email?.trim() ?? '',
        firstName: row.first_name?.trim() || undefined,
        lastName: row.last_name?.trim() || undefined,
        emailVerified: parseBooleanField(row.email_verified),
        externalId: row.external_id?.trim() || undefined,
        passwordHash: row.password_hash?.trim() || undefined,
        passwordHashType: (row.password_hash_type?.trim() || undefined),
        password: row.password?.trim() || undefined,
        metadata: parseMetadata(row.metadata),
        orgId: row.org_id?.trim() || undefined,
        orgExternalId: row.org_external_id?.trim() || undefined,
        orgName: row.org_name?.trim() || undefined,
        roleSlugs: parseRoleSlugs(row.role_slugs),
    };
}
