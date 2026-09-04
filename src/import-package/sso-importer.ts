import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse';
import type { WorkOS } from '@workos-inc/node';
import { PROXY_ROUTE_CSV_HEADERS } from '../package/manifest.js';
import { getPackageFilePath } from '../package/writer.js';
import { writeCsvRows, type CustomAttrRow, type OidcRow, type SamlRow } from '../sso/handoff.js';
import {
  buildOidcConnectionRequest,
  buildSamlConnectionRequest,
  groupCustomAttributeMappings,
  parseDomainList,
  type ConnectionMappingResult,
} from '../sso/connection-request-mapper.js';
import {
  createConnection,
  describeWorkOSApiError,
  isConnectionsApiDisabledError,
  isCustomAttributeError,
  isRetryableConnectionsApiError,
  CONNECTIONS_API_FEATURE_FLAG,
  type ConnectionResponse,
  type ConnectionsApiClient,
  type CreateConnectionRequest,
} from '../sso/connections-api.js';
import {
  createOrganization,
  ensureOrganizationDomains,
  getOrganizationById,
  getOrganizationByExternalId,
} from '../import/org-api.js';
import { RateLimiter, withRetry } from '../shared/rate-limiter.js';
import * as logger from '../shared/logger.js';

/**
 * Creates WorkOS SSO connections from a migration package's `sso/` files via
 * the Connections API (`POST /connections`).
 *
 * Per row: resolve or create the organization (adding exported domains as
 * verified), translate the CSV row into a create request, call the API, and
 * record the resulting connection id + callback endpoint. Results are written
 * to `workos_sso_connections.csv` in the package root and, when present,
 * copied into `sso/proxy_routes.csv` so callback proxies can be configured
 * without a manual mapping step.
 */

export type SsoCustomAttributeMode = 'include' | 'skip';

export const SSO_RESULTS_FILENAME = 'workos_sso_connections.csv';

export const SSO_RESULT_CSV_HEADERS = [
  'externalId',
  'protocol',
  'name',
  'organizationExternalId',
  'workosOrganizationId',
  'workosConnectionId',
  'connectionType',
  'state',
  'callbackEndpoint',
  'acsUrl',
  'spEntityId',
  'redirectUri',
  'domains',
  'domainsAdded',
  'outcome',
  'code',
  'error',
  'warnings',
] as const;

export interface SsoImportOptions {
  packageDir: string;
  /** Required unless dryRun is true. */
  workos?: WorkOS;
  dryRun?: boolean;
  quiet?: boolean;
  /** Max Connections API requests per second. Defaults to 5. */
  rateLimit?: number;
  /** OIDC client secrets keyed by connection externalId; override CSV values. */
  secrets?: Map<string, string>;
  /** Whether to send custom attribute mappings. Defaults to include. */
  customAttributes?: SsoCustomAttributeMode;
  /** JSONL file that receives one record per skipped/failed connection. */
  errorsPath?: string;
  /** Defaults to <packageDir>/workos_sso_connections.csv. */
  resultsPath?: string;
  /** Write connection ids/callbacks back into sso/proxy_routes.csv. Defaults to true. */
  updateProxyRoutes?: boolean;
}

export type SsoConnectionOutcome =
  | 'created'
  | 'existing'
  | 'planned'
  | 'skipped'
  | 'failed'
  | 'not_attempted';

export interface SsoConnectionResult {
  externalId: string;
  protocol: 'saml' | 'oidc';
  name: string;
  organizationExternalId: string;
  organizationId?: string;
  connectionId?: string;
  connectionType?: string;
  state?: string;
  callbackEndpoint?: string;
  acsUrl?: string;
  spEntityId?: string;
  redirectUri?: string;
  domains: string[];
  domainsAdded: string[];
  outcome: SsoConnectionOutcome;
  code?: string;
  error?: string;
  warnings: string[];
}

export interface SsoImportSummary {
  status: 'imported' | 'planned' | 'handoff' | 'absent';
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  notAttempted: number;
  warnings: string[];
  notes: string[];
  /** Custom attribute names referenced by the package (must exist in WorkOS). */
  customAttributeNames: string[];
  results: SsoConnectionResult[];
  resultsPath?: string;
  proxyRoutesUpdated: number;
  /** True when POST /connections reported the migration capabilities flag is off. */
  apiDisabled: boolean;
}

export interface SsoPackageRows {
  saml: SamlRow[];
  oidc: OidcRow[];
  customAttributes: CustomAttrRow[];
  proxyRoutes: Record<string, string>[];
}

export async function loadSsoPackageRows(packageDir: string): Promise<SsoPackageRows> {
  const [saml, oidc, customAttributes, proxyRoutes] = await Promise.all([
    readCsvRows(getPackageFilePath(packageDir, 'samlConnections')),
    readCsvRows(getPackageFilePath(packageDir, 'oidcConnections')),
    readCsvRows(getPackageFilePath(packageDir, 'customAttributeMappings')),
    readCsvRows(getPackageFilePath(packageDir, 'proxyRoutes')),
  ]);
  return {
    saml: saml as SamlRow[],
    oidc: oidc as OidcRow[],
    customAttributes: customAttributes as CustomAttrRow[],
    proxyRoutes,
  };
}

/** Unique custom attribute names referenced by `sso/custom_attribute_mappings.csv`. */
export function collectCustomAttributeNames(rows: Iterable<Partial<CustomAttrRow>>): string[] {
  const names = new Set<string>();
  for (const record of groupCustomAttributeMappings(rows).values()) {
    for (const name of Object.keys(record)) names.add(name);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/**
 * Load OIDC client secrets from a sidecar file. Accepts JSON (`{ "<externalId>": "<secret>" }`
 * or `[{ "externalId": "...", "clientSecret": "..." }]`) or CSV with `externalId` and
 * `clientSecret` columns.
 */
export async function loadSsoSecrets(filePath: string): Promise<Map<string, string>> {
  const secrets = new Map<string, string>();
  const raw = await fsp.readFile(filePath, 'utf-8');

  if (/\.json$/i.test(filePath) || /^\s*[[{]/.test(raw)) {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const externalId = firstString(record, ['externalId', 'external_id']);
        const secret = firstString(record, ['clientSecret', 'client_secret', 'secret']);
        if (externalId && secret) secrets.set(externalId, secret);
      }
    } else if (parsed && typeof parsed === 'object') {
      for (const [externalId, secret] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof secret === 'string' && secret) secrets.set(externalId, secret);
      }
    }
    return secrets;
  }

  const rows = await readCsvRows(filePath);
  for (const row of rows) {
    const externalId = firstString(row, ['externalId', 'external_id']);
    const secret = firstString(row, ['clientSecret', 'client_secret', 'secret']);
    if (externalId && secret) secrets.set(externalId, secret);
  }
  return secrets;
}

interface PlannedConnection {
  protocol: 'saml' | 'oidc';
  externalId: string;
  name: string;
  organizationId: string;
  organizationExternalId: string;
  organizationName: string;
  domains: string[];
  mapping: ConnectionMappingResult;
}

const PENDING_ORGANIZATION_ID = 'org_pending';

export async function importSsoConnections(options: SsoImportOptions): Promise<SsoImportSummary> {
  const packageDir = path.resolve(options.packageDir);
  const dryRun = options.dryRun ?? false;
  const quiet = options.quiet ?? false;
  const customAttributeMode = options.customAttributes ?? 'include';

  const rows = await loadSsoPackageRows(packageDir);
  const customAttributeNames = collectCustomAttributeNames(rows.customAttributes);

  if (rows.saml.length === 0 && rows.oidc.length === 0) {
    return {
      status: 'absent',
      total: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      notAttempted: 0,
      warnings: [],
      notes: [],
      customAttributeNames,
      results: [],
      proxyRoutesUpdated: 0,
      apiDisabled: false,
    };
  }

  const customAttributesById = groupCustomAttributeMappings(rows.customAttributes);
  const planned = planConnections(rows, {
    customAttributesById,
    customAttributeMode,
    secrets: options.secrets,
  });

  const notes: string[] = [];
  if (customAttributeMode === 'skip' && customAttributeNames.length > 0) {
    notes.push(
      `Custom attribute mappings were not sent (${customAttributeNames.join(', ')}). Add them to the connections in the WorkOS dashboard.`,
    );
  }

  if (dryRun) {
    const results = planned.map((entry) =>
      entry.mapping.ok
        ? baseResult(entry, 'planned')
        : {
            ...baseResult(entry, 'skipped'),
            code: entry.mapping.code,
            error: entry.mapping.message,
          },
    );
    return finalizeSummary({
      status: 'planned',
      results,
      notes,
      customAttributeNames,
      apiDisabled: false,
      proxyRoutesUpdated: 0,
    });
  }

  const workos = options.workos;
  if (!workos) {
    throw new Error('importSsoConnections requires options.workos when dryRun is false');
  }

  const limiter = new RateLimiter(options.rateLimit ?? 5);
  const runStartedAt = Date.now();
  const organizationCache = new Map<string, string>();
  const results: SsoConnectionResult[] = [];
  let apiDisabled = false;

  for (const entry of planned) {
    if (!entry.mapping.ok) {
      results.push({
        ...baseResult(entry, 'skipped'),
        code: entry.mapping.code,
        error: entry.mapping.message,
      });
      if (!quiet) logger.warn(`  Skipped ${entry.externalId}: ${entry.mapping.message}`);
      continue;
    }

    if (apiDisabled) {
      results.push({
        ...baseResult(entry, 'not_attempted'),
        code: 'connections_api_disabled',
        error: 'Not attempted because the Connections API migration capabilities are disabled.',
      });
      continue;
    }

    const result = baseResult(entry, 'failed');

    let organizationId: string;
    try {
      const resolved = await resolveOrganization(workos, entry, organizationCache);
      organizationId = resolved.id;
      result.organizationId = resolved.id;
      result.domainsAdded = resolved.domainsAdded;
      result.warnings.push(...resolved.warnings);
    } catch (error: unknown) {
      const details = describeWorkOSApiError(error);
      result.code = 'organization_resolution_failed';
      result.error = details.message;
      results.push(result);
      if (!quiet) logger.error(`  Failed ${entry.externalId}: ${details.message}`);
      continue;
    }

    const request: CreateConnectionRequest = {
      ...entry.mapping.request,
      organization_id: organizationId,
    };

    try {
      await limiter.acquire();
      const connection = await withRetry(() => createConnection(asApiClient(workos), request), {
        maxRetries: 3,
        retryOn: isRetryableConnectionsApiError,
      });
      applyConnection(result, connection);
      result.outcome = isPreexisting(connection, runStartedAt) ? 'existing' : 'created';
      results.push(result);
      if (!quiet) {
        const verb = result.outcome === 'existing' ? 'Reused existing' : 'Created';
        logger.success(
          `  ${verb} ${entry.protocol.toUpperCase()} connection ${connection.id} for ${entry.externalId}`,
        );
      }
    } catch (error: unknown) {
      const details = describeWorkOSApiError(error);
      if (isConnectionsApiDisabledError(error)) {
        apiDisabled = true;
        result.outcome = 'not_attempted';
        result.code = 'connections_api_disabled';
        result.error = details.message;
        results.push(result);
        if (!quiet) logger.warn(`  Connections API disabled: ${details.message}`);
        continue;
      }

      result.code = details.code ?? (details.status ? `http_${details.status}` : 'request_failed');
      result.error = details.message;
      if (isCustomAttributeError(error) && request.attribute_maps?.custom_attributes) {
        const names = Object.keys(request.attribute_maps.custom_attributes).join(', ');
        result.error = `${details.message} Create the custom attribute(s) ${names} in the WorkOS dashboard and re-run import-package, or re-run with --sso-custom-attributes skip.`;
      } else if (details.code === 'connection_already_exists_for_organization') {
        result.error = `${details.message} This environment allows one SSO connection per organization. Give the connection its own organizationExternalId, or ask WorkOS to lift the restriction for the environment.`;
      }
      results.push(result);
      if (!quiet) logger.error(`  Failed ${entry.externalId}: ${result.error}`);
    }
  }

  if (apiDisabled) {
    notes.push(
      `POST /connections is not enabled for this environment (feature flag ${CONNECTIONS_API_FEATURE_FLAG}). Ask WorkOS to enable Connections API migration capabilities, then re-run import-package; creation is idempotent on externalId. Until then, follow sso/handoff_notes.md.`,
    );
  }

  const resultsPath = options.resultsPath ?? path.join(packageDir, SSO_RESULTS_FILENAME);
  await writeResultsCsv(resultsPath, results);

  if (options.errorsPath) {
    await appendErrorRecords(options.errorsPath, results);
  }

  let proxyRoutesUpdated = 0;
  if (options.updateProxyRoutes ?? true) {
    proxyRoutesUpdated = await writeProxyRouteResults(packageDir, rows.proxyRoutes, results);
    if (proxyRoutesUpdated > 0) {
      notes.push(
        `Updated ${proxyRoutesUpdated} row(s) in sso/proxy_routes.csv with WorkOS connection ids and callback endpoints.`,
      );
    }
  }

  const created = results.filter((result) => result.outcome === 'created').length;
  const existing = results.filter((result) => result.outcome === 'existing').length;
  if (existing > 0) {
    notes.push(
      `${existing} connection(s) already existed with the same externalId and were left unchanged (POST /connections is idempotent on externalId and does not update configuration).`,
    );
  }
  if (created > 0) {
    notes.push(
      'New connections start in the validating state and activate on the first successful sign-in. Update customer IdPs (or the callback proxy) to the callbackEndpoint values in workos_sso_connections.csv.',
    );
  }

  return finalizeSummary({
    status: apiDisabled ? 'handoff' : 'imported',
    results,
    notes,
    customAttributeNames,
    apiDisabled,
    proxyRoutesUpdated,
    resultsPath,
  });
}

function planConnections(
  rows: SsoPackageRows,
  context: {
    customAttributesById: Map<string, Record<string, string>>;
    customAttributeMode: SsoCustomAttributeMode;
    secrets?: Map<string, string>;
  },
): PlannedConnection[] {
  const planned: PlannedConnection[] = [];
  const customAttributesFor = (externalId: string): Record<string, string> | undefined =>
    context.customAttributeMode === 'skip'
      ? undefined
      : context.customAttributesById.get(externalId);

  for (const row of rows.saml) {
    const externalId = clean(row.externalId);
    const mapping = buildSamlConnectionRequest({
      row,
      organizationId: PENDING_ORGANIZATION_ID,
      customAttributes: customAttributesFor(externalId),
    });
    planned.push(toPlanned('saml', row, mapping));
  }

  for (const row of rows.oidc) {
    const externalId = clean(row.externalId);
    const mapping = buildOidcConnectionRequest({
      row,
      organizationId: PENDING_ORGANIZATION_ID,
      customAttributes: customAttributesFor(externalId),
      clientSecret: context.secrets?.get(externalId),
    });
    planned.push(toPlanned('oidc', row, mapping));
  }

  return planned;
}

function toPlanned(
  protocol: 'saml' | 'oidc',
  row: SamlRow | OidcRow,
  mapping: ConnectionMappingResult,
): PlannedConnection {
  const organizationId = clean(row.organizationId);
  const organizationExternalId = clean(row.organizationExternalId);
  let effectiveMapping = mapping;
  if (mapping.ok && !organizationId && !organizationExternalId) {
    effectiveMapping = {
      ok: false,
      protocol,
      code: 'missing_organization',
      message: 'Row has neither organizationId nor organizationExternalId.',
      warnings: mapping.warnings,
    };
  }
  return {
    protocol,
    externalId: clean(row.externalId) || clean(row.name) || '(no externalId)',
    name: clean(row.name) || clean(row.organizationName) || clean(row.externalId),
    organizationId,
    organizationExternalId,
    organizationName: clean(row.organizationName),
    domains: parseDomainList(row.domains),
    mapping: effectiveMapping,
  };
}

interface ResolvedOrganization {
  id: string;
  domainsAdded: string[];
  warnings: string[];
}

async function resolveOrganization(
  workos: WorkOS,
  entry: PlannedConnection,
  cache: Map<string, string>,
): Promise<ResolvedOrganization> {
  const warnings: string[] = [];
  const cacheKey = entry.organizationId
    ? `id:${entry.organizationId}`
    : `ext:${entry.organizationExternalId}`;

  let id = cache.get(cacheKey);
  let domainsAdded: string[] = [];

  if (!id) {
    if (entry.organizationId) {
      const exists = await getOrganizationById(workos, entry.organizationId);
      if (!exists) {
        throw new Error(`Organization ${entry.organizationId} was not found in WorkOS.`);
      }
      id = entry.organizationId;
    } else {
      const existing = await getOrganizationByExternalId(workos, entry.organizationExternalId);
      if (existing) {
        id = existing;
      } else {
        const name = entry.organizationName || entry.organizationExternalId;
        id = await createOrganization(
          workos,
          name,
          entry.organizationExternalId,
          entry.domains.map((domain) => ({ domain, state: 'verified' as const })),
        );
        domainsAdded = [...entry.domains];
        cache.set(cacheKey, id);
        return { id, domainsAdded, warnings };
      }
    }
    cache.set(cacheKey, id);
  }

  if (entry.domains.length > 0) {
    try {
      const ensured = await ensureOrganizationDomains(workos, id, entry.domains, 'verified');
      domainsAdded = ensured.added;
    } catch (error: unknown) {
      const details = describeWorkOSApiError(error);
      warnings.push(
        `Could not add domain(s) ${entry.domains.join(', ')} to organization ${id}: ${details.message}`,
      );
    }
  }

  return { id, domainsAdded, warnings };
}

/** A connection whose created_at predates this run was returned by external_id idempotency. */
function isPreexisting(connection: ConnectionResponse, runStartedAt: number): boolean {
  const createdAt = Date.parse(connection.created_at ?? '');
  if (Number.isNaN(createdAt)) return false;
  return createdAt < runStartedAt - 5_000;
}

function applyConnection(result: SsoConnectionResult, connection: ConnectionResponse): void {
  result.connectionId = connection.id;
  result.connectionType = connection.connection_type;
  result.state = connection.state;
  result.callbackEndpoint = connection.callback_endpoint ?? undefined;
  result.acsUrl = connection.saml_options?.acs_url ?? undefined;
  result.spEntityId = connection.saml_options?.sp_entity_id ?? undefined;
  result.redirectUri = connection.oidc_options?.redirect_uri ?? undefined;
  if (connection.organization_id) result.organizationId = connection.organization_id;
}

function baseResult(entry: PlannedConnection, outcome: SsoConnectionOutcome): SsoConnectionResult {
  return {
    externalId: entry.externalId,
    protocol: entry.protocol,
    name: entry.name,
    organizationExternalId: entry.organizationExternalId,
    ...(entry.organizationId ? { organizationId: entry.organizationId } : {}),
    domains: [...entry.domains],
    domainsAdded: [],
    outcome,
    warnings: entry.mapping.warnings.map((warning) => `${warning.code}: ${warning.message}`),
  };
}

function finalizeSummary(input: {
  status: SsoImportSummary['status'];
  results: SsoConnectionResult[];
  notes: string[];
  customAttributeNames: string[];
  apiDisabled: boolean;
  proxyRoutesUpdated: number;
  resultsPath?: string;
}): SsoImportSummary {
  const count = (outcome: SsoConnectionOutcome): number =>
    input.results.filter((result) => result.outcome === outcome).length;

  const warnings: string[] = [];
  for (const result of input.results) {
    for (const warning of result.warnings) {
      warnings.push(`${result.externalId}: ${warning}`);
    }
    if (result.outcome === 'skipped' && result.error) {
      warnings.push(`${result.externalId}: skipped (${result.code}) ${result.error}`);
    }
  }

  return {
    status: input.status,
    total: input.results.length,
    succeeded: input.status === 'planned' ? count('planned') : count('created') + count('existing'),
    failed: count('failed'),
    skipped: count('skipped'),
    notAttempted: count('not_attempted'),
    warnings,
    notes: input.notes,
    customAttributeNames: input.customAttributeNames,
    results: input.results,
    ...(input.resultsPath ? { resultsPath: input.resultsPath } : {}),
    proxyRoutesUpdated: input.proxyRoutesUpdated,
    apiDisabled: input.apiDisabled,
  };
}

async function writeResultsCsv(filePath: string, results: SsoConnectionResult[]): Promise<void> {
  await writeCsvRows(
    filePath,
    SSO_RESULT_CSV_HEADERS,
    results.map((result) => ({
      externalId: result.externalId,
      protocol: result.protocol,
      name: result.name,
      organizationExternalId: result.organizationExternalId,
      workosOrganizationId: result.organizationId ?? '',
      workosConnectionId: result.connectionId ?? '',
      connectionType: result.connectionType ?? '',
      state: result.state ?? '',
      callbackEndpoint: result.callbackEndpoint ?? '',
      acsUrl: result.acsUrl ?? '',
      spEntityId: result.spEntityId ?? '',
      redirectUri: result.redirectUri ?? '',
      domains: result.domains.join(';'),
      domainsAdded: result.domainsAdded.join(';'),
      outcome: result.outcome,
      code: result.code ?? '',
      error: result.error ?? '',
      warnings: result.warnings.join(' | '),
    })),
  );
}

async function appendErrorRecords(
  errorsPath: string,
  results: SsoConnectionResult[],
): Promise<void> {
  const lines = results
    .filter((result) => result.outcome === 'failed' || result.outcome === 'skipped')
    .map((result) =>
      JSON.stringify({
        entity: 'sso_connection',
        externalId: result.externalId,
        protocol: result.protocol,
        organizationExternalId: result.organizationExternalId,
        outcome: result.outcome,
        code: result.code,
        message: result.error,
      }),
    );
  if (lines.length === 0) return;
  await fsp.mkdir(path.dirname(errorsPath), { recursive: true });
  await fsp.appendFile(errorsPath, `${lines.join('\n')}\n`, 'utf-8');
}

/**
 * Copy created connection ids and callback endpoints into `sso/proxy_routes.csv`
 * rows with a matching externalId. Returns the number of rows updated.
 */
export async function writeProxyRouteResults(
  packageDir: string,
  proxyRoutes: Record<string, string>[],
  results: SsoConnectionResult[],
): Promise<number> {
  if (proxyRoutes.length === 0) return 0;
  const byExternalId = new Map(
    results
      .filter(
        (result) =>
          (result.outcome === 'created' || result.outcome === 'existing') && result.connectionId,
      )
      .map((result) => [result.externalId, result]),
  );
  if (byExternalId.size === 0) return 0;

  let updated = 0;
  const rows = proxyRoutes.map((row) => {
    const match = byExternalId.get(clean(row.externalId));
    if (!match) return row;
    updated += 1;
    return {
      ...row,
      workosConnectionId: match.connectionId ?? '',
      workosAcsUrl: match.callbackEndpoint ?? match.acsUrl ?? match.redirectUri ?? '',
    };
  });

  if (updated === 0) return 0;
  await writeCsvRows(getPackageFilePath(packageDir, 'proxyRoutes'), PROXY_ROUTE_CSV_HEADERS, rows);
  return updated;
}

function asApiClient(workos: WorkOS): ConnectionsApiClient {
  return workos as unknown as ConnectionsApiClient;
}

export async function readCsvRows(filePath: string): Promise<Record<string, string>[]> {
  try {
    await fsp.access(filePath);
  } catch {
    return [];
  }
  return new Promise<Record<string, string>[]>((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }))
      .on('data', (row: Record<string, string>) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function clean(value: unknown): string {
  return value == null ? '' : String(value).trim();
}
