import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CUSTOM_ATTRIBUTE_MAPPING_CSV_HEADERS,
  OIDC_CONNECTION_CSV_HEADERS,
  PROXY_ROUTE_CSV_HEADERS,
  SAML_CONNECTION_CSV_HEADERS,
} from '../package/manifest.js';
import { createCSVWriter } from '../shared/csv-utils.js';

export const SAML_HEADERS = SAML_CONNECTION_CSV_HEADERS;
export const OIDC_HEADERS = OIDC_CONNECTION_CSV_HEADERS;
export const CUSTOM_ATTR_HEADERS = CUSTOM_ATTRIBUTE_MAPPING_CSV_HEADERS;
export const PROXY_ROUTE_HEADERS = PROXY_ROUTE_CSV_HEADERS;

export type SamlRow = Record<(typeof SAML_HEADERS)[number], string>;
export type OidcRow = Record<(typeof OIDC_HEADERS)[number], string>;
export type CustomAttrRow = Record<(typeof CUSTOM_ATTR_HEADERS)[number], string>;
export type ProxyRouteRow = Record<(typeof PROXY_ROUTE_HEADERS)[number], string>;

export type SamlRowInput = Partial<SamlRow>;
export type OidcRowInput = Partial<OidcRow>;
export type CustomAttrRowInput = Partial<CustomAttrRow>;
export type ProxyRouteRowInput = Partial<ProxyRouteRow>;

export function createSamlConnectionRow(input: SamlRowInput = {}): SamlRow {
  return createRow(SAML_HEADERS, input);
}

export function createOidcConnectionRow(input: OidcRowInput = {}): OidcRow {
  return createRow(OIDC_HEADERS, input);
}

export function createCustomAttributeMappingRow(input: CustomAttrRowInput = {}): CustomAttrRow {
  return createRow(CUSTOM_ATTR_HEADERS, input);
}

export function createProxyRouteRow(input: ProxyRouteRowInput = {}): ProxyRouteRow {
  return createRow(PROXY_ROUTE_HEADERS, input);
}

export async function writeSamlConnectionsCsv(
  filePath: string,
  rows: SamlRowInput[],
): Promise<number> {
  return writeCsvRows(
    filePath,
    SAML_HEADERS,
    rows.map((row) => createSamlConnectionRow(row)),
  );
}

export async function writeOidcConnectionsCsv(
  filePath: string,
  rows: OidcRowInput[],
): Promise<number> {
  return writeCsvRows(
    filePath,
    OIDC_HEADERS,
    rows.map((row) => createOidcConnectionRow(row)),
  );
}

export async function writeCustomAttributeMappingsCsv(
  filePath: string,
  rows: CustomAttrRowInput[],
): Promise<number> {
  return writeCsvRows(
    filePath,
    CUSTOM_ATTR_HEADERS,
    rows.map((row) => createCustomAttributeMappingRow(row)),
  );
}

export async function writeProxyRoutesCsv(
  filePath: string,
  rows: ProxyRouteRowInput[],
): Promise<number> {
  return writeCsvRows(
    filePath,
    PROXY_ROUTE_HEADERS,
    rows.map((row) => createProxyRouteRow(row)),
  );
}

export async function writeCsvRows(
  filePath: string,
  headers: readonly string[],
  rows: Record<string, unknown>[],
): Promise<number> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const writer = createCSVWriter(filePath, [...headers]);
  for (const row of rows) {
    writer.write(createRow(headers, row));
  }
  await writer.end();
  return rows.length;
}

/** Produce a CSV string from headers + rows. Handles commas, quotes, and newlines. */
export function rowsToCsv(headers: readonly string[], rows: Record<string, unknown>[]): string {
  const escape = (value: unknown): string => {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export type SsoWarningCode =
  | 'missing_domains'
  | 'secrets_redacted'
  | 'multi_org_connection_consolidated'
  | 'unsupported_connection_protocol'
  | 'incomplete_connection_configuration';

export interface SsoHandoffWarning {
  code: SsoWarningCode;
  message: string;
  provider?: string;
  protocol?: string;
  importedId?: string;
  organizationExternalId?: string;
  details?: Record<string, unknown>;
}

export function missingDomainsWarning(input: {
  provider: string;
  protocol: string;
  importedId?: string;
  organizationExternalId?: string;
  organizationName?: string;
}): SsoHandoffWarning {
  return {
    code: 'missing_domains',
    provider: input.provider,
    protocol: input.protocol,
    importedId: input.importedId,
    organizationExternalId: input.organizationExternalId,
    message: `No domains were exported for ${input.provider} ${input.protocol} connection${input.importedId ? ` ${input.importedId}` : ''}. Populate domains before WorkOS handoff when domain capture is required.`,
    details: {
      organizationName: input.organizationName,
    },
  };
}

export function redactedSecretsWarning(input: {
  provider: string;
  file?: string;
  fields: string[];
  importedId?: string;
  protocol?: string;
}): SsoHandoffWarning {
  return {
    code: 'secrets_redacted',
    provider: input.provider,
    protocol: input.protocol,
    importedId: input.importedId,
    message: `Secret fields were redacted from ${input.provider} SSO export output.`,
    details: {
      file: input.file,
      fields: input.fields,
    },
  };
}

export function multiOrgConnectionConsolidationWarning(input: {
  provider: string;
  protocol: string;
  importedId: string;
  organizationExternalId: string;
  sourceOrganizationIds: string[];
  domains: string[];
}): SsoHandoffWarning {
  return {
    code: 'multi_org_connection_consolidated',
    provider: input.provider,
    protocol: input.protocol,
    importedId: input.importedId,
    organizationExternalId: input.organizationExternalId,
    message: `${input.provider} ${input.protocol} connection ${input.importedId} is attached to multiple source organizations and was consolidated into one WorkOS handoff row. Customer confirmation is required before activation.`,
    details: {
      sourceOrganizationIds: input.sourceOrganizationIds,
      domains: input.domains,
    },
  };
}

export function unsupportedConnectionProtocolWarning(input: {
  provider: string;
  protocol: string;
  importedId?: string;
  strategy?: string;
  reason?: string;
}): SsoHandoffWarning {
  return {
    code: 'unsupported_connection_protocol',
    provider: input.provider,
    protocol: input.protocol,
    importedId: input.importedId,
    message: `${input.provider} ${input.protocol} connection${input.importedId ? ` ${input.importedId}` : ''} was skipped because it is outside the WorkOS SSO handoff scope.`,
    details: {
      strategy: input.strategy,
      reason: input.reason,
    },
  };
}

export function incompleteConnectionConfigurationWarning(input: {
  provider: string;
  protocol: string;
  importedId?: string;
  strategy?: string;
  missingFields: string[];
  reason?: string;
}): SsoHandoffWarning {
  return {
    code: 'incomplete_connection_configuration',
    provider: input.provider,
    protocol: input.protocol,
    importedId: input.importedId,
    message: `${input.provider} ${input.protocol} connection${input.importedId ? ` ${input.importedId}` : ''} was skipped because required handoff configuration was not available.`,
    details: {
      strategy: input.strategy,
      missingFields: input.missingFields,
      reason: input.reason,
    },
  };
}

function createRow<THeaders extends readonly string[]>(
  headers: THeaders,
  input: Record<string, unknown>,
): Record<THeaders[number], string> {
  const row = {} as Record<THeaders[number], string>;
  for (const header of headers) {
    const value = input[header];
    row[header as THeaders[number]] = value == null ? '' : String(value);
  }
  return row;
}
