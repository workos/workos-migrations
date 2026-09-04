import { jest } from '@jest/globals';
import {
  createConnection,
  describeWorkOSApiError,
  isConnectionsApiDisabledError,
  isCustomAttributeError,
  isRetryableConnectionsApiError,
  type ConnectionsApiClient,
} from '../connections-api';
import {
  inferSamlConnectionTypeFromUrl,
  isOidcConnectionType,
  isSamlConnectionType,
  normalizeConnectionType,
} from '../connection-types';

describe('createConnection', () => {
  it('posts the payload to /connections and unwraps data', async () => {
    const post = jest.fn().mockResolvedValue({ data: { object: 'connection', id: 'conn_1' } });
    const client: ConnectionsApiClient = { post };
    const result = await createConnection(client, {
      organization_id: 'org_1',
      saml_options: { idp_metadata_url: 'https://idp.example.com/metadata' },
    });
    expect(post).toHaveBeenCalledWith('/connections', {
      organization_id: 'org_1',
      saml_options: { idp_metadata_url: 'https://idp.example.com/metadata' },
    });
    expect(result.id).toBe('conn_1');
  });
});

describe('describeWorkOSApiError', () => {
  it('reads status, code, and message from SDK exceptions', () => {
    expect(
      describeWorkOSApiError({
        status: 400,
        code: 'invalid_certificate',
        message: 'bad cert',
        requestID: 'req_1',
      }),
    ).toEqual({
      status: 400,
      code: 'invalid_certificate',
      message: 'bad cert',
      requestId: 'req_1',
    });
  });

  it('falls back to rawData and stringifies unknown values', () => {
    expect(
      describeWorkOSApiError({ status: 500, rawData: { code: 'boom', message: 'server' } }),
    ).toMatchObject({ status: 500, code: 'boom', message: 'server' });
    expect(describeWorkOSApiError('nope')).toEqual({ message: 'nope' });
  });
});

describe('isConnectionsApiDisabledError', () => {
  it('recognizes the migration-capabilities 404', () => {
    expect(
      isConnectionsApiDisabledError({
        status: 404,
        message:
          'This endpoint is part of the Connections API migration capabilities, which are not enabled for your environment. Contact support@workos.com to enable them.',
      }),
    ).toBe(true);
  });

  it('does not treat entity 404s or other statuses as the flag being off', () => {
    expect(isConnectionsApiDisabledError({ status: 404, message: 'Organization not found' })).toBe(
      false,
    );
    expect(isConnectionsApiDisabledError({ status: 400, message: 'not enabled' })).toBe(false);
  });
});

describe('isCustomAttributeError', () => {
  it('matches custom attribute rejections only', () => {
    expect(
      isCustomAttributeError({
        status: 400,
        code: 'custom_attribute_not_found',
        message: 'Unknown custom attribute department',
      }),
    ).toBe(true);
    expect(isCustomAttributeError({ status: 400, code: 'invalid_certificate', message: 'x' })).toBe(
      false,
    );
  });
});

describe('isRetryableConnectionsApiError', () => {
  it('retries rate limits and server errors only', () => {
    expect(isRetryableConnectionsApiError({ status: 429 })).toBe(true);
    expect(isRetryableConnectionsApiError({ status: 503 })).toBe(true);
    expect(isRetryableConnectionsApiError({ status: 400 })).toBe(false);
    expect(isRetryableConnectionsApiError(new Error('network'))).toBe(false);
  });
});

describe('connection types', () => {
  it('normalizes case-insensitively and classifies protocol', () => {
    expect(normalizeConnectionType('oktasaml')).toBe('OktaSAML');
    expect(normalizeConnectionType(' GenericOIDC ')).toBe('GenericOIDC');
    expect(normalizeConnectionType('nope')).toBeUndefined();
    expect(isSamlConnectionType('AzureSAML')).toBe(true);
    expect(isOidcConnectionType('AzureSAML')).toBe(false);
    expect(isOidcConnectionType('GenericOIDC')).toBe(true);
  });

  it('infers hosted IdP types from URLs', () => {
    expect(inferSamlConnectionTypeFromUrl('https://acme.okta.com/app/abc/sso/saml')).toBe(
      'OktaSAML',
    );
    expect(
      inferSamlConnectionTypeFromUrl(
        undefined,
        'https://login.microsoftonline.com/tenant/federationmetadata/2007-06/federationmetadata.xml',
      ),
    ).toBe('AzureSAML');
    expect(inferSamlConnectionTypeFromUrl('https://accounts.google.com/o/saml2/idp?idpid=x')).toBe(
      'GoogleSAML',
    );
    expect(
      inferSamlConnectionTypeFromUrl('https://idp.customer.com/sso', 'not a url'),
    ).toBeUndefined();
  });
});
