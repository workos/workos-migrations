import type { PasswordLookup } from '../../shared/types.js';
export declare function loadPasswordHashes(filePath: string): Promise<PasswordLookup>;
export declare function detectHashAlgorithm(hash: string): string;
export interface MergeStats {
    totalRows: number;
    passwordsAdded: number;
    passwordsNotFound: number;
}
export declare function mergePasswordsIntoCsv(inputCsv: string, outputCsv: string, passwordLookup: PasswordLookup): Promise<MergeStats>;
