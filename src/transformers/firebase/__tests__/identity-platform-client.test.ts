import { jest } from '@jest/globals';
import { IdentityPlatformApiError, IdentityPlatformClient } from '../identity-platform-client';

function fakeTokenProvider(token = 'test-token') {
  return { getAccessToken: async () => token };
}

describe('IdentityPlatformClient', () => {
  it('requires a projectId', () => {
    expect(
      () =>
        new IdentityPlatformClient({
          projectId: '',
          accessTokenProvider: fakeTokenProvider(),
        }),
    ).toThrow(/projectId/);
  });

  it('paginates listInboundSamlConfigs across nextPageToken', async () => {
    const calls: string[] = [];
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            inboundSamlConfigs: [{ name: 'projects/p/inboundSamlConfigs/saml.a' }],
            nextPageToken: 'token-2',
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          inboundSamlConfigs: [{ name: 'projects/p/inboundSamlConfigs/saml.b' }],
        }),
        { status: 200 },
      );
    });

    const client = new IdentityPlatformClient({
      projectId: 'p',
      accessTokenProvider: fakeTokenProvider(),
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await client.listInboundSamlConfigs();
    expect(result).toHaveLength(2);
    expect(calls[0]).toContain('/v2/projects/p/inboundSamlConfigs?pageSize=100');
    expect(calls[1]).toContain('pageToken=token-2');
  });

  it('uses tenant-scoped path when tenantId is provided', async () => {
    const calls: string[] = [];
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      calls.push(typeof input === 'string' ? input : input.toString());
      return new Response(JSON.stringify({ oauthIdpConfigs: [] }), { status: 200 });
    });
    const client = new IdentityPlatformClient({
      projectId: 'p',
      accessTokenProvider: fakeTokenProvider(),
      fetchImpl: fetchImpl as typeof fetch,
    });
    await client.listOAuthIdpConfigs('t-1');
    expect(calls[0]).toContain('/v2/projects/p/tenants/t-1/oauthIdpConfigs');
  });

  it('attaches the bearer token from the provider', async () => {
    const fetchImpl = jest.fn(
      async () => new Response(JSON.stringify({ tenants: [] }), { status: 200 }),
    );
    const client = new IdentityPlatformClient({
      projectId: 'p',
      accessTokenProvider: fakeTokenProvider('my-token-123'),
      fetchImpl: fetchImpl as typeof fetch,
    });
    await client.listTenants();
    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer my-token-123');
  });

  it('throws IdentityPlatformApiError on non-2xx responses', async () => {
    const fetchImpl = jest.fn(async () => new Response('permission denied', { status: 403 }));
    const client = new IdentityPlatformClient({
      projectId: 'p',
      accessTokenProvider: fakeTokenProvider(),
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(client.listInboundSamlConfigs()).rejects.toBeInstanceOf(IdentityPlatformApiError);
  });
});
