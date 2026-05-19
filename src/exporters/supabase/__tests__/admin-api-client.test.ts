import { jest } from '@jest/globals';
import { SupabaseAdminClient } from '../admin-api-client.js';
import { SupabaseAuthError, type SupabaseAdminUser } from '../types.js';

describe('SupabaseAdminClient', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('paginates through users and stops on the first empty page', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ users: makeUsers(['11111111-1111-1111-1111-111111111111']) }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ users: makeUsers(['22222222-2222-2222-2222-222222222222']) }),
      )
      .mockResolvedValueOnce(jsonResponse({ users: [] }));

    const client = createClient({ pageSize: 1 });

    const collected: string[] = [];
    for await (const user of client.listUsers()) {
      collected.push(user.id);
    }

    expect(collected).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('sends Authorization: Bearer and apikey headers using the service-role key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ users: [] }));

    const client = createClient({ pageSize: 10 });
    for await (const _user of client.listUsers()) {
      // exhaust
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://demo.supabase.co/auth/v1/admin/users?page=1&per_page=10');
    const headers = (calledInit as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sb-service-role-jwt');
    expect(headers.apikey).toBe('sb-service-role-jwt');
  });

  it('throws SupabaseAuthError with a service-role hint on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Invalid JWT' }, 401));

    const client = createClient({ pageSize: 10 });
    let caught: unknown;
    try {
      for await (const _user of client.listUsers()) {
        // unreachable
      }
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SupabaseAuthError);
    const err = caught as SupabaseAuthError;
    expect(err.statusCode).toBe(401);
    expect(err.hint).toMatch(/service-role/i);
    expect(err.message).toMatch(/service-role/i);
  });

  it('dedupes users that appear in multiple pages and reports the first duplicate', async () => {
    const sharedId = '99999999-9999-9999-9999-999999999999';
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ users: makeUsers([sharedId, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']) }),
      )
      .mockResolvedValueOnce(jsonResponse({ users: makeUsers([sharedId]) }))
      .mockResolvedValueOnce(jsonResponse({ users: [] }));

    const client = createClient({ pageSize: 2 });
    const collected: string[] = [];
    const duplicates: string[] = [];

    for await (const user of client.listUsers({ onDuplicate: (id) => duplicates.push(id) })) {
      collected.push(user.id);
    }

    expect(collected).toEqual([sharedId, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
    expect(duplicates).toEqual([sharedId]);
  });

  it('testConnection returns success on 200 and failure with error message on auth failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ users: [] }));
    const ok = await createClient().testConnection();
    expect(ok).toEqual({ success: true });

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'bad key' }, 403));
    const fail = await createClient().testConnection();
    expect(fail.success).toBe(false);
    expect(fail.error).toMatch(/Supabase Admin API error/);
  });
});

interface CreateClientOptions {
  pageSize?: number;
}

function createClient(options: CreateClientOptions = {}): SupabaseAdminClient {
  return new SupabaseAdminClient({
    url: 'https://demo.supabase.co',
    serviceRoleKey: 'sb-service-role-jwt',
    rateLimit: 1000,
    pageSize: options.pageSize,
  });
}

function makeUsers(ids: string[]): SupabaseAdminUser[] {
  return ids.map((id) => ({
    id,
    email: `${id}@example.com`,
    created_at: '2025-01-01T00:00:00.000Z',
    user_metadata: {},
    app_metadata: {},
    identities: [],
  }));
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: () => null,
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}
