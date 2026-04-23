/**
 * Shared CSV helpers + column schemas for WorkOS import CSVs.
 *
 * Schemas match the official WorkOS import templates, with the new `name` and
 * `customAttributes` columns that WorkOS is adding as standard fields.
 */

/** SAML connections import template. */
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

/** OIDC connections import template. */
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

/** Users import template. */
export const USER_HEADERS = [
  'user_id',
  'email',
  'email_verified',
  'first_name',
  'last_name',
  'password_hash',
] as const;

/** Supplementary debug view: per-attribute mappings not covered by the main columns. */
export const CUSTOM_ATTR_HEADERS = [
  'importedId',
  'organizationExternalId',
  'providerType',
  'userPoolAttribute',
  'idpClaim',
] as const;

export type SamlHeader = (typeof SAML_HEADERS)[number];
export type OidcHeader = (typeof OIDC_HEADERS)[number];
export type UserHeader = (typeof USER_HEADERS)[number];
export type CustomAttrHeader = (typeof CUSTOM_ATTR_HEADERS)[number];

export type SamlRow = Record<SamlHeader, string>;
export type OidcRow = Record<OidcHeader, string>;
export type UserRow = Record<UserHeader, string>;
export type CustomAttrRow = Record<CustomAttrHeader, string>;

// ---------------------------------------------------------------------------
// CSV primitives
// ---------------------------------------------------------------------------

export function escapeCSVField(field: string | undefined | null): string {
  const value = String(field ?? '');
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function createCSVRow(fields: (string | undefined | null)[]): string {
  return fields.map(escapeCSVField).join(',');
}

export function createCSV(header: readonly string[], rows: string[]): string {
  return [header.join(','), ...rows].join('\n') + '\n';
}

/** Render a list of records keyed by header name into a CSV string. */
export function rowsToCsv(
  headers: readonly string[],
  rows: Record<string, string | undefined | null>[],
): string {
  const escape = (value: string | undefined | null): string => escapeCSVField(value);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}
