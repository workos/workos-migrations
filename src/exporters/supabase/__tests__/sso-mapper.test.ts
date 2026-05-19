import { jest } from '@jest/globals';
import type { PoolConfig } from 'pg';
import { SupabasePgClient, type PgPoolLike } from '../pg-client.js';
import { exportSamlProviders } from '../sso-mapper.js';
import type { SupabaseSamlProviderRow } from '../types.js';

const SAMPLE_METADATA = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com/saml">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor>
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>MIIDCERT</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;

function fakeClientWithRows(rows: SupabaseSamlProviderRow[] | (() => never)): SupabasePgClient {
  const factory = (_config: PoolConfig): PgPoolLike => ({
    async query() {
      if (typeof rows === 'function') {
        rows();
        return { rows: [] };
      }
      return { rows };
    },
    async end() {},
  });
  return new SupabasePgClient({ connectionString: 'postgresql://x', poolFactory: factory });
}

describe('exportSamlProviders', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses metadata_xml into a SamlRow with entity id, sso url, and cert', async () => {
    const pg = fakeClientWithRows([
      {
        id: 'saml-1',
        sso_provider_id: 'ssp-1',
        entity_id: null,
        metadata_xml: SAMPLE_METADATA,
        metadata_url: null,
        attribute_mapping: { keys: { email: 'urn:oid:email' } },
        resource_id: 'ext-org-1',
        domains: ['example.com', 'example.org'],
      },
    ]);
    const result = await exportSamlProviders(pg);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.idpEntityId).toBe('https://idp.example.com/saml');
    expect(row.idpUrl).toBe('https://idp.example.com/sso');
    expect(row.x509Cert).toBe('MIIDCERT');
    expect(row.domains).toBe('example.com,example.org');
    expect(row.emailAttribute).toBe('urn:oid:email');
    expect(row.organizationExternalId).toBe('ext-org-1');
    expect(row.importedId).toBe('saml-1');
  });

  it('fetches metadata_url with timeout when metadata_xml is empty', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => SAMPLE_METADATA,
    } as unknown as Response);
    global.fetch = fetchMock;

    const pg = fakeClientWithRows([
      {
        id: 'saml-2',
        sso_provider_id: 'ssp-2',
        entity_id: null,
        metadata_xml: null,
        metadata_url: 'https://idp.example.com/metadata',
        attribute_mapping: null,
        resource_id: 'ext-org-2',
        domains: [],
      },
    ]);
    const result = await exportSamlProviders(pg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://idp.example.com/metadata',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.rows[0].idpUrl).toBe('https://idp.example.com/sso');
    expect(result.warnings.some((w) => /no email attribute/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /no domains/.test(w))).toBe(true);
  });

  it('emits a warning when metadata fetch fails', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'server error',
    } as unknown as Response);
    global.fetch = fetchMock;

    const pg = fakeClientWithRows([
      {
        id: 'saml-3',
        sso_provider_id: 'ssp-3',
        entity_id: 'fallback-entity-id',
        metadata_xml: null,
        metadata_url: 'https://idp.example.com/metadata',
        attribute_mapping: null,
        resource_id: null,
        domains: [],
      },
    ]);
    const result = await exportSamlProviders(pg);
    expect(result.warnings.some((w) => /HTTP 500/.test(w))).toBe(true);
    expect(result.rows[0].idpEntityId).toBe('fallback-entity-id');
  });

  it('returns empty rows + warning when auth.saml_providers does not exist', async () => {
    const pg = fakeClientWithRows((() => {
      throw new Error('relation "auth.saml_providers" does not exist');
    }) as () => never);
    const result = await exportSamlProviders(pg);
    expect(result.rows).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/skipped/i);
  });

  it('reads attribute_mapping directly (not under .keys)', async () => {
    const pg = fakeClientWithRows([
      {
        id: 'saml-4',
        sso_provider_id: 'ssp-4',
        entity_id: null,
        metadata_xml: SAMPLE_METADATA,
        metadata_url: null,
        attribute_mapping: { email: 'mail', first_name: 'givenName' },
        resource_id: 'ext-org-4',
        domains: ['example.com'],
      },
    ]);
    const result = await exportSamlProviders(pg);
    expect(result.rows[0].emailAttribute).toBe('mail');
    expect(result.rows[0].firstNameAttribute).toBe('givenName');
  });
});
