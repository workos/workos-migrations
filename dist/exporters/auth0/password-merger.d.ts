import type { PasswordLookup } from '../../shared/types.js';
export declare function loadPasswordHashes(filePath: string): Promise<PasswordLookup>;
export declare function detectHashAlgorithm(hash: string): string;
export interface MergeStats {
    totalRows: number;
    passwordsAdded: number;
    passwordsNotFound: number;
}
export declare const SUPPORTED_PACKAGE_PASSWORD_ALGORITHMS: Set<string>;
export declare function mergePasswordsIntoCsv(inputCsv: string, outputCsv: string, passwordLookup: PasswordLookup): Promise<MergeStats>;
export interface PackageMergeWarning {
    code: 'unsupported_password_hash_algorithm' | 'missing_password_hash' | 'package_users_csv_missing';
    message: string;
    email?: string;
    external_id?: string;
    algorithm?: string;
}
export interface PackageMergeStats {
    totalRows: number;
    passwordsAdded: number;
    passwordsNotFound: number;
    passwordsRejectedAlgorithm: number;
    uploadRowsUpdated: number;
    warnings: PackageMergeWarning[];
}
export interface MergePasswordsIntoPackageOptions {
    packageDir: string;
    passwordsPath: string;
    /** Optional override of the supported hash algorithm set. */
    supportedAlgorithms?: Set<string>;
}
export declare function mergePasswordsIntoPackage(options: MergePasswordsIntoPackageOptions): Promise<PackageMergeStats>;
