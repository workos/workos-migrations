import fs from 'node:fs/promises';
import path from 'node:path';
import { createCSVWriter } from '../shared/csv-utils.js';
import { MIGRATION_PACKAGE_FILES, MIGRATION_PACKAGE_CSV_HEADERS, createMigrationPackageManifest, isMigrationPackageCsvFileKey, } from './manifest.js';
export async function createMigrationPackage(options) {
    const manifest = createMigrationPackageManifest(options);
    await fs.mkdir(options.rootDir, { recursive: true });
    await fs.mkdir(path.join(options.rootDir, 'sso'), { recursive: true });
    if (options.createEmptyFiles ?? true) {
        await createEmptyPackageFiles(options.rootDir, options.handoffNotes);
    }
    await writeMigrationPackageManifest(options.rootDir, manifest);
    return {
        rootDir: options.rootDir,
        manifest,
        files: resolvePackageFiles(options.rootDir),
    };
}
export async function loadMigrationPackage(rootDir) {
    const manifestPath = getPackageFilePath(rootDir, 'manifest');
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);
    return {
        rootDir,
        manifest,
        files: resolvePackageFiles(rootDir),
    };
}
export async function writeMigrationPackageManifest(rootDir, manifest) {
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(getPackageFilePath(rootDir, 'manifest'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}
export async function writePackageCsvRows(rootDir, fileKey, rows, headers = MIGRATION_PACKAGE_CSV_HEADERS[fileKey]) {
    const filePath = getPackageFilePath(rootDir, fileKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const writer = createCSVWriter(filePath, [...headers]);
    for (const row of rows) {
        writer.write(normalizeCsvRow(row, headers));
    }
    await writer.end();
    return rows.length;
}
export async function writePackageJsonlRecords(rootDir, fileKey, records) {
    const filePath = getPackageFilePath(rootDir, fileKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const contents = records.map((record) => JSON.stringify(record)).join('\n');
    await fs.writeFile(filePath, contents ? `${contents}\n` : '', 'utf-8');
    return records.length;
}
export async function createEmptyPackageFiles(rootDir, handoffNotes = '# SSO handoff notes\n\nNo SSO handoff notes were generated.\n') {
    await Promise.all(Object.entries(MIGRATION_PACKAGE_CSV_HEADERS).map(async ([key, headers]) => {
        if (!isMigrationPackageCsvFileKey(key))
            return;
        const filePath = getPackageFilePath(rootDir, key);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, `${headers.join(',')}\n`, 'utf-8');
    }));
    await Promise.all([
        writePackageJsonlRecords(rootDir, 'warnings', []),
        writePackageJsonlRecords(rootDir, 'skippedUsers', []),
        fs.writeFile(getPackageFilePath(rootDir, 'handoffNotes'), handoffNotes, 'utf-8'),
    ]);
}
export function getPackageFilePath(rootDir, fileKey) {
    return path.join(rootDir, MIGRATION_PACKAGE_FILES[fileKey]);
}
export function resolvePackageFiles(rootDir) {
    return Object.fromEntries(Object.keys(MIGRATION_PACKAGE_FILES).map((key) => [
        key,
        getPackageFilePath(rootDir, key),
    ]));
}
function normalizeCsvRow(row, headers) {
    const normalized = {};
    for (const header of headers) {
        const value = row[header];
        if (value === undefined || value === null) {
            normalized[header] = '';
        }
        else if (typeof value === 'boolean') {
            normalized[header] = value ? 'true' : 'false';
        }
        else {
            normalized[header] = String(value);
        }
    }
    return normalized;
}
