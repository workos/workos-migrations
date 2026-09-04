/**
 * Thin client for the WorkOS Connections API (`POST /connections`).
 *
 * The endpoint is part of the Connections API migration capabilities and is
 * enabled per environment by WorkOS (feature flag
 * `connections-api-migrations-capabilities-api`). When the flag is off the API
 * responds 404 with a descriptive message; `isConnectionsApiDisabledError`
 * recognizes that case so callers can fall back to handoff instead of failing
 * every row.
 *
 * The official Node SDK does not expose this endpoint yet, so requests go
 * through the SDK's raw `post` helper to reuse its auth, base URL, retries, and
 * error classes.
 */

export interface ConnectionKeyPair {
  key: string;
  cert: string;
}

export interface CreateConnectionSamlOptions {
  idp_metadata_url?: string;
  idp_entity_id?: string;
  idp_sso_url?: string;
  idp_signing_certs?: string[];
  acs_url?: string;
  sp_entity_id?: string;
  sp_signing_key_pair?: ConnectionKeyPair;
  sp_encryption_key_pairs?: ConnectionKeyPair[];
}

export type OidcTokenAuthenticationMethod =
  | 'client_secret_basic'
  | 'client_secret_post'
  | 'private_key_jwt';

export interface CreateConnectionOidcOptions {
  discovery_endpoint: string;
  client_id: string;
  client_secret?: string;
  redirect_uri?: string;
  pkce?: boolean;
  token_authentication_method?: OidcTokenAuthenticationMethod;
  jwt_signing_key_pair?: ConnectionKeyPair;
  id_token_signature_algorithm?: string;
  fetch_user_info?: boolean;
}

export interface CreateConnectionStandardAttributes {
  idp_id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  groups?: string | null;
  name?: string | null;
}

export interface CreateConnectionAttributeMaps {
  standard_attributes?: CreateConnectionStandardAttributes;
  custom_attributes?: Record<string, string>;
}

export interface CreateConnectionRequest {
  organization_id: string;
  name?: string;
  external_id?: string;
  connection_type?: string;
  saml_options?: CreateConnectionSamlOptions;
  oidc_options?: CreateConnectionOidcOptions;
  attribute_maps?: CreateConnectionAttributeMaps;
}

export interface ConnectionCertificate {
  object: string;
  id: string;
  value: string;
  not_before?: string;
  not_after?: string;
  created_at?: string;
}

export interface ConnectionResponse {
  object: 'connection';
  id: string;
  organization_id?: string;
  connection_type: string;
  name: string;
  state: 'active' | 'inactive' | 'validating' | 'requires_type' | string;
  created_at: string;
  updated_at: string;
  external_id?: string | null;
  /** Immutable WorkOS callback (SAML ACS or OIDC redirect) for this connection. */
  callback_endpoint?: string | null;
  saml_options?: {
    acs_url?: string;
    sp_entity_id?: string;
    sp_metadata_url?: string;
    idp_entity_id?: string | null;
    idp_sso_url?: string | null;
    idp_metadata_url?: string | null;
    idp_signing_certs?: ConnectionCertificate[];
    sp_signing_cert?: ConnectionCertificate | null;
    sp_encryption_certs?: ConnectionCertificate[];
  } | null;
  oidc_options?: {
    redirect_uri?: string;
    discovery_endpoint?: string | null;
    client_id?: string | null;
    pkce?: boolean | null;
    token_authentication_method?: string | null;
  } | null;
  attribute_maps?: CreateConnectionAttributeMaps | null;
  [key: string]: unknown;
}

/** The subset of the WorkOS SDK client the Connections API helper needs. */
export interface ConnectionsApiClient {
  post<Result = any, Entity = any>(
    path: string,
    entity: Entity,
    options?: { idempotencyKey?: string; query?: Record<string, unknown> },
  ): Promise<{ data: Result }>;
}

export const CONNECTIONS_API_PATH = '/connections';
export const CONNECTIONS_API_FEATURE_FLAG = 'connections-api-migrations-capabilities-api';

export async function createConnection(
  client: ConnectionsApiClient,
  request: CreateConnectionRequest,
): Promise<ConnectionResponse> {
  const { data } = await client.post<ConnectionResponse, CreateConnectionRequest>(
    CONNECTIONS_API_PATH,
    request,
  );
  return data;
}

export interface WorkOSApiErrorDetails {
  status?: number;
  code?: string;
  message: string;
  requestId?: string;
}

/** Normalize an SDK exception (or anything thrown) into status/code/message. */
export function describeWorkOSApiError(error: unknown): WorkOSApiErrorDetails {
  if (!error || typeof error !== 'object') {
    return { message: String(error) };
  }
  const err = error as Record<string, unknown>;
  const rawData = (err.rawData ?? {}) as Record<string, unknown>;
  const status = numberOrUndefined(err.status ?? err.httpStatus);
  const code = stringOrUndefined(err.code) ?? stringOrUndefined(rawData.code);
  const message =
    stringOrUndefined(err.message) ??
    stringOrUndefined(rawData.message) ??
    (typeof rawData.error === 'string' ? rawData.error : undefined) ??
    'Unknown WorkOS API error';
  return {
    status,
    code,
    message,
    requestId: stringOrUndefined(err.requestID ?? err.requestId),
  };
}

/**
 * True when `POST /connections` was rejected because the Connections API
 * migration capabilities are not enabled for the environment.
 */
export function isConnectionsApiDisabledError(error: unknown): boolean {
  const details = describeWorkOSApiError(error);
  if (details.status !== 404) return false;
  const message = details.message.toLowerCase();
  if (message.includes('migration capabilities') || message.includes('not enabled')) return true;
  // The importer resolves the organization before calling POST /connections,
  // so any other 404 that does not mention an entity is the route being off.
  return !/organization|connection|not found/.test(message);
}

/** True when the create was rejected because of custom attribute mappings. */
export function isCustomAttributeError(error: unknown): boolean {
  const details = describeWorkOSApiError(error);
  if (details.status !== 400 && details.status !== 404 && details.status !== 422) return false;
  const haystack = `${details.code ?? ''} ${details.message}`.toLowerCase();
  return haystack.includes('custom_attribute') || haystack.includes('custom attribute');
}

export function isRetryableConnectionsApiError(error: unknown): boolean {
  const { status } = describeWorkOSApiError(error);
  return status === 429 || (status !== undefined && status >= 500);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
