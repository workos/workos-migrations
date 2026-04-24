import { WorkOS } from '@workos-inc/node';
/**
 * Initialize the WorkOS SDK client from environment.
 * Expects WORKOS_SECRET_KEY to be set.
 */
export declare function createWorkOSClient(apiKey?: string): WorkOS;
/**
 * Check if a WorkOS API error indicates the user already exists.
 */
export declare function isDuplicateUserError(error: unknown): boolean;
/**
 * Check if a WorkOS API error indicates the membership already exists.
 */
export declare function isDuplicateMembershipError(error: unknown): boolean;
/**
 * Extract a user ID from a WorkOS API error response when the user already exists.
 */
export declare function extractExistingUserId(error: unknown): string | undefined;
