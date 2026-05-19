import { RateLimiter } from '../../shared/rate-limiter.js';
import {
  SupabaseAuthError,
  type SupabaseAdminListResponse,
  type SupabaseAdminUser,
} from './types.js';

export interface SupabaseAdminClientOptions {
  url: string;
  serviceRoleKey: string;
  rateLimit?: number;
  pageSize?: number;
}

export interface SupabaseAdminListIteratorOptions {
  onDuplicate?: (userId: string) => void;
  onMalformedUser?: (warning: string) => void;
}

const DEFAULT_RATE_LIMIT = 50;
const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_GUARD = 10_000;

export class SupabaseAdminClient {
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly rateLimiter: RateLimiter;
  private readonly pageSize: number;

  constructor(options: SupabaseAdminClientOptions) {
    this.baseUrl = options.url.replace(/\/$/, '');
    this.serviceRoleKey = options.serviceRoleKey;
    this.rateLimiter = new RateLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT);
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.fetchPage(1, 1);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  async *listUsers(
    options: SupabaseAdminListIteratorOptions = {},
  ): AsyncIterableIterator<SupabaseAdminUser> {
    const seen = new Set<string>();
    let duplicateWarned = false;

    for (let page = 1; page <= MAX_PAGE_GUARD; page++) {
      const response = await this.fetchPage(page, this.pageSize);
      const users = response.users ?? [];
      if (users.length === 0) return;

      for (const user of users) {
        if (!user.id) {
          options.onMalformedUser?.(
            `Admin API returned a user without an id on page ${page}; skipped`,
          );
          continue;
        }
        if (seen.has(user.id)) {
          if (!duplicateWarned) {
            duplicateWarned = true;
            options.onDuplicate?.(user.id);
          }
          continue;
        }
        seen.add(user.id);
        yield user;
      }

      // Defensive: if API returned fewer than a full page, assume terminal.
      if (users.length < this.pageSize) return;
    }
  }

  private async fetchPage(page: number, perPage: number): Promise<SupabaseAdminListResponse> {
    await this.rateLimiter.acquire();

    const url = `${this.baseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      const hint =
        response.status === 401 || response.status === 403
          ? 'Confirm you are using the service-role key (not the anon key) and that SUPABASE_URL matches your project.'
          : undefined;
      throw new SupabaseAuthError(response.status, body, hint);
    }

    return (await response.json()) as SupabaseAdminListResponse;
  }
}
