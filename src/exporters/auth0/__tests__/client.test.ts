import { jest } from '@jest/globals';
import { Auth0ApiError, Auth0Client, isMissingConnectionOptionsScopeError } from '../client';

describe('Auth0Client Management API expansion', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists connections and supports strategy filters', async () => {
    const client = createClient();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          connections: [
            {
              id: 'con_saml',
              name: 'okta',
              strategy: 'samlp',
              options: { signInEndpoint: 'https://idp.example.com/sso' },
            },
          ],
        }),
      );

    await expect(client.getConnections(2, 25, ['samlp', 'oidc'])).resolves.toEqual([
      {
        id: 'con_saml',
        name: 'okta',
        strategy: 'samlp',
        options: { signInEndpoint: 'https://idp.example.com/sso' },
      },
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://tenant.example.com/api/v2/connections?page=2&per_page=25&include_totals=false&strategy=samlp&strategy=oidc',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
        }),
      }),
    );
  });

  it('gets one connection by ID without logging connection secrets', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const client = createClient();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'con|secret',
          name: 'oidc',
          strategy: 'oidc',
          options: { client_secret: 'super-secret' },
        }),
      );

    const connection = await client.getConnection('con|secret');

    expect(connection.options?.client_secret).toBe('super-secret');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://tenant.example.com/api/v2/connections/con%7Csecret',
      expect.any(Object),
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('lists organization enabled connections', async () => {
    const client = createClient();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          enabled_connections: [
            {
              connection_id: 'con_123',
              assign_membership_on_login: true,
              connection: { id: 'con_123', name: 'okta', strategy: 'samlp' },
            },
          ],
        }),
      );

    await expect(client.getOrganizationConnections('org_123', 1, 50)).resolves.toEqual([
      {
        connection_id: 'con_123',
        assign_membership_on_login: true,
        connection: { id: 'con_123', name: 'okta', strategy: 'samlp' },
      },
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://tenant.example.com/api/v2/organizations/org_123/enabled_connections?page=1&per_page=50',
      expect.any(Object),
    );
  });

  it('lists roles and organization member roles', async () => {
    const client = createClient();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ roles: [{ id: 'rol_admin', name: 'Admin' }] }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'rol_member', name: 'Member' }]));

    await expect(client.getRoles()).resolves.toEqual([{ id: 'rol_admin', name: 'Admin' }]);
    await expect(client.getMemberRoles('org_123', 'auth0|abc', 3, 10)).resolves.toEqual([
      { id: 'rol_member', name: 'Member' },
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://tenant.example.com/api/v2/roles?page=0&per_page=100',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://tenant.example.com/api/v2/organizations/org_123/members/auth0%7Cabc/roles?page=3&per_page=10',
      expect.any(Object),
    );
  });

  it('creates and fetches user export jobs', async () => {
    const client = createClient();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 'job_123', type: 'users_export', status: 'pending' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'job_123',
          type: 'users_export',
          status: 'completed',
          location: 'https://signed.example.com/job_123.ndjson',
        }),
      );

    await expect(
      client.createUserExportJob({
        connectionId: 'con_db',
        format: 'json',
        limit: 100,
        fields: [{ name: 'email' }, { name: 'user_id', export_as: 'external_id' }],
      }),
    ).resolves.toMatchObject({ id: 'job_123', status: 'pending' });
    await expect(client.getJob('job_123')).resolves.toMatchObject({
      id: 'job_123',
      status: 'completed',
      location: 'https://signed.example.com/job_123.ndjson',
    });

    const createCallInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(createCallInit.method).toBe('POST');
    expect(JSON.parse(createCallInit.body as string)).toEqual({
      connection_id: 'con_db',
      format: 'json',
      limit: 100,
      fields: [{ name: 'email' }, { name: 'user_id', export_as: 'external_id' }],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://tenant.example.com/api/v2/jobs/job_123',
      expect.any(Object),
    );
  });

  it('downloads a completed job location without adding Auth0 authorization headers', async () => {
    const client = createClient();
    fetchMock.mockResolvedValueOnce(textResponse('{"email":"alice@example.com"}\n'));

    await expect(client.downloadJobLocation('https://signed.example.com/job.ndjson')).resolves.toBe(
      '{"email":"alice@example.com"}\n',
    );

    expect(fetchMock).toHaveBeenCalledWith('https://signed.example.com/job.ndjson');
  });

  it('retries 429 responses for new Management API endpoints', async () => {
    const client = createClient();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'too_many_requests' }, 429, { 'Retry-After': '0' }),
      )
      .mockResolvedValueOnce(jsonResponse([{ id: 'rol_admin', name: 'Admin' }]));

    await expect(client.getRoles()).resolves.toEqual([{ id: 'rol_admin', name: 'Admin' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('represents missing read:connections_options failures as a catchable warning path', async () => {
    const client = createClient();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'insufficient_scope',
            error_description: 'Requires scope: read:connections_options',
          },
          403,
        ),
      );

    let caught: unknown;
    try {
      await client.getConnection('con_123');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Auth0ApiError);
    expect(isMissingConnectionOptionsScopeError(caught)).toBe(true);
  });
});

function createClient(): Auth0Client {
  return new Auth0Client({
    domain: 'tenant.example.com',
    clientId: 'client_123',
    clientSecret: 'secret_123',
    rateLimit: 1000,
  });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return response({
    status,
    headers,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

function textResponse(body: string, status = 200): Response {
  return response({
    status,
    headers: {},
    json: async () => JSON.parse(body),
    text: async () => body,
  });
}

function response(input: {
  status: number;
  headers: Record<string, string>;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}): Response {
  return {
    ok: input.status >= 200 && input.status < 300,
    status: input.status,
    headers: {
      get(name: string): string | null {
        return input.headers[name] ?? input.headers[name.toLowerCase()] ?? null;
      },
    },
    json: input.json,
    text: input.text,
  } as Response;
}
