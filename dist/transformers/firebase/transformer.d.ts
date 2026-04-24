import type { FirebaseScryptConfig, NameSplitStrategy, TransformSummary } from '../../shared/types.js';
export interface FirebaseTransformOptions {
    input: string;
    output: string;
    scryptConfig?: FirebaseScryptConfig;
    nameSplitStrategy: NameSplitStrategy;
    includeDisabled?: boolean;
    skipPasswords?: boolean;
    orgMapping?: string;
    roleMapping?: string;
    quiet?: boolean;
}
/**
 * Split a display name into first and last name using the given strategy.
 */
export declare function splitDisplayName(displayName: string | undefined, strategy: NameSplitStrategy): {
    firstName: string;
    lastName: string;
};
/**
 * Transform a Firebase Auth JSON export to WorkOS-compatible CSV format.
 */
export declare function transformFirebaseExport(options: FirebaseTransformOptions): Promise<TransformSummary>;
