import type { TransformSummary } from '../../shared/types.js';
export interface ClerkTransformOptions {
    input: string;
    output: string;
    orgMapping?: string;
    roleMapping?: string;
    quiet?: boolean;
}
/**
 * Transform a Clerk CSV export to WorkOS-compatible CSV format.
 */
export declare function transformClerkExport(options: ClerkTransformOptions): Promise<TransformSummary>;
