import { type CreateMigrationPackageManifestOptions, type MigrationPackageCsvFileKey, type MigrationPackageFileKey, type MigrationPackageManifest } from './manifest.js';
export interface MigrationPackage {
    rootDir: string;
    manifest: MigrationPackageManifest;
    files: Record<MigrationPackageFileKey, string>;
}
export interface CreateMigrationPackageOptions extends CreateMigrationPackageManifestOptions {
    rootDir: string;
    createEmptyFiles?: boolean;
    handoffNotes?: string;
}
export type CsvCellValue = string | number | boolean | null | undefined;
export type CsvRow = Record<string, CsvCellValue>;
export declare function createMigrationPackage(options: CreateMigrationPackageOptions): Promise<MigrationPackage>;
export declare function loadMigrationPackage(rootDir: string): Promise<MigrationPackage>;
export declare function writeMigrationPackageManifest(rootDir: string, manifest: MigrationPackageManifest): Promise<void>;
export declare function writePackageCsvRows(rootDir: string, fileKey: MigrationPackageCsvFileKey, rows: CsvRow[], headers?: readonly string[]): Promise<number>;
export declare function writePackageJsonlRecords(rootDir: string, fileKey: 'warnings' | 'skippedUsers', records: unknown[]): Promise<number>;
export declare function createEmptyPackageFiles(rootDir: string, handoffNotes?: string): Promise<void>;
export declare function getPackageFilePath(rootDir: string, fileKey: MigrationPackageFileKey): string;
export declare function resolvePackageFiles(rootDir: string): Record<MigrationPackageFileKey, string>;
