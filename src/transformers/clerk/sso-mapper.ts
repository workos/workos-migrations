import {
  createCustomAttributeMappingRow,
  createOidcConnectionRow,
  createSamlConnectionRow,
  incompleteConnectionConfigurationWarning,
  missingDomainsWarning,
  type CustomAttrRow,
  type OidcRow,
  type SamlRow,
  type SsoHandoffWarning,
} from '../../sso/handoff.js';

/**
 * Top-level Clerk EnterpriseConnection (unified SAML + OIDC), returned by
 * `GET /v1/enterprise_connections`. The protocol is discriminated by which
 * sub-object is non-null: `saml_connection` → SAML, `oauth_config` → OIDC.
 *
 * Replaces the legacy `/v1/saml_connections` shape, which has been deprecated
 * since Clerk's 2026-03-09 release.
 */
export interface ClerkEnterpriseConnection {
  id: string;
  name?: string | null;
  active?: boolean;
  domains?: string[] | null;
  allow_subdomains?: boolean;
  sync_user_attributes?: boolean;
  disable_additional_identifications?: boolean;
  organization_id?: string | null;
  created_at?: number;
  updated_at?: number;
  saml_connection?: ClerkSamlConnectionConfig | null;
  oauth_config?: ClerkOauthConfig | null;
}

export interface ClerkSamlConnectionConfig {
  id?: string | null;
  name?: string | null;
  idp_entity_id?: string | null;
  idp_sso_url?: string | null;
  idp_certificate?: string | null;
  idp_metadata?: string | null;
  idp_metadata_url?: string | null;
  acs_url?: string | null;
  sp_entity_id?: string | null;
  sp_metadata_url?: string | null;
  allow_idp_initiated?: boolean;
  allow_subdomains?: boolean;
  sync_user_attributes?: boolean;
  /**
   * Not in Clerk's published type reference for the new EnterpriseConnection
   * sub-object, but the legacy SamlConnection type carried it and live
   * responses still include it. Present for safety.
   */
  attribute_mapping?: ClerkSamlAttributeMapping | null;
}

export interface ClerkOauthConfig {
  id?: string | null;
  name?: string | null;
  client_id?: string | null;
  discovery_url?: string | null;
  logo_public_url?: string | null;
}

export interface ClerkSamlAttributeMapping {
  user_id?: string | null;
  email_address?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  [key: string]: string | null | undefined;
}

export interface ClerkOrganization {
  id: string;
  name?: string | null;
  slug?: string | null;
}

export interface ClerkSsoMappingInput {
  connection: ClerkEnterpriseConnection;
  /** Optional organization lookup keyed by Clerk org id. */
  organization?: ClerkOrganization;
}

export type ClerkSsoConnectionMapping =
  | {
      status: 'mapped';
      protocol: 'saml';
      externalId: string;
      samlRow: SamlRow;
      customAttributeRows: CustomAttrRow[];
      warnings: SsoHandoffWarning[];
    }
  | {
      status: 'mapped';
      protocol: 'oidc';
      externalId: string;
      oidcRow: OidcRow;
      warnings: SsoHandoffWarning[];
    }
  | {
      status: 'skipped';
      protocol: 'saml' | 'oidc' | 'unknown';
      externalId: string;
      reason: string;
      warnings: SsoHandoffWarning[];
    };

const RESERVED_ATTRIBUTE_KEYS = new Set(['user_id', 'email_address', 'first_name', 'last_name']);

export function mapClerkEnterpriseConnection(
  input: ClerkSsoMappingInput,
): ClerkSsoConnectionMapping {
  const { connection } = input;
  const externalId = `clerk:${connection.id}`;

  if (connection.saml_connection) {
    return mapSamlConnection(input, externalId);
  }

  if (connection.oauth_config) {
    return mapOidcConnection(input, externalId);
  }

  const warning = incompleteConnectionConfigurationWarning({
    provider: 'clerk',
    protocol: 'unknown',
    externalId,
    missingFields: ['saml_connection', 'oauth_config'],
    reason: 'Clerk enterprise connection has neither saml_connection nor oauth_config',
  });
  return {
    status: 'skipped',
    protocol: 'unknown',
    externalId,
    reason: warning.message,
    warnings: [warning],
  };
}

function mapSamlConnection(
  input: ClerkSsoMappingInput,
  externalId: string,
): ClerkSsoConnectionMapping {
  const { connection, organization } = input;
  const saml = connection.saml_connection!;
  const warnings: SsoHandoffWarning[] = [];

  const idpEntityId = saml.idp_entity_id?.trim() ?? '';
  const idpUrl = saml.idp_sso_url?.trim() ?? '';
  const x509Cert = saml.idp_certificate?.trim() ?? '';
  const idpMetadataUrl = saml.idp_metadata_url?.trim() ?? '';

  const missingFields: string[] = [];
  if (!idpEntityId) missingFields.push('saml_connection.idp_entity_id');
  if (!idpUrl) missingFields.push('saml_connection.idp_sso_url');
  if (!x509Cert && !idpMetadataUrl && !saml.idp_metadata?.trim()) {
    missingFields.push('saml_connection.idp_certificate_or_metadata');
  }

  if (missingFields.length > 0) {
    const warning = incompleteConnectionConfigurationWarning({
      provider: 'clerk',
      protocol: 'saml',
      externalId,
      missingFields,
      reason: 'Clerk SAML enterprise connection is missing required handoff fields',
    });
    return {
      status: 'skipped',
      protocol: 'saml',
      externalId,
      reason: warning.message,
      warnings: [warning],
    };
  }

  const domains = normalizeDomains(connection.domains, connection.allow_subdomains);
  if (domains.length === 0) {
    warnings.push(
      missingDomainsWarning({
        provider: 'clerk',
        protocol: 'saml',
        externalId,
        organizationExternalId: connection.organization_id ?? undefined,
        organizationName: organization?.name ?? undefined,
      }),
    );
  }

  const attributeMapping = saml.attribute_mapping ?? {};
  const emailAttribute = attributeMapping.email_address?.trim() ?? '';
  const firstNameAttribute = attributeMapping.first_name?.trim() ?? '';
  const lastNameAttribute = attributeMapping.last_name?.trim() ?? '';
  const idpIdAttribute = attributeMapping.user_id?.trim() ?? '';

  const samlRow = createSamlConnectionRow({
    organizationName: organization?.name ?? organization?.slug ?? '',
    organizationId: '',
    organizationExternalId: connection.organization_id ?? '',
    domains: domains.join(';'),
    idpEntityId,
    idpUrl,
    x509Cert,
    idpMetadataUrl,
    customEntityId: saml.sp_entity_id ?? '',
    customAcsUrl: saml.acs_url ?? '',
    idpIdAttribute,
    emailAttribute,
    firstNameAttribute,
    lastNameAttribute,
    idpInitiatedEnabled: saml.allow_idp_initiated ? 'true' : '',
    externalId,
  });

  const customAttributeRows: CustomAttrRow[] = [];
  for (const [key, value] of Object.entries(attributeMapping)) {
    if (RESERVED_ATTRIBUTE_KEYS.has(key)) continue;
    const claim = value?.trim();
    if (!claim) continue;
    customAttributeRows.push(
      createCustomAttributeMappingRow({
        externalId,
        organizationExternalId: connection.organization_id ?? '',
        providerType: 'SAML',
        userPoolAttribute: key,
        idpClaim: claim,
      }),
    );
  }

  return {
    status: 'mapped',
    protocol: 'saml',
    externalId,
    samlRow,
    customAttributeRows,
    warnings,
  };
}

function mapOidcConnection(
  input: ClerkSsoMappingInput,
  externalId: string,
): ClerkSsoConnectionMapping {
  const { connection, organization } = input;
  const oauth = connection.oauth_config!;
  const warnings: SsoHandoffWarning[] = [];

  const clientId = oauth.client_id?.trim() ?? '';
  const discoveryUrl = oauth.discovery_url?.trim() ?? '';

  const missingFields: string[] = [];
  if (!clientId) missingFields.push('oauth_config.client_id');
  if (!discoveryUrl) missingFields.push('oauth_config.discovery_url');

  if (missingFields.length > 0) {
    const warning = incompleteConnectionConfigurationWarning({
      provider: 'clerk',
      protocol: 'oidc',
      externalId,
      missingFields,
      reason: 'Clerk OIDC enterprise connection is missing required handoff fields',
    });
    return {
      status: 'skipped',
      protocol: 'oidc',
      externalId,
      reason: warning.message,
      warnings: [warning],
    };
  }

  const domains = normalizeDomains(connection.domains, connection.allow_subdomains);
  if (domains.length === 0) {
    warnings.push(
      missingDomainsWarning({
        provider: 'clerk',
        protocol: 'oidc',
        externalId,
        organizationExternalId: connection.organization_id ?? undefined,
        organizationName: organization?.name ?? undefined,
      }),
    );
  }

  const oidcRow = createOidcConnectionRow({
    organizationName: organization?.name ?? organization?.slug ?? '',
    organizationId: '',
    organizationExternalId: connection.organization_id ?? '',
    domains: domains.join(';'),
    clientId,
    // Clerk does not return client_secret via the Backend API — the customer
    // must re-enter it in the WorkOS dashboard regardless.
    clientSecret: '',
    discoveryEndpoint: discoveryUrl,
    externalId,
  });

  return {
    status: 'mapped',
    protocol: 'oidc',
    externalId,
    oidcRow,
    warnings,
  };
}

function normalizeDomains(
  domains: string[] | null | undefined,
  allowSubdomains?: boolean,
): string[] {
  if (!domains || domains.length === 0) return [];
  const seen = new Set<string>();
  for (const raw of domains) {
    const trimmed = raw?.trim().toLowerCase();
    if (!trimmed) continue;
    seen.add(trimmed);
    if (allowSubdomains) seen.add(`*.${trimmed}`);
  }
  return [...seen];
}
