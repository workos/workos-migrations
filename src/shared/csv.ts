/**
 * Shared CSV helpers + column schemas for WorkOS import CSVs.
 *
 * Schemas align with the existing helpers reference repo plus the newer
 * `name` / `customAttributes` columns flagged as shipping soon.
 */

export const COMMON_HEADERS = [
  'organizationName',
  'organizationId',
  'organizationExternalId',
  'domains',
  'importedId',
  'connectionBookmarks',
] as const;

export const SAML_HEADERS = [
  ...COMMON_HEADERS,
  'idpEntityId',
  'idpUrl',
  'x509Cert',
  'idpIdAttribute',
  'emailAttribute',
  'firstNameAttribute',
  'lastNameAttribute',
  'name',
  'customAttributes',
  'idpMetadataUrl',
  'customEntityId',
  'customAcsUrl',
  'idpInitiatedSsoEnabled',
  'defaultConnectionBookmarkForIdpInitiatedSso',
] as const;

export const OIDC_HEADERS = [
  ...COMMON_HEADERS,
  'clientId',
  'clientSecret',
  'discoveryEndpoint',
  'customRedirectUri',
  'name',
  'customAttributes',
] as const;

export function escapeCSVField(field: string | undefined | null): string {
  const value = String(field ?? '');
  return `"${value.replace(/"/g, '""')}"`;
}

export function createCSVRow(fields: (string | undefined | null)[]): string {
  return fields.map(escapeCSVField).join(',');
}

export function createCSV(header: readonly string[], rows: string[]): string {
  return [header.join(','), ...rows].join('\n');
}

/** Build a CSV from rows keyed by header name; fields missing from a row become empty strings. */
export function createCSVFromRecords(
  header: readonly string[],
  records: Record<string, string>[],
): string {
  const rowStrings = records.map((record) =>
    createCSVRow(header.map((h) => record[h] ?? '')),
  );
  return createCSV(header, rowStrings);
}
