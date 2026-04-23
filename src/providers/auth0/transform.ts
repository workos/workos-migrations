/**
 * Strategy-specific Auth0 → WorkOS connection transforms.
 *
 * Ported from the existing codebase/src/providers/auth0/transform.ts with
 * minor adaptations to fit this repo's live-fetch pipeline.
 */
import type { Auth0Connection, Auth0Client as Auth0AppClient } from './client';
import {
  SAML_HEADERS,
  OIDC_HEADERS,
  createCSV,
  createCSVRow,
} from '../../shared/csv';

export interface Auth0TransformConfig {
  /** Auth0 tenant's custom domain used in the synthesized customAcsUrl / customRedirectUri. */
  customDomain?: string;
  /** Prefix for synthesized SAML customEntityId. Example: "urn:acme:sso:" */
  entityIdPrefix?: string;
  /** Map of Auth0 client_id → WorkOS bookmark slug. Used for connectionBookmarks column. */
  bookmarkSlugMap?: Record<string, string>;
  /** Prefix applied to organizationName for migrated connections. Default: "[MIGRATED] sso-" */
  organizationNamePrefix?: string;
}

const DEFAULT_ORG_NAME_PREFIX = '[MIGRATED] sso-';

export interface SkippedConnection {
  connectionName: string;
  reason: string;
  type: 'SAML' | 'OIDC';
}

export interface ManualSetupConnection {
  connectionName: string;
  strategy: string;
  reason: string;
}

export interface TransformResult {
  samlCsv: string;
  oidcCsv: string;
  samlCount: number;
  oidcCount: number;
  skipped: SkippedConnection[];
  manualSetup: ManualSetupConnection[];
  samlIdpInitiatedDisabled: string[];
}

export function transformAuth0Connections(
  connections: Auth0Connection[],
  clients: Auth0AppClient[] | undefined,
  config: Auth0TransformConfig,
): TransformResult {
  const bookmarkSlugMap = config.bookmarkSlugMap ?? {};
  const orgNamePrefix = config.organizationNamePrefix ?? DEFAULT_ORG_NAME_PREFIX;

  const samlRows: string[] = [];
  const oidcRows: string[] = [];
  const samlIdpInitiatedDisabled: string[] = [];
  const skipped: SkippedConnection[] = [];
  const manualSetup: ManualSetupConnection[] = [];

  for (const connection of connections) {
    const bookmarks = (connection.enabled_clients ?? [])
      .map((clientId) => bookmarkSlugMap[clientId])
      .filter(Boolean);
    const uniqueBookmarks = [...new Set(bookmarks)];

    const commonRow = [
      `${orgNamePrefix}${connection.name}`, // organizationName
      '', // organizationId
      connection.name, // organizationExternalId
      '', // domains
      connection.name, // importedId
      JSON.stringify(uniqueBookmarks), // connectionBookmarks
    ];

    if (bookmarks.length === 0) {
      const connectionType = connection.strategy === 'samlp' ? 'SAML' : 'OIDC';
      skipped.push({
        connectionName: connection.name,
        reason: 'No applications enabled',
        type: connectionType,
      });
      continue;
    }

    switch (connection.strategy) {
      case 'samlp':
        processSaml(connection, commonRow, config, samlRows, samlIdpInitiatedDisabled);
        break;
      case 'oidc':
        processOidc(connection, commonRow, config, oidcRows, skipped);
        break;
      case 'waad':
        processWaad(connection, commonRow, config, oidcRows, skipped);
        break;
      case 'adfs':
        processAdfs(connection, commonRow, config, samlRows);
        break;
      case 'pingfederate':
        processPingFederate(connection, commonRow, config, samlRows);
        break;
      case 'google-apps':
        processGoogleApps(connection, commonRow, config, oidcRows);
        manualSetup.push({
          connectionName: connection.name,
          strategy: connection.strategy,
          reason: 'Imported without client_secret — must be added manually in WorkOS after import',
        });
        break;
      case 'ad':
      case 'auth0-adldap':
        manualSetup.push({
          connectionName: connection.name,
          strategy: connection.strategy,
          reason: 'On-prem AD/LDAP connector — no automated migration path, requires manual setup',
        });
        break;
      default:
        manualSetup.push({
          connectionName: connection.name,
          strategy: connection.strategy,
          reason: `Unrecognized strategy "${connection.strategy}" — requires manual review`,
        });
        break;
    }
  }

  return {
    samlCsv: createCSV(SAML_HEADERS, samlRows),
    oidcCsv: createCSV(OIDC_HEADERS, oidcRows),
    samlCount: samlRows.length,
    oidcCount: oidcRows.length,
    skipped,
    manualSetup,
    samlIdpInitiatedDisabled,
  };
}

// ---------------------------------------------------------------------------
// Strategy-specific processors
// ---------------------------------------------------------------------------

function processSaml(
  connection: Auth0Connection,
  commonRow: string[],
  config: Auth0TransformConfig,
  samlRows: string[],
  samlIdpInitiatedDisabled: string[],
): void {
  const options = connection.options || {};
  const rawFieldsMap = options.fieldsMap || {};

  const firstOf = (v: unknown): string => {
    if (Array.isArray(v)) return (v[0] as string) ?? '';
    return (v as string) ?? '';
  };

  const attributeMapping = {
    id: firstOf(rawFieldsMap.id),
    email: firstOf(rawFieldsMap.email),
    given_name: firstOf(rawFieldsMap.given_name),
    family_name: firstOf(rawFieldsMap.family_name),
  };

  const defaultIdpInitClient = options.idpinitiated?.client_id;
  const defaultBookmarkForIdpInit =
    (defaultIdpInitClient && config.bookmarkSlugMap?.[defaultIdpInitClient]) || '';

  const customEntityId = config.entityIdPrefix
    ? `${config.entityIdPrefix}${connection.name}`
    : '';
  const customAcsUrl = config.customDomain
    ? `https://${config.customDomain}/login/callback?connection=${connection.name}`
    : '';

  samlRows.push(
    createCSVRow([
      ...commonRow,
      '', // idpEntityId
      options.signInEndpoint || '', // idpUrl
      options.cert || '', // x509Cert
      attributeMapping.id || '', // idpIdAttribute
      attributeMapping.email || '', // emailAttribute
      attributeMapping.given_name || '', // firstNameAttribute
      attributeMapping.family_name || '', // lastNameAttribute
      '', // name
      '', // customAttributes
      '', // idpMetadataUrl
      customEntityId,
      customAcsUrl,
      options.idpinitiated?.enabled ? 'true' : 'false', // idpInitiatedSsoEnabled
      defaultBookmarkForIdpInit, // defaultConnectionBookmarkForIdpInitiatedSso
    ]),
  );

  if (!options.idpinitiated?.enabled) {
    samlIdpInitiatedDisabled.push(connection.name);
  }
}

function processOidc(
  connection: Auth0Connection,
  commonRow: string[],
  config: Auth0TransformConfig,
  oidcRows: string[],
  skipped: SkippedConnection[],
): void {
  const options = connection.options || {};

  if (options.type !== 'back_channel') {
    skipped.push({
      connectionName: connection.name,
      reason: 'OIDC connection is not a back_channel connection',
      type: 'OIDC',
    });
    return;
  }

  const rawDiscovery =
    options.discovery_url || options.oidc_metadata?.issuer || options.issuer;

  if (!rawDiscovery) {
    skipped.push({
      connectionName: connection.name,
      reason: 'No discovery endpoint found',
      type: 'OIDC',
    });
    return;
  }

  const discoveryEndpoint = ensureHttps(ensureWellKnown(rawDiscovery));

  try {
    new URL(discoveryEndpoint);
  } catch {
    skipped.push({
      connectionName: connection.name,
      reason: 'Invalid discovery endpoint',
      type: 'OIDC',
    });
    return;
  }

  const customRedirectUri = config.customDomain
    ? `https://${config.customDomain}/login/callback`
    : '';

  oidcRows.push(
    createCSVRow([
      ...commonRow,
      options.client_id || '', // clientId
      options.client_secret || '', // clientSecret
      discoveryEndpoint, // discoveryEndpoint
      customRedirectUri, // customRedirectUri
      '', // name
      '', // customAttributes
    ]),
  );
}

function processWaad(
  connection: Auth0Connection,
  commonRow: string[],
  config: Auth0TransformConfig,
  oidcRows: string[],
  skipped: SkippedConnection[],
): void {
  const options = connection.options || {};
  const tenantDomain = options.tenant_domain || options.domain;

  if (!tenantDomain) {
    skipped.push({
      connectionName: connection.name,
      reason: 'Azure AD connection missing tenant domain',
      type: 'OIDC',
    });
    return;
  }

  const discoveryEndpoint = `https://login.microsoftonline.com/${tenantDomain}/.well-known/openid-configuration`;
  const customRedirectUri = config.customDomain
    ? `https://${config.customDomain}/login/callback`
    : '';

  oidcRows.push(
    createCSVRow([
      ...commonRow,
      options.client_id || '',
      options.client_secret || '',
      discoveryEndpoint,
      customRedirectUri,
      '', // name
      '', // customAttributes
    ]),
  );
}

function processGoogleApps(
  connection: Auth0Connection,
  commonRow: string[],
  config: Auth0TransformConfig,
  oidcRows: string[],
): void {
  const options = connection.options || {};
  const discoveryEndpoint =
    'https://accounts.google.com/.well-known/openid-configuration';
  const customRedirectUri = config.customDomain
    ? `https://${config.customDomain}/login/callback`
    : '';

  oidcRows.push(
    createCSVRow([
      ...commonRow,
      options.client_id || '',
      '', // clientSecret — not available from Auth0 API for google-apps
      discoveryEndpoint,
      customRedirectUri,
      '', // name
      '', // customAttributes
    ]),
  );
}

function processAdfs(
  connection: Auth0Connection,
  commonRow: string[],
  config: Auth0TransformConfig,
  samlRows: string[],
): void {
  const options = connection.options || {};
  const customEntityId = config.entityIdPrefix
    ? `${config.entityIdPrefix}${connection.name}`
    : '';
  const customAcsUrl = config.customDomain
    ? `https://${config.customDomain}/login/callback?connection=${connection.name}`
    : '';

  samlRows.push(
    createCSVRow([
      ...commonRow,
      '', // idpEntityId
      '', // idpUrl
      '', // x509Cert
      '', // idpIdAttribute
      '', // emailAttribute
      '', // firstNameAttribute
      '', // lastNameAttribute
      '', // name
      '', // customAttributes
      options.adfs_server || '', // idpMetadataUrl
      customEntityId,
      customAcsUrl,
      'false', // idpInitiatedSsoEnabled
      '', // defaultConnectionBookmarkForIdpInitiatedSso
    ]),
  );
}

function processPingFederate(
  connection: Auth0Connection,
  commonRow: string[],
  config: Auth0TransformConfig,
  samlRows: string[],
): void {
  const options = connection.options || {};
  const customEntityId = config.entityIdPrefix
    ? `${config.entityIdPrefix}${connection.name}`
    : '';
  const customAcsUrl = config.customDomain
    ? `https://${config.customDomain}/login/callback?connection=${connection.name}`
    : '';

  samlRows.push(
    createCSVRow([
      ...commonRow,
      '', // idpEntityId
      options.pingfederate_base_url || '', // idpUrl
      options.signing_cert || options.signingCert || '', // x509Cert
      '', // idpIdAttribute
      '', // emailAttribute
      '', // firstNameAttribute
      '', // lastNameAttribute
      '', // name
      '', // customAttributes
      '', // idpMetadataUrl
      customEntityId,
      customAcsUrl,
      options.idpinitiated?.enabled ? 'true' : 'false',
      '',
    ]),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureWellKnown(url: string): string {
  const suffix = '/.well-known/openid-configuration';
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith(suffix) ? trimmed : trimmed + suffix;
}

function ensureHttps(url: string): string {
  if (url.startsWith('https://')) return url;
  if (url.startsWith('http://')) return 'https://' + url.slice('http://'.length);
  return 'https://' + url;
}
