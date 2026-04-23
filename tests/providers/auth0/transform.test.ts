/**
 * Comprehensive tests for the Auth0 connection transform — every supported
 * Auth0 strategy plus skip paths and manual-setup branches.
 */
import fs from 'fs';
import path from 'path';
import {
  transformAuth0Connections,
  ensureHttps,
  ensureWellKnown,
  type Auth0TransformConfig,
} from '../../../src/providers/auth0/transform';
import type { Auth0Connection } from '../../../src/providers/auth0/client';
import { SAML_HEADERS, OIDC_HEADERS } from '../../../src/shared/csv';

const FIXTURES_DIR = path.join(__dirname, '../../fixtures/auth0/connections');

function loadConnection(name: string): Auth0Connection {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8'),
  ) as Auth0Connection;
}

const DEFAULT_CONFIG: Auth0TransformConfig = {
  customDomain: 'auth.acme.com',
  entityIdPrefix: 'urn:acme:sso:',
};

/** Parse a CSV string into an array of row objects keyed by header. */
function parseCsv(
  csv: string,
  headers: readonly string[],
): Record<string, string>[] {
  // Strip the header line (we already know the schema) and split remaining
  // non-empty lines. Our CSV uses RFC-4180-style quoting; we rely on the fact
  // that generated fixtures don't embed quoted newlines.
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const rows = lines.slice(1);
  return rows.map((line) => {
    const values = splitCsvLine(line);
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = values[i] ?? '';
    });
    return record;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        buf += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        buf += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf);
  return out;
}

describe('transformAuth0Connections', () => {
  describe('samlp (SAML enterprise)', () => {
    it('builds a complete SAML row with IdP-initiated SSO enabled', () => {
      const result = transformAuth0Connections(
        [loadConnection('samlp.json')],
        DEFAULT_CONFIG,
      );
      expect(result.samlCount).toBe(1);
      expect(result.oidcCount).toBe(0);

      const rows = parseCsv(result.samlCsv, SAML_HEADERS);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        organizationName: '[MIGRATED] sso-acme-saml',
        organizationExternalId: 'acme-saml',
        importedId: 'acme-saml',
        idpUrl: 'https://idp.acme.com/sso',
        x509Cert: 'MIICXjCCAcegAwIBAgIBADANBgkqhkiG9w0BAQ0FADCBhzELMAkGA1UEBhMCVVMx',
        emailAttribute: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
        firstNameAttribute: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
        lastNameAttribute: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
        idpIdAttribute: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
        customEntityId: 'urn:acme:sso:acme-saml',
        customAcsUrl: 'https://auth.acme.com/login/callback?connection=acme-saml',
        idpInitiatedEnabled: 'true',
      });
      expect(result.samlIdpInitiatedDisabled).not.toContain('acme-saml');
    });

    it('flags IdP-initiated SSO disabled when the option is absent', () => {
      const result = transformAuth0Connections(
        [loadConnection('samlp-no-idp-init.json')],
        DEFAULT_CONFIG,
      );
      const rows = parseCsv(result.samlCsv, SAML_HEADERS);
      expect(rows[0].idpInitiatedEnabled).toBe('false');
      expect(result.samlIdpInitiatedDisabled).toContain('beta-saml');
    });

    it('unwraps array-valued fieldsMap entries to their first element', () => {
      const result = transformAuth0Connections(
        [loadConnection('samlp.json')],
        DEFAULT_CONFIG,
      );
      const rows = parseCsv(result.samlCsv, SAML_HEADERS);
      // fieldsMap.email was an array in the fixture — we keep the first entry.
      expect(rows[0].emailAttribute).toBe(
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
      );
    });
  });

  describe('oidc', () => {
    it('back_channel with discovery_url produces a clean OIDC row', () => {
      const result = transformAuth0Connections(
        [loadConnection('oidc-back-channel.json')],
        DEFAULT_CONFIG,
      );
      const rows = parseCsv(result.oidcCsv, OIDC_HEADERS);
      expect(rows[0]).toMatchObject({
        clientId: 'oidc-client-id-123',
        clientSecret: 'oidc-client-secret-placeholder',
        discoveryEndpoint: 'https://idp.acme.com/.well-known/openid-configuration',
        customRedirectUri: 'https://auth.acme.com/login/callback',
      });
      expect(result.skipped).toHaveLength(0);
    });

    it('skips front_channel OIDC with explicit reason', () => {
      const result = transformAuth0Connections(
        [loadConnection('oidc-front-channel.json')],
        DEFAULT_CONFIG,
      );
      expect(result.oidcCount).toBe(0);
      expect(result.skipped).toContainEqual({
        connectionName: 'acme-oidc-frontchannel',
        reason: 'OIDC connection is not a back_channel connection',
        type: 'OIDC',
      });
    });

    it('skips OIDC with no discovery endpoint', () => {
      const result = transformAuth0Connections(
        [loadConnection('oidc-no-discovery.json')],
        DEFAULT_CONFIG,
      );
      expect(result.oidcCount).toBe(0);
      expect(result.skipped).toContainEqual({
        connectionName: 'acme-oidc-no-discovery',
        reason: 'No discovery endpoint found',
        type: 'OIDC',
      });
    });

    it('falls back to oidc_metadata.issuer when discovery_url is missing', () => {
      const result = transformAuth0Connections(
        [loadConnection('oidc-metadata-issuer.json')],
        DEFAULT_CONFIG,
      );
      const rows = parseCsv(result.oidcCsv, OIDC_HEADERS);
      expect(rows[0].discoveryEndpoint).toBe(
        'https://idp.metadata.example.com/.well-known/openid-configuration',
      );
    });
  });

  describe('waad (Azure AD)', () => {
    it('synthesizes Azure AD discovery URL from tenant_domain', () => {
      const result = transformAuth0Connections(
        [loadConnection('waad.json')],
        DEFAULT_CONFIG,
      );
      const rows = parseCsv(result.oidcCsv, OIDC_HEADERS);
      expect(rows[0]).toMatchObject({
        clientId: 'azure-client-id-abc',
        discoveryEndpoint:
          'https://login.microsoftonline.com/acme.onmicrosoft.com/.well-known/openid-configuration',
      });
    });

    it('skips waad connections missing tenant_domain', () => {
      const result = transformAuth0Connections(
        [loadConnection('waad-no-tenant.json')],
        DEFAULT_CONFIG,
      );
      expect(result.oidcCount).toBe(0);
      expect(result.skipped).toContainEqual({
        connectionName: 'bad-waad',
        reason: 'Azure AD connection missing tenant domain',
        type: 'OIDC',
      });
    });
  });

  describe('google-apps (Google Workspace enterprise)', () => {
    it('uses hardcoded Google discovery URL and blanks client_secret', () => {
      const result = transformAuth0Connections(
        [loadConnection('google-apps.json')],
        DEFAULT_CONFIG,
      );
      const rows = parseCsv(result.oidcCsv, OIDC_HEADERS);
      expect(rows[0]).toMatchObject({
        clientId: 'google-workspace-client-id',
        clientSecret: '',
        discoveryEndpoint: 'https://accounts.google.com/.well-known/openid-configuration',
      });
      expect(result.manualSetup).toContainEqual({
        connectionName: 'acme-google-apps',
        strategy: 'google-apps',
        reason: expect.stringContaining('client_secret'),
      });
    });
  });

  describe('adfs', () => {
    it('uses adfs_server as idpMetadataUrl', () => {
      const result = transformAuth0Connections(
        [loadConnection('adfs.json')],
        DEFAULT_CONFIG,
      );
      const rows = parseCsv(result.samlCsv, SAML_HEADERS);
      expect(rows[0]).toMatchObject({
        idpMetadataUrl:
          'https://adfs.acme.com/FederationMetadata/2007-06/FederationMetadata.xml',
        idpUrl: '',
        x509Cert: '',
        idpInitiatedEnabled: 'false',
      });
    });
  });

  describe('pingfederate', () => {
    it('maps pingfederate_base_url + signing_cert', () => {
      const result = transformAuth0Connections(
        [loadConnection('pingfederate.json')],
        DEFAULT_CONFIG,
      );
      const rows = parseCsv(result.samlCsv, SAML_HEADERS);
      expect(rows[0]).toMatchObject({
        idpUrl: 'https://ping.acme.com/sp/ACS.saml2',
        x509Cert: 'MIICPingCertSample',
        idpInitiatedEnabled: 'false',
      });
    });
  });

  describe('ad / auth0-adldap (on-prem)', () => {
    it('flags ad connection for manual setup', () => {
      const result = transformAuth0Connections(
        [loadConnection('ad.json')],
        DEFAULT_CONFIG,
      );
      expect(result.samlCount + result.oidcCount).toBe(0);
      expect(result.manualSetup).toContainEqual({
        connectionName: 'acme-ad',
        strategy: 'ad',
        reason: expect.stringContaining('On-prem AD/LDAP'),
      });
    });

    it('flags auth0-adldap for manual setup', () => {
      const result = transformAuth0Connections(
        [loadConnection('auth0-adldap.json')],
        DEFAULT_CONFIG,
      );
      expect(result.manualSetup).toContainEqual({
        connectionName: 'acme-adldap',
        strategy: 'auth0-adldap',
        reason: expect.stringContaining('On-prem AD/LDAP'),
      });
    });
  });

  describe('unknown strategy', () => {
    it('flags unrecognized strategies for manual review', () => {
      const result = transformAuth0Connections(
        [loadConnection('okta-unknown.json')],
        DEFAULT_CONFIG,
      );
      expect(result.manualSetup).toContainEqual({
        connectionName: 'acme-okta',
        strategy: 'okta',
        reason: expect.stringContaining('Unrecognized strategy'),
      });
    });
  });

  describe('skip: no enabled clients', () => {
    it('skips SAML connection with no applications enabled', () => {
      const result = transformAuth0Connections(
        [loadConnection('samlp-no-enabled-clients.json')],
        DEFAULT_CONFIG,
      );
      expect(result.samlCount).toBe(0);
      expect(result.skipped).toContainEqual({
        connectionName: 'orphan-saml',
        reason: 'No applications enabled',
        type: 'SAML',
      });
    });
  });

  describe('config handling', () => {
    it('synthesizes no customEntityId / customAcsUrl when config is empty', () => {
      const result = transformAuth0Connections(
        [loadConnection('samlp.json')],
        {}, // empty config
      );
      const rows = parseCsv(result.samlCsv, SAML_HEADERS);
      expect(rows[0].customEntityId).toBe('');
      expect(rows[0].customAcsUrl).toBe('');
    });

    it('honors a custom organizationNamePrefix', () => {
      const result = transformAuth0Connections(
        [loadConnection('samlp.json')],
        { ...DEFAULT_CONFIG, organizationNamePrefix: 'migrated-' },
      );
      const rows = parseCsv(result.samlCsv, SAML_HEADERS);
      expect(rows[0].organizationName).toBe('migrated-acme-saml');
    });
  });

  describe('full-fixture run', () => {
    it('produces correct counts across every strategy in one batch', () => {
      const connections = [
        'samlp.json',
        'samlp-no-idp-init.json',
        'oidc-back-channel.json',
        'oidc-front-channel.json',
        'oidc-no-discovery.json',
        'oidc-metadata-issuer.json',
        'waad.json',
        'waad-no-tenant.json',
        'google-apps.json',
        'adfs.json',
        'pingfederate.json',
        'ad.json',
        'auth0-adldap.json',
        'okta-unknown.json',
        'samlp-no-enabled-clients.json',
      ].map(loadConnection);

      const result = transformAuth0Connections(connections, DEFAULT_CONFIG);

      // SAML rows: samlp + samlp-no-idp-init + adfs + pingfederate = 4
      expect(result.samlCount).toBe(4);
      // OIDC rows: oidc-back-channel + oidc-metadata-issuer + waad + google-apps = 4
      expect(result.oidcCount).toBe(4);
      // Skipped: oidc-front-channel + oidc-no-discovery + waad-no-tenant + samlp-no-enabled-clients = 4
      expect(result.skipped).toHaveLength(4);
      // Manual setup: google-apps + ad + auth0-adldap + okta = 4
      expect(result.manualSetup).toHaveLength(4);
    });
  });
});

describe('URL normalization helpers', () => {
  describe('ensureHttps', () => {
    it.each([
      ['idp.example.com', 'https://idp.example.com'],
      ['https://idp.example.com', 'https://idp.example.com'],
      ['http://idp.example.com', 'https://idp.example.com'],
    ])('%s → %s', (input, expected) => {
      expect(ensureHttps(input)).toBe(expected);
    });
  });

  describe('ensureWellKnown', () => {
    it.each([
      ['https://idp.example.com', 'https://idp.example.com/.well-known/openid-configuration'],
      ['https://idp.example.com/', 'https://idp.example.com/.well-known/openid-configuration'],
      [
        'https://idp.example.com/.well-known/openid-configuration',
        'https://idp.example.com/.well-known/openid-configuration',
      ],
    ])('%s → %s', (input, expected) => {
      expect(ensureWellKnown(input)).toBe(expected);
    });
  });
});
