import type { CustomAttrRow, OidcRow, SamlRow } from './handoff.js';
import {
  isOidcConnectionType,
  isSamlConnectionType,
  normalizeConnectionType,
} from './connection-types.js';
import { normalizeDiscoveryEndpoint } from './saml-metadata.js';
import type {
  ConnectionKeyPair,
  CreateConnectionAttributeMaps,
  CreateConnectionRequest,
  CreateConnectionSamlOptions,
  CreateConnectionStandardAttributes,
} from './connections-api.js';

/**
 * Translate migration-package SSO rows (`sso/saml_connections.csv`,
 * `sso/oidc_connections.csv`, `sso/custom_attribute_mappings.csv`) into
 * `POST /connections` payloads.
 *
 * Mapping is pure: organization resolution and API calls happen in the
 * importer. Anything that cannot be expressed on the API is reported as a
 * warning (still importable) or a skip (not importable as-is).
 */

export type ConnectionMappingSkipCode =
  | 'missing_organization'
  | 'incomplete_saml_configuration'
  | 'incomplete_oidc_configuration'
  | 'client_secret_missing';

export type ConnectionMappingWarningCode =
  | 'unknown_connection_type'
  | 'connection_type_protocol_mismatch'
  | 'sp_signing_key_pair_incomplete'
  | 'sp_encryption_key_pair_incomplete'
  | 'name_id_encryption_key_unsupported'
  | 'idp_initiated_sso_not_configurable'
  | 'manual_idp_fields_ignored';

export interface ConnectionMappingWarning {
  code: ConnectionMappingWarningCode;
  message: string;
}

export type ConnectionMappingResult =
  | {
      ok: true;
      protocol: 'saml' | 'oidc';
      request: CreateConnectionRequest;
      warnings: ConnectionMappingWarning[];
    }
  | {
      ok: false;
      protocol: 'saml' | 'oidc';
      code: ConnectionMappingSkipCode;
      message: string;
      warnings: ConnectionMappingWarning[];
    };

export interface SamlMappingInput {
  row: SamlRow;
  /** WorkOS organization id the connection will be created in. */
  organizationId: string;
  /** `custom attribute name -> IdP claim` for this connection. */
  customAttributes?: Record<string, string>;
}

export interface OidcMappingInput {
  row: OidcRow;
  organizationId: string;
  customAttributes?: Record<string, string>;
  /** Overrides the CSV `clientSecret` (for example from a secrets sidecar file). */
  clientSecret?: string;
}

export function buildSamlConnectionRequest(input: SamlMappingInput): ConnectionMappingResult {
  const { row } = input;
  const warnings: ConnectionMappingWarning[] = [];

  const idpMetadataUrl = clean(row.idpMetadataUrl);
  const idpSsoUrl = clean(row.idpUrl);
  const idpEntityId = clean(row.idpEntityId);
  const x509Cert = clean(row.x509Cert);

  let samlOptions: CreateConnectionSamlOptions;
  if (idpMetadataUrl) {
    samlOptions = { idp_metadata_url: idpMetadataUrl };
    if (idpSsoUrl || x509Cert) {
      warnings.push({
        code: 'manual_idp_fields_ignored',
        message:
          'idpMetadataUrl is set, so idpEntityId/idpUrl/x509Cert were not sent; WorkOS reads the IdP configuration from the metadata URL.',
      });
    }
  } else {
    const missing: string[] = [];
    if (!idpSsoUrl) missing.push('idpUrl');
    if (!x509Cert) missing.push('x509Cert');
    if (missing.length > 0) {
      return {
        ok: false,
        protocol: 'saml',
        code: 'incomplete_saml_configuration',
        message: `SAML connection needs idpMetadataUrl, or idpUrl plus x509Cert (missing: ${missing.join(', ')}).`,
        warnings,
      };
    }
    samlOptions = {
      ...(idpEntityId ? { idp_entity_id: idpEntityId } : {}),
      idp_sso_url: idpSsoUrl,
      idp_signing_certs: [toPemCertificate(x509Cert)],
    };
  }

  const acsUrl = clean(row.customAcsUrl);
  const spEntityId = clean(row.customEntityId);
  if (acsUrl) samlOptions.acs_url = acsUrl;
  if (spEntityId) samlOptions.sp_entity_id = spEntityId;

  const signingPair = buildKeyPair(row.requestSigningKey, row.requestSigningCert);
  if (signingPair.status === 'complete') {
    samlOptions.sp_signing_key_pair = signingPair.pair;
  } else if (signingPair.status === 'incomplete') {
    warnings.push({
      code: 'sp_signing_key_pair_incomplete',
      message:
        'requestSigningKey/requestSigningCert must both be present to bring your own SP signing key pair; WorkOS generated the signing key pair instead. Update the customer IdP with the new SP certificate before relying on signed requests.',
    });
  }

  const encryptionPair = buildKeyPair(row.assertionEncryptionKey, row.assertionEncryptionCert);
  if (encryptionPair.status === 'complete') {
    samlOptions.sp_encryption_key_pairs = [encryptionPair.pair];
  } else if (encryptionPair.status === 'incomplete') {
    warnings.push({
      code: 'sp_encryption_key_pair_incomplete',
      message:
        'assertionEncryptionKey/assertionEncryptionCert must both be present to bring your own SP encryption key pair; WorkOS generated the encryption key pair instead. Update the customer IdP with the new SP encryption certificate before relying on encrypted assertions.',
    });
  }

  if (clean(row.nameIdEncryptionKey)) {
    warnings.push({
      code: 'name_id_encryption_key_unsupported',
      message:
        'nameIdEncryptionKey has no Connections API equivalent and was not applied. Encrypted NameIDs are decrypted with the SP encryption key pair.',
    });
  }

  if (isTruthy(row.idpInitiatedEnabled)) {
    warnings.push({
      code: 'idp_initiated_sso_not_configurable',
      message:
        'idpInitiatedEnabled is true but IdP-initiated SSO cannot be enabled through the Connections API yet. Enable it on the connection in the WorkOS dashboard after import.',
    });
  }

  const connectionType = resolveConnectionType(row.connectionType, 'saml', warnings);

  const standardAttributes: CreateConnectionStandardAttributes = compact({
    idp_id: clean(row.idpIdAttribute),
    email: clean(row.emailAttribute),
    first_name: clean(row.firstNameAttribute),
    last_name: clean(row.lastNameAttribute),
    name: clean(row.nameAttribute),
  });

  const attributeMaps = buildAttributeMaps(standardAttributes, input.customAttributes);

  const request: CreateConnectionRequest = {
    organization_id: input.organizationId,
    name: connectionDisplayName(row.name, row.organizationName, row.externalId),
    ...(clean(row.externalId) ? { external_id: clean(row.externalId) } : {}),
    ...(connectionType ? { connection_type: connectionType } : {}),
    saml_options: samlOptions,
    ...(attributeMaps ? { attribute_maps: attributeMaps } : {}),
  };

  return { ok: true, protocol: 'saml', request, warnings };
}

export function buildOidcConnectionRequest(input: OidcMappingInput): ConnectionMappingResult {
  const { row } = input;
  const warnings: ConnectionMappingWarning[] = [];

  const discoveryEndpoint = normalizeDiscoveryEndpoint(clean(row.discoveryEndpoint)) ?? '';
  const clientId = clean(row.clientId);
  const missing: string[] = [];
  if (!discoveryEndpoint) missing.push('discoveryEndpoint');
  if (!clientId) missing.push('clientId');
  if (missing.length > 0) {
    return {
      ok: false,
      protocol: 'oidc',
      code: 'incomplete_oidc_configuration',
      message: `OIDC connection needs discoveryEndpoint and clientId (missing: ${missing.join(', ')}).`,
      warnings,
    };
  }

  const clientSecret = clean(input.clientSecret) || clean(row.clientSecret);
  if (!clientSecret) {
    return {
      ok: false,
      protocol: 'oidc',
      code: 'client_secret_missing',
      message:
        'OIDC clientSecret is empty (exporters redact it by default). Re-export with --include-secrets, supply it via --sso-secrets <file>, or create the connection manually.',
      warnings,
    };
  }

  const connectionType = resolveConnectionType(row.connectionType, 'oidc', warnings);
  const attributeMaps = buildAttributeMaps(undefined, input.customAttributes);
  const redirectUri = clean(row.customRedirectUri);

  const request: CreateConnectionRequest = {
    organization_id: input.organizationId,
    name: connectionDisplayName(row.name, row.organizationName, row.externalId),
    ...(clean(row.externalId) ? { external_id: clean(row.externalId) } : {}),
    ...(connectionType ? { connection_type: connectionType } : {}),
    oidc_options: {
      discovery_endpoint: discoveryEndpoint,
      client_id: clientId,
      client_secret: clientSecret,
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    },
    ...(attributeMaps ? { attribute_maps: attributeMaps } : {}),
  };

  return { ok: true, protocol: 'oidc', request, warnings };
}

/**
 * Group `sso/custom_attribute_mappings.csv` rows by connection externalId into
 * `{ customAttributeName: idpClaim }` records.
 */
export function groupCustomAttributeMappings(
  rows: Iterable<Partial<CustomAttrRow>>,
): Map<string, Record<string, string>> {
  const grouped = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const externalId = clean(row.externalId);
    const attribute = clean(row.userPoolAttribute);
    const claim = clean(row.idpClaim);
    if (!externalId || !attribute || !claim) continue;
    const record = grouped.get(externalId) ?? {};
    record[attribute] = claim;
    grouped.set(externalId, record);
  }
  return grouped;
}

/** Split an exported `domains` cell (`,` or `;` separated) into clean, unique host names. */
export function parseDomainList(value: string | undefined | null): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const raw of value.split(/[;,]/)) {
    const domain = raw.trim().toLowerCase();
    // Wildcards (Clerk allow_subdomains) are not valid organization domains.
    if (!domain || domain.startsWith('*')) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

/**
 * Normalize an X.509 certificate into PEM. Accepts PEM (with real or escaped
 * newlines) or a bare base64 body as emitted by SAML metadata parsing.
 */
export function toPemCertificate(value: string): string {
  return toPem(value, 'CERTIFICATE');
}

/** Normalize a private key into PEM, tolerating escaped newlines and bare base64 (assumed PKCS#8). */
export function toPemPrivateKey(value: string): string {
  return toPem(value, 'PRIVATE KEY');
}

function toPem(value: string, defaultLabel: string): string {
  const unescaped = value.trim().replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '');
  const match = unescaped.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
  if (match) {
    const label = match[1];
    const body = match[2].replace(/\s+/g, '');
    return wrapPem(label, body);
  }
  return wrapPem(defaultLabel, unescaped.replace(/\s+/g, ''));
}

function wrapPem(label: string, body: string): string {
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

type KeyPairBuild =
  | { status: 'absent' }
  | { status: 'incomplete' }
  | { status: 'complete'; pair: ConnectionKeyPair };

function buildKeyPair(key: string | undefined, cert: string | undefined): KeyPairBuild {
  const cleanKey = clean(key);
  const cleanCert = clean(cert);
  if (!cleanKey && !cleanCert) return { status: 'absent' };
  if (!cleanKey || !cleanCert) return { status: 'incomplete' };
  return {
    status: 'complete',
    pair: { key: toPemPrivateKey(cleanKey), cert: toPemCertificate(cleanCert) },
  };
}

function resolveConnectionType(
  value: string | undefined,
  protocol: 'saml' | 'oidc',
  warnings: ConnectionMappingWarning[],
): string | undefined {
  const raw = clean(value);
  if (!raw) return undefined;
  const normalized = normalizeConnectionType(raw);
  if (!normalized) {
    warnings.push({
      code: 'unknown_connection_type',
      message: `connectionType "${raw}" is not a WorkOS connection type; WorkOS inferred the type from the protocol options instead.`,
    });
    return undefined;
  }
  const matchesProtocol =
    protocol === 'saml' ? isSamlConnectionType(normalized) : isOidcConnectionType(normalized);
  if (!matchesProtocol) {
    warnings.push({
      code: 'connection_type_protocol_mismatch',
      message: `connectionType "${normalized}" is not a ${protocol.toUpperCase()} type; WorkOS inferred the type from the protocol options instead.`,
    });
    return undefined;
  }
  return normalized;
}

function buildAttributeMaps(
  standard: CreateConnectionStandardAttributes | undefined,
  custom: Record<string, string> | undefined,
): CreateConnectionAttributeMaps | undefined {
  const maps: CreateConnectionAttributeMaps = {};
  if (standard && Object.keys(standard).length > 0) maps.standard_attributes = standard;
  if (custom && Object.keys(custom).length > 0) maps.custom_attributes = { ...custom };
  return Object.keys(maps).length > 0 ? maps : undefined;
}

function connectionDisplayName(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const value = clean(candidate);
    if (value) return value;
  }
  return 'Migrated SSO connection';
}

function compact(record: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value) result[key] = value;
  }
  return result;
}

function clean(value: string | undefined | null): string {
  return value == null ? '' : String(value).trim();
}

function isTruthy(value: string | undefined): boolean {
  const normalized = clean(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
}
