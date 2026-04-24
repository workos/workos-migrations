import { WorkOS } from '@workos-inc/node';

/**
 * Initialize the WorkOS SDK client from environment.
 * Expects WORKOS_SECRET_KEY to be set.
 */
export function createWorkOSClient(apiKey?: string): WorkOS {
  const key = apiKey ?? process.env.WORKOS_SECRET_KEY;
  if (!key) {
    throw new Error(
      'WorkOS API key is required. Set WORKOS_SECRET_KEY environment variable or pass --api-key.',
    );
  }
  return new WorkOS(key);
}

/**
 * Check if a WorkOS API error indicates the user already exists.
 */
export function isDuplicateUserError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code: string }).code === 'user_already_exists';
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message: string }).message;
    return msg.includes('already exists') || msg.includes('duplicate');
  }
  return false;
}

/**
 * Check if a WorkOS API error indicates the membership already exists.
 */
export function isDuplicateMembershipError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message: string }).message;
    return msg.includes('already a member') || msg.includes('membership already exists');
  }
  return false;
}

/**
 * Extract a user ID from a WorkOS API error response when the user already exists.
 */
export function extractExistingUserId(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if (err.rawData && typeof err.rawData === 'object') {
      const data = err.rawData as Record<string, unknown>;
      if (typeof data.user_id === 'string') return data.user_id;
    }
  }
  return undefined;
}
