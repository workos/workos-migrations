import { jest } from '@jest/globals';
import { ClerkApiError, ClerkClient } from '../client';
import type { ClerkEnterpriseConnection } from '../sso-mapper';

function buildSamlConnection(id: string): ClerkEnterpriseConnection {
  return {
    id,
    name: `Conn ${id}`,
    domains: [`${id}.example.com`],
    saml_connection: {
      idp_entity_id: `https://idp.example.com/${id}`,
      idp_sso_url: `https://idp.example.com/${id}/sso`,
      idp_certificate: 'CERT',
    },
  };
}

function buildOidcConnection(id: string): ClerkEnterpriseConnection {
  return {
    id,
    name: `Conn ${id}`,
    domains: [`${id}.example.com`],
    oauth_config: {
      client_id: `client-${id}`,
      discovery_url: `https://idp.example.com/${id}/.well-known/openid-configuration`,
    },
  };
}

describe('ClerkClient', () => {
  it('throws when secretKey is missing', () => {
    expect(() => new ClerkClient({ secretKey: '' })).toThrow(/secretKey/);
  });

  it('paginates listEnterpriseConnections until a page returns fewer than the limit', async () => {
    const calls: string[] = [];
    const firstPage: ClerkEnterpriseConnection[] = Array.from({ length: 500 }, (_, i) =>
      i % 2 === 0 ? buildSamlConnection(`a${i}`) : buildOidcConnection(`a${i}`),
    );
    const secondPage: ClerkEnterpriseConnection[] = [
      buildSamlConnection('b1'),
      buildOidcConnection('b2'),
    ];

    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      const data = calls.length === 1 ? firstPage : secondPage;
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new ClerkClient({ secretKey: 'sk_test', fetchImpl: fetchImpl as typeof fetch });
    const result = await client.listEnterpriseConnections();

    expect(result).toHaveLength(502);
    expect(calls).toEqual([
      'https://api.clerk.com/v1/enterprise_connections?limit=500&offset=0',
      'https://api.clerk.com/v1/enterprise_connections?limit=500&offset=500',
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_test');
  });

  it('accepts bare-array responses (defensive)', async () => {
    const fetchImpl = jest.fn(
      async () => new Response(JSON.stringify([buildSamlConnection('only')]), { status: 200 }),
    );
    const client = new ClerkClient({ secretKey: 'sk_test', fetchImpl: fetchImpl as typeof fetch });
    const result = await client.listEnterpriseConnections();
    expect(result).toHaveLength(1);
  });

  it('throws ClerkApiError on non-2xx responses', async () => {
    const fetchImpl = jest.fn(async () => new Response('forbidden', { status: 403 }));
    const client = new ClerkClient({ secretKey: 'sk_test', fetchImpl: fetchImpl as typeof fetch });

    await expect(client.listEnterpriseConnections()).rejects.toBeInstanceOf(ClerkApiError);
  });
});
