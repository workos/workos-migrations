/**
 * WorkOS SSO connection import CSV schemas + row builders.
 */
import { parseSamlMetadata, normalizeDiscoveryEndpoint } from './saml-metadata.js';

export const SAML_HEADERS = [
  'organizationName',
  'organizationId',
  'organizationExternalId',
  'domains',
  'idpEntityId',
  'idpUrl',
  'x509Cert',
  'idpMetadataUrl',
  'customEntityId',
  'customAcsUrl',
  'idpIdAttribute',
  'emailAttribute',
  'firstNameAttribute',
  'lastNameAttribute',
  'name',
  'customAttributes',
  'idpInitiatedEnabled',
  'requestSigningKey',
  'assertionEncryptionKey',
  'nameIdEncryptionKey',
  'importedId',
] as const;

export const OIDC_HEADERS = [
  'organizationName',
  'organizationId',
  'organizationExternalId',
  'domains',
  'clientId',
  'clientSecret',
  'discoveryEndpoint',
  'customRedirectUri',
  'name',
  'customAttributes',
  'importedId',
] as const;

export const CUSTOM_ATTR_HEADERS = [
  'importedId',
  'organizationExternalId',
  'providerType',
  'userPoolAttribute',
  'idpClaim',
] as const;

/**
 * WorkOS users import template. `password_hash` is intentionally written
 * blank — Cognito does not expose password hashes. Users that relied on
 * email/password in Cognito will need to reset their password after
 * migration (or rely on SSO + JIT provisioning via the migration proxy).
 */
export const USER_HEADERS = [
  'external_id',
  'email',
  'email_verified',
  'first_name',
  'last_name',
  'password_hash',
] as const;

/** User pool attribute keys used in Cognito's AttributeMapping dict. */
const UP_EMAIL = 'email';
const UP_GIVEN_NAME = 'given_name';
const UP_FAMILY_NAME = 'family_name';
const UP_NAME = 'name';

/** Anything in this set lands in the supplementary custom-attributes CSV for debug. */
const SUPPLEMENTARY_ATTR_KEYS = new Set<string>([
  UP_NAME,
  'custom:department',
  'custom:location',
  'custom:title',
  'custom:user_status',
  'custom:user_type',
]);

export interface CognitoProvider {
  userPoolId: string;
  providerName: string;
  providerType: string; // 'SAML' | 'OIDC' | ...
  region: string;
  providerDetails: Record<string, string>;
  attributeMapping: Record<string, string>;
  idpIdentifiers: string[];
}

export function isSaml(p: CognitoProvider): boolean {
  return p.providerType.toUpperCase() === 'SAML';
}

export function isOidc(p: CognitoProvider): boolean {
  return p.providerType.toUpperCase() === 'OIDC';
}

export function importedId(p: CognitoProvider): string {
  return `${p.userPoolId}:${p.providerName}`;
}

export interface ProxyTemplates {
  samlCustomAcsUrl?: string | null;
  samlCustomEntityId?: string | null;
  oidcCustomRedirectUri?: string | null;
}

/** Default pattern matches what customers' IdPs already have configured as the Cognito SP. */
export const DEFAULT_SAML_CUSTOM_ENTITY_ID_TEMPLATE = 'urn:amazon:cognito:sp:{user_pool_id}';

export function renderTemplate(template: string | null | undefined, p: CognitoProvider): string {
  if (!template) return '';
  return template
    .replace(/\{provider_name\}/g, p.providerName)
    .replace(/\{user_pool_id\}/g, p.userPoolId)
    .replace(/\{region\}/g, p.region);
}

/** Cognito 'custom:<name>' mappings -> compact JSON blob with 'custom:' prefix stripped. */
export function buildCustomAttributesJson(attrs: Record<string, string>): string {
  const entries = Object.entries(attrs)
    .filter(([k, v]) => k.startsWith('custom:') && v)
    .map(([k, v]) => [k.substring('custom:'.length), v] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '';
  return JSON.stringify(Object.fromEntries(entries));
}

export type SamlRow = Record<(typeof SAML_HEADERS)[number], string>;
export type OidcRow = Record<(typeof OIDC_HEADERS)[number], string>;
export type CustomAttrRow = Record<(typeof CUSTOM_ATTR_HEADERS)[number], string>;
export type UserRow = Record<(typeof USER_HEADERS)[number], string>;

export interface CognitoUser {
  userPoolId: string;
  /** Cognito's login identifier — can be email, phone, or sub. */
  username: string;
  /** Flattened attribute map — { email: 'x@y.com', sub: '...', given_name: 'Jane' }. */
  attributes: Record<string, string>;
  userStatus?: string;
  enabled?: boolean;
}

/** Cognito user statuses that indicate a federated (SSO/social) identity. */
export const FEDERATED_USER_STATUSES: ReadonlySet<string> = new Set(['EXTERNAL_PROVIDER']);

/**
 * True when the user's `userStatus` marks them as a federated identity that
 * WorkOS will JIT-provision on first SSO login. Drives the
 * `--skip-external-provider-users` filter.
 */
export function isFederatedUser(u: CognitoUser): boolean {
  return FEDERATED_USER_STATUSES.has(u.userStatus ?? '');
}

/**
 * Map a Cognito user into the WorkOS users.csv template.
 *
 *   external_id    → Cognito `sub` attribute (stable unique ID), falls back to username
 *   email          → Cognito `email` attribute
 *   email_verified → Cognito `email_verified` attribute (Cognito returns 'true'/'false' strings)
 *   first_name     → `given_name`, falling back to the first whitespace-split token of `name`
 *   last_name      → `family_name`, falling back to the remaining tokens of `name`
 *   password_hash  → always blank (Cognito does not export password hashes)
 */
export function toUserRow(u: CognitoUser): UserRow {
  const a = u.attributes;
  const { first, last } = splitName(a.name ?? '');

  return {
    external_id: a.sub ?? u.username,
    email: a.email ?? '',
    email_verified: a.email_verified ?? '',
    first_name: a.given_name ?? first,
    last_name: a.family_name ?? last,
    password_hash: '',
  };
}

/** Whitespace-split a full name into first/last halves. Multi-word last names stay intact. */
export function splitName(name: string): { first: string; last: string } {
  const trimmed = name.trim();
  if (!trimmed) return { first: '', last: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return {
    first: parts[0],
    last: parts.slice(1).join(' '),
  };
}

export function toSamlRow(p: CognitoProvider, proxy: ProxyTemplates = {}): SamlRow {
  const details = p.providerDetails;
  const attrs = p.attributeMapping;

  const metadataUrl = details.MetadataURL ?? '';
  const metadataXml = details.MetadataFile ?? '';
  const parsed = metadataXml ? parseSamlMetadata(metadataXml) : null;

  return {
    organizationName: p.providerName,
    organizationId: '',
    organizationExternalId: p.providerName,
    domains: '',
    idpEntityId: parsed?.entityId ?? details.EntityId ?? '',
    idpUrl: parsed?.ssoRedirectUrl ?? details.SSORedirectBindingURI ?? '',
    x509Cert: parsed?.x509Cert ?? '',
    idpMetadataUrl: metadataUrl,
    customEntityId: renderTemplate(proxy.samlCustomEntityId ?? null, p),
    customAcsUrl: renderTemplate(proxy.samlCustomAcsUrl ?? null, p),
    idpIdAttribute: '',
    emailAttribute: attrs[UP_EMAIL] ?? '',
    firstNameAttribute: attrs[UP_GIVEN_NAME] ?? '',
    lastNameAttribute: attrs[UP_FAMILY_NAME] ?? '',
    name: attrs[UP_NAME] ?? '',
    customAttributes: buildCustomAttributesJson(attrs),
    idpInitiatedEnabled: 'TRUE',
    requestSigningKey: '',
    assertionEncryptionKey: '',
    nameIdEncryptionKey: '',
    importedId: importedId(p),
  };
}

export function toOidcRow(p: CognitoProvider, proxy: ProxyTemplates = {}): OidcRow {
  const details = p.providerDetails;
  const attrs = p.attributeMapping;

  return {
    organizationName: p.providerName,
    organizationId: '',
    organizationExternalId: p.providerName,
    domains: '',
    clientId: details.client_id ?? '',
    clientSecret: details.client_secret ?? '',
    discoveryEndpoint: normalizeDiscoveryEndpoint(details.oidc_issuer) ?? '',
    customRedirectUri: renderTemplate(proxy.oidcCustomRedirectUri ?? null, p),
    name: attrs[UP_NAME] ?? '',
    customAttributes: buildCustomAttributesJson(attrs),
    importedId: importedId(p),
  };
}

export function toCustomAttrRows(p: CognitoProvider): CustomAttrRow[] {
  const rows: CustomAttrRow[] = [];
  for (const [attr, claim] of Object.entries(p.attributeMapping)) {
    if (!SUPPLEMENTARY_ATTR_KEYS.has(attr)) continue;
    rows.push({
      importedId: importedId(p),
      organizationExternalId: p.providerName,
      providerType: p.providerType,
      userPoolAttribute: attr,
      idpClaim: claim,
    });
  }
  return rows;
}

/** Produce a CSV string from headers + rows. Handles commas, quotes, and newlines. */
export function rowsToCsv(headers: readonly string[], rows: Record<string, string>[]): string {
  const escape = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}
