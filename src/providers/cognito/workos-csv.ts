/**
 * Cognito-specific row builders that produce rows matching the shared WorkOS
 * import templates (see src/shared/csv.ts).
 */
import { parseSamlMetadata, normalizeDiscoveryEndpoint } from './saml-metadata';
import { splitName } from '../../shared/names';
import {
  SAML_HEADERS,
  OIDC_HEADERS,
  USER_HEADERS,
  CUSTOM_ATTR_HEADERS,
  SamlRow,
  OidcRow,
  UserRow,
  CustomAttrRow,
  rowsToCsv,
} from '../../shared/csv';

export {
  SAML_HEADERS,
  OIDC_HEADERS,
  USER_HEADERS,
  CUSTOM_ATTR_HEADERS,
  rowsToCsv,
};
export type { SamlRow, OidcRow, UserRow, CustomAttrRow };

// ---------------------------------------------------------------------------
// Cognito attribute-mapping keys (shape of `AttributeMapping` dict)
// ---------------------------------------------------------------------------

const UP_EMAIL = 'email';
const UP_GIVEN_NAME = 'given_name';
const UP_FAMILY_NAME = 'family_name';
const UP_NAME = 'name';

/** Everything in this set lands in the supplementary debug CSV. */
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

export interface CognitoUser {
  userPoolId: string;
  /** Cognito's login identifier — can be email, phone, or sub. */
  username: string;
  /** Flattened attribute map — { email: 'x@y.com', sub: '...', given_name: 'Jane' }. */
  attributes: Record<string, string>;
  userStatus?: string;
  enabled?: boolean;
}

export interface ProxyTemplates {
  samlCustomAcsUrl?: string | null;
  samlCustomEntityId?: string | null;
  oidcCustomRedirectUri?: string | null;
}

/** Default matches the Cognito SP entity ID that customer IdPs already have configured. */
export const DEFAULT_SAML_CUSTOM_ENTITY_ID_TEMPLATE = 'urn:amazon:cognito:sp:{user_pool_id}';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isSaml(p: CognitoProvider): boolean {
  return p.providerType.toUpperCase() === 'SAML';
}

export function isOidc(p: CognitoProvider): boolean {
  return p.providerType.toUpperCase() === 'OIDC';
}

export function importedId(p: CognitoProvider): string {
  return `${p.userPoolId}:${p.providerName}`;
}

export function renderTemplate(
  template: string | null | undefined,
  p: CognitoProvider,
): string {
  if (!template) return '';
  return template
    .replace(/\{provider_name\}/g, p.providerName)
    .replace(/\{user_pool_id\}/g, p.userPoolId)
    .replace(/\{region\}/g, p.region);
}

/** 'custom:<name>' attribute mappings → compact JSON with the 'custom:' prefix stripped. */
export function buildCustomAttributesJson(attrs: Record<string, string>): string {
  const entries = Object.entries(attrs)
    .filter(([k, v]) => k.startsWith('custom:') && v)
    .map(([k, v]) => [k.substring('custom:'.length), v] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '';
  return JSON.stringify(Object.fromEntries(entries));
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

export function toUserRow(u: CognitoUser): UserRow {
  const a = u.attributes;
  const { first, last } = splitName(a.name ?? '');

  return {
    user_id: a.sub ?? u.username,
    email: a.email ?? '',
    email_verified: a.email_verified ?? '',
    first_name: a.given_name ?? first,
    last_name: a.family_name ?? last,
    password_hash: '',
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
