/**
 * Tests for the Auth0 client — focused on the pre-transform connections filter.
 *
 * The filter decides which Auth0 connection strategies reach the transform
 * layer. A mismatch between the filter and the transform's strategy processors
 * causes silent data loss (e.g. Azure AD and Google Workspace connections
 * getting dropped before they can be migrated).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { Auth0Client, type Auth0Connection } from '../../../src/providers/auth0/client';
import type { ProviderCredentials } from '../../../src/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const CREDS: ProviderCredentials = {
  clientId: 'test',
  clientSecret: 'test',
  domain: 'acme.auth0.com',
};

function makeConnection(strategy: string, name = `conn-${strategy}`): Auth0Connection {
  return {
    id: `con_${strategy}`,
    name,
    strategy,
    display_name: name,
    enabled_clients: [],
    options: {},
  } as Auth0Connection;
}

describe('Auth0Client.getConnections filter', () => {
  let httpGet: jest.Mock;
  let client: Auth0Client;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth0-client-test-'));
    httpGet = jest.fn();
    mockedAxios.create.mockReturnValue({
      get: httpGet,
      defaults: { headers: { common: {} } },
    } as any);
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: { access_token: 'stub', scope: 'read:connections read:connections_options' },
    }) as any;

    client = new Auth0Client(CREDS, {}, tmpDir);
  });

  afterEach(() => {
    jest.resetAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function fetchConnections(connections: Auth0Connection[]): Promise<Auth0Connection[]> {
    await client.authenticate();
    httpGet.mockResolvedValue({ data: connections });
    const result = await client.exportEntities(['connections']);
    return (result.entities.connections as Auth0Connection[]) ?? [];
  }

  it('keeps every enterprise strategy the transform can process', async () => {
    const input = [
      makeConnection('samlp'),
      makeConnection('adfs'),
      makeConnection('pingfederate'),
      makeConnection('oidc'),
      makeConnection('waad'),
      makeConnection('google-apps'),
      makeConnection('okta'),
      makeConnection('ad'),
      makeConnection('auth0-adldap'),
    ];
    const kept = await fetchConnections(input);
    expect(kept.map((c) => c.strategy).sort()).toEqual(
      ['ad', 'adfs', 'auth0-adldap', 'google-apps', 'oidc', 'okta', 'pingfederate', 'samlp', 'waad'].sort(),
    );
  });

  it('drops social, database, and passwordless connections to keep the raw dump small', async () => {
    const input = [
      makeConnection('samlp', 'sso-acme'),
      makeConnection('facebook'),
      makeConnection('google-oauth2'),
      makeConnection('auth0'), // database
      makeConnection('email'), // passwordless
      makeConnection('sms'), // passwordless
    ];
    const kept = await fetchConnections(input);
    expect(kept.map((c) => c.strategy)).toEqual(['samlp']);
  });

  it('handles the /connections totals response shape', async () => {
    // Auth0 returns { connections, total, length, start, limit } when
    // include_totals is set. The filter must still pull the array out.
    await client.authenticate();
    httpGet.mockResolvedValue({
      data: { connections: [makeConnection('waad'), makeConnection('facebook')], total: 2 },
    });
    const result = await client.exportEntities(['connections']);
    const kept = (result.entities.connections as Auth0Connection[]) ?? [];
    expect(kept.map((c) => c.strategy)).toEqual(['waad']);
  });

  it('ignores connections with a missing/non-string strategy instead of throwing', async () => {
    const kept = await fetchConnections([
      makeConnection('samlp'),
      { id: 'broken', name: 'broken', display_name: 'broken', enabled_clients: [], options: {} } as unknown as Auth0Connection,
    ]);
    expect(kept.map((c) => c.strategy)).toEqual(['samlp']);
  });
});
