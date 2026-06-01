import { WorkOS } from '@workos-inc/node';

export interface WorkOSClientOptions {
  apiKey?: string;
  endpoint?: string;
}

/**
 * Resolve the API endpoint URL from options or environment.
 */
export function resolveEndpoint(endpoint?: string): string | undefined {
  return endpoint || process.env.WORKOS_API_URL || undefined;
}

/**
 * Initialize the WorkOS SDK client from environment.
 * Expects WORKOS_SECRET_KEY to be set.
 */
export function createWorkOSClient(options?: WorkOSClientOptions | string): WorkOS {
  const apiKey = typeof options === 'string' ? options : options?.apiKey;
  const endpoint = typeof options === 'string' ? undefined : options?.endpoint;

  const key = apiKey ?? process.env.WORKOS_SECRET_KEY;
  if (!key) {
    throw new Error(
      'WorkOS API key is required. Set WORKOS_SECRET_KEY environment variable or pass --api-key.',
    );
  }

  const baseUrl = resolveEndpoint(endpoint);
  if (baseUrl) {
    const url = new URL(baseUrl);
    return new WorkOS(key, {
      apiHostname: url.hostname,
      port: url.port ? parseInt(url.port, 10) : undefined,
      https: url.protocol === 'https:',
    });
  }

  return new WorkOS(key);
}

/**
 * Check if a WorkOS API error indicates the user already exists.
 * Handles both legacy `user_already_exists` and AuthKit's `user_creation_error`
 * with `email_not_available` sub-error.
 */
export function isDuplicateUserError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;

  // Legacy code: user_already_exists
  if (err.code === 'user_already_exists') return true;

  // AuthKit: user_creation_error with email_not_available or external_id_already_used
  if (err.code === 'user_creation_error') {
    if (Array.isArray(err.errors)) {
      return err.errors.some(
        (e: unknown) =>
          e &&
          typeof e === 'object' &&
          'code' in e &&
          ((e as { code: string }).code === 'email_not_available' ||
            (e as { code: string }).code === 'external_id_already_used'),
      );
    }
    return true;
  }

  // Fallback: message-based detection
  if ('message' in err) {
    const msg = String(err.message);
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
