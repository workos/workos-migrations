import type {
  Auth0Connection,
  Auth0Organization,
  Auth0OrganizationConnection,
} from '../../shared/types.js';
import {
  createCustomAttributeMappingRow,
  createOidcConnectionRow,
  createProxyRouteRow,
  createSamlConnectionRow,
  incompleteConnectionConfigurationWarning,
  missingDomainsWarning,
  multiOrgConnectionConsolidationWarning,
  redactedSecretsWarning,
  unsupportedConnectionProtocolWarning,
  type CustomAttrRow,
  type OidcRow,
  type ProxyRouteRow,
  type SamlRow,
  type SsoHandoffWarning,
} from '../../sso/handoff.js';
import { normalizeDiscoveryEndpoint, parseSamlMetadata } from '../../sso/saml-metadata.js';

export type Auth0SsoProtocol = 'saml' | 'oidc';
export type Auth0SsoClassification = Auth0SsoProtocol | 'unsupported';

export interface Auth0SsoConnectionOrgBinding {
  organization: Auth0Organization;
  organizationConnection?: Auth0OrganizationConnection;
}

export interface Auth0SsoMappingInput {
  connection: Auth0Connection;
  domain: string;
  orgBindings?: Auth0SsoConnectionOrgBinding[];
  includeSecrets?: boolean;
}

export type Auth0SsoConnectionMapping =
  | {
      status: 'mapped';
      protocol: Auth0SsoProtocol;
      externalId: string;
      samlRow?: SamlRow;
      oidcRow?: OidcRow;
      customAttributeRows: CustomAttrRow[];
      proxyRouteRow: ProxyRouteRow;
      warnings: SsoHandoffWarning[];
    }
  | {
      status: 'skipped';
      protocol: Auth0SsoClassification;
      externalId: string;
      reason: string;
      warnings: SsoHandoffWarning[];
    };

export const AUTH0_REDACTED_SECRET_FIELDS = [
  'client_secret',
  'clientSecret',
  'secret',
  'password',
  'private_key',
  'privateKey',
  'requestSigningKey',
  'assertionEncryptionKey',
  'nameIdEncryptionKey',
  'access_token',
  'refresh_token',
  'id_token',
] as const;

export const AUTH0_ENTERPRISE_SSO_STRATEGIES = [
  'ad',
  'adfs',
  'auth0-adldap',
  'google-apps',
  'ip',
  'office365',
  'oidc',
  'okta',
  'pingfederate',
  'samlp',
  'sharepoint',
  'waad',
] as const;

const SAML_XML_OPTION_KEYS = [
  'metadataXml',
  'metadataXML',
  'metadataFile',
  'metadata_file',
  'idpMetadataXml',
  'idp_metadata_xml',
] as const;

const SAML_METADATA_URL_KEYS = [
  'federationMetadataUrl',
  'federation_metadata_url',
  'FederationMetadataUrl',
  'metadataUrl',
  'metadataURL',
  'metadata_url',
  'idpMetadataUrl',
  'idp_metadata_url',
  'MetadataURL',
] as const;

const SAML_IDP_ENTITY_ID_KEYS = [
  'idpEntityId',
  'idp_entity_id',
  'entityId',
  'entityID',
  'issuer',
  'idpIssuer',
] as const;

const SAML_IDP_URL_KEYS = [
  'signInEndpoint',
  'signin_url',
  'signInUrl',
  'ssoUrl',
  'sso_url',
  'idpUrl',
  'idp_url',
  'SSORedirectBindingURI',
] as const;

const SAML_CERT_KEYS = [
  'signingCert',
  'signing_cert',
  'x509Cert',
  'x509cert',
  'x509_certificate',
  'cert',
  'certificate',
] as const;

const SAML_SP_ENTITY_ID_KEYS = [
  'audience',
  'spEntityId',
  'sp_entity_id',
  'serviceProviderEntityId',
] as const;

const SAML_ACS_URL_KEYS = [
  'callbackUrl',
  'callbackURL',
  'acsUrl',
  'acs_url',
  'recipient',
  'destination',
] as const;

const SAML_SECRET_KEYS = [
  'requestSigningKey',
  'request_signing_key',
  'assertionEncryptionKey',
  'assertion_encryption_key',
  'nameIdEncryptionKey',
  'name_id_encryption_key',
] as const;

const OIDC_CLIENT_ID_KEYS = ['client_id', 'clientId'] as const;
const OIDC_CLIENT_SECRET_KEYS = ['client_secret', 'clientSecret'] as const;
const OIDC_DISCOVERY_KEYS = [
  'discoveryEndpoint',
  'discovery_endpoint',
  'discoveryUrl',
  'discovery_url',
  'issuer',
  'issuerUrl',
  'issuer_url',
] as const;
const OIDC_ISSUER_DOMAIN_KEYS = [
  'domain',
  'issuerDomain',
  'issuer_domain',
  'oktaDomain',
  'okta_domain',
] as const;
const AZURE_TENANT_KEYS = [
  'tenant_domain',
  'tenantDomain',
  'tenant_id',
  'tenantId',
  'domain',
] as const;
const OIDC_REDIRECT_URI_KEYS = [
  'redirectUri',
  'redirect_uri',
  'callbackUrl',
  'callbackURL',
] as const;

const ATTRIBUTE_MAPPING_KEYS = [
  'fieldsMap',
  'fieldMap',
  'fields_map',
  'mapping',
  'attributeMap',
  'attribute_map',
  'attributes',
  'profileMap',
  'profile_map',
] as const;

const COMMON_PROFILE_ATTRIBUTES = new Set([
  'email',
  'given_name',
  'family_name',
  'first_name',
  'last_name',
  'name',
  'nickname',
  'picture',
  'user_id',
  'sub',
]);

const REDACTED_VALUE = '[REDACTED]';
const ENTERPRISE_SSO_STRATEGIES = new Set<string>(AUTH0_ENTERPRISE_SSO_STRATEGIES);
const AZURE_OIDC_STRATEGIES = new Set(['waad', 'office365']);

type UnknownRecord = Record<string, unknown>;

export function classifyAuth0ConnectionProtocol(
  connection: Auth0Connection,
): Auth0SsoClassification {
  const strategy = connection.strategy.toLowerCase();
  if (strategy === 'samlp') return 'saml';
  if (strategy === 'oidc') return 'oidc';
  if (!ENTERPRISE_SSO_STRATEGIES.has(strategy)) return 'unsupported';

  const options = recordValue(connection.options);
  if (hasOidcConnectionData(strategy, options)) return 'oidc';
  if (hasSamlConnectionData(options)) return 'saml';

  return 'unsupported';
}

export function buildAuth0ConnectionExternalId(connection: Auth0Connection): string {
  return connection.name;
}

export function mapAuth0ConnectionToSsoHandoff(
  input: Auth0SsoMappingInput,
): Auth0SsoConnectionMapping {
  const { connection } = input;
  const externalId = buildAuth0ConnectionExternalId(connection);
  const protocol = classifyAuth0ConnectionProtocol(connection);

  if (protocol === 'unsupported') {
    const strategy = connection.strategy.toLowerCase();
    const reason = ENTERPRISE_SSO_STRATEGIES.has(strategy)
      ? 'Auth0 enterprise strategy did not expose enough SAML or OIDC handoff configuration.'
      : 'Only Auth0 enterprise connections with SAML or OIDC configuration are supported for WorkOS SSO handoff.';
    const warning = unsupportedConnectionProtocolWarning({
      provider: 'auth0',
      protocol: connection.strategy || 'unknown',
      externalId,
      strategy: connection.strategy,
      reason,
    });
    return {
      status: 'skipped',
      protocol,
      externalId,
      reason: 'unsupported_connection_protocol',
      warnings: [warning],
    };
  }

  if (protocol === 'saml') {
    return mapSamlConnection(input, externalId);
  }

  return mapOidcConnection(input, externalId);
}

export function redactAuth0ConnectionSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuth0ConnectionSecrets(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const redacted: UnknownRecord = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = shouldRedactKey(key)
      ? REDACTED_VALUE
      : redactAuth0ConnectionSecrets(nestedValue);
  }
  return redacted;
}

function mapSamlConnection(
  input: Auth0SsoMappingInput,
  externalId: string,
): Auth0SsoConnectionMapping {
  const { connection } = input;
  const options = recordValue(connection.options);
  const metadataXml = getFirstString(options, SAML_XML_OPTION_KEYS);
  const parsedMetadata = parseSamlMetadata(metadataXml);
  const idpMetadataUrl = getFirstString(options, SAML_METADATA_URL_KEYS);
  const idpEntityId = firstNonEmpty(
    getFirstString(options, SAML_IDP_ENTITY_ID_KEYS),
    parsedMetadata.entityId,
  );
  const idpUrl = firstNonEmpty(
    getFirstString(options, SAML_IDP_URL_KEYS),
    parsedMetadata.ssoRedirectUrl,
  );
  const x509Cert = firstNonEmpty(getFirstString(options, SAML_CERT_KEYS), parsedMetadata.x509Cert);
  const missingFields = missingSamlFields({ idpEntityId, idpUrl, x509Cert, idpMetadataUrl });

  if (missingFields.length > 0) {
    const warning = incompleteConnectionConfigurationWarning({
      provider: 'auth0',
      protocol: 'saml',
      externalId,
      strategy: connection.strategy,
      missingFields,
      reason:
        'SAML handoff requires IdP metadata URL or the entity ID, SSO URL, and signing certificate.',
    });
    return {
      status: 'skipped',
      protocol: 'saml',
      externalId,
      reason: 'incomplete_connection_configuration',
      warnings: [warning],
    };
  }

  const organization = buildOrganizationContext(
    connection,
    input.orgBindings ?? [],
    'saml',
    externalId,
  );
  const attributeMappings = extractAttributeMappings(connection);
  const customAcsUrl = getFirstString(options, SAML_ACS_URL_KEYS);
  const customEntityId = getFirstString(options, SAML_SP_ENTITY_ID_KEYS);
  const sourceAcsUrl = customAcsUrl || buildAuth0CallbackUrl(input.domain, connection.name);
  const samlSecretValues = getSecretValues(options, SAML_SECRET_KEYS);
  const warnings = [...organization.warnings];

  if (!input.includeSecrets && samlSecretValues.length > 0) {
    warnings.push(
      redactedSecretsWarning({
        provider: 'auth0',
        protocol: 'saml',
        externalId,
        fields: samlSecretValues,
        file: 'sso/saml_connections.csv',
      }),
    );
  }

  const row = createSamlConnectionRow({
    name: connection.name,
    organizationName: organization.organizationName,
    organizationExternalId: organization.organizationExternalId,
    domains: organization.domains.join(','),
    idpEntityId,
    idpUrl,
    x509Cert,
    idpMetadataUrl,
    customEntityId,
    customAcsUrl,
    idpIdAttribute: lookupMapping(attributeMappings, ['user_id', 'sub']),
    emailAttribute: lookupMapping(attributeMappings, ['email']),
    firstNameAttribute: lookupMapping(attributeMappings, ['given_name', 'first_name']),
    lastNameAttribute: lookupMapping(attributeMappings, ['family_name', 'last_name']),
    nameAttribute: lookupMapping(attributeMappings, ['name']),
    idpInitiatedEnabled: boolishString(getOptionValue(options, ['idpinitiated', 'idpInitiated'])),
    requestSigningKey: input.includeSecrets
      ? getFirstString(options, ['requestSigningKey', 'request_signing_key'])
      : '',
    assertionEncryptionKey: input.includeSecrets
      ? getFirstString(options, ['assertionEncryptionKey', 'assertion_encryption_key'])
      : '',
    nameIdEncryptionKey: input.includeSecrets
      ? getFirstString(options, ['nameIdEncryptionKey', 'name_id_encryption_key'])
      : '',
    externalId,
  });

  return {
    status: 'mapped',
    protocol: 'saml',
    externalId,
    samlRow: row,
    customAttributeRows: toCustomAttributeRows(attributeMappings, externalId, organization, 'SAML'),
    proxyRouteRow: createProxyRouteRow({
      externalId,
      organizationExternalId: organization.organizationExternalId,
      provider: 'auth0',
      protocol: 'saml',
      sourceAcsUrl,
      sourceEntityId: customEntityId,
      customAcsUrl,
      customEntityId,
      cutoverState: 'legacy',
      notes: 'Existing Auth0 SAML ACS route should be proxied until the IdP is updated to WorkOS.',
    }),
    warnings,
  };
}

function mapOidcConnection(
  input: Auth0SsoMappingInput,
  externalId: string,
): Auth0SsoConnectionMapping {
  const { connection } = input;
  const options = recordValue(connection.options);
  const clientId = getFirstString(options, OIDC_CLIENT_ID_KEYS);
  const clientSecret = getFirstString(options, OIDC_CLIENT_SECRET_KEYS);
  const discoveryEndpoint = buildOidcDiscoveryEndpoint(connection.strategy, options, clientId);
  const missingFields = ['clientId', 'discoveryEndpoint'].filter((field) => {
    if (field === 'clientId') return !clientId;
    return !discoveryEndpoint;
  });

  if (input.includeSecrets && !clientSecret) {
    missingFields.push('clientSecret');
  }

  if (missingFields.length > 0) {
    const warning = incompleteConnectionConfigurationWarning({
      provider: 'auth0',
      protocol: 'oidc',
      externalId,
      strategy: connection.strategy,
      missingFields,
      reason: 'OIDC handoff requires a client ID and discovery endpoint.',
    });
    return {
      status: 'skipped',
      protocol: 'oidc',
      externalId,
      reason: 'incomplete_connection_configuration',
      warnings: [warning],
    };
  }

  const organization = buildOrganizationContext(
    connection,
    input.orgBindings ?? [],
    'oidc',
    externalId,
  );
  const attributeMappings = extractAttributeMappings(connection);
  const customRedirectUri = getFirstString(options, OIDC_REDIRECT_URI_KEYS);
  const sourceRedirectUri =
    customRedirectUri || buildAuth0CallbackUrl(input.domain, connection.name);
  const warnings = [...organization.warnings];

  if (!input.includeSecrets && clientSecret) {
    warnings.push(
      redactedSecretsWarning({
        provider: 'auth0',
        protocol: 'oidc',
        externalId,
        fields: ['clientSecret'],
        file: 'sso/oidc_connections.csv',
      }),
    );
  }

  const row = createOidcConnectionRow({
    name: connection.name,
    organizationName: organization.organizationName,
    organizationExternalId: organization.organizationExternalId,
    domains: organization.domains.join(','),
    clientId,
    clientSecret: input.includeSecrets ? clientSecret : '',
    discoveryEndpoint: discoveryEndpoint ?? '',
    customRedirectUri,
    externalId,
  });

  return {
    status: 'mapped',
    protocol: 'oidc',
    externalId,
    oidcRow: row,
    customAttributeRows: toCustomAttributeRows(attributeMappings, externalId, organization, 'OIDC'),
    proxyRouteRow: createProxyRouteRow({
      externalId,
      organizationExternalId: organization.organizationExternalId,
      provider: 'auth0',
      protocol: 'oidc',
      sourceRedirectUri,
      customRedirectUri,
      cutoverState: 'legacy',
      notes:
        'Existing Auth0 OIDC redirect route should be proxied until the IdP is updated to WorkOS.',
    }),
    warnings,
  };
}

function missingSamlFields(input: {
  idpEntityId: string;
  idpUrl: string;
  x509Cert: string;
  idpMetadataUrl: string;
}): string[] {
  if (input.idpMetadataUrl) return [];

  const missing: string[] = [];
  if (!input.idpEntityId) missing.push('idpEntityId');
  if (!input.idpUrl) missing.push('idpUrl');
  if (!input.x509Cert) missing.push('x509Cert');
  return missing;
}

function hasOidcConnectionData(strategy: string, options: UnknownRecord): boolean {
  const clientId = getFirstString(options, OIDC_CLIENT_ID_KEYS);
  return Boolean(clientId && buildOidcDiscoveryEndpoint(strategy, options, clientId));
}

function buildOidcDiscoveryEndpoint(
  strategy: string,
  options: UnknownRecord,
  clientId: string,
): string | null {
  const direct = normalizeDiscoveryEndpoint(getFirstString(options, OIDC_DISCOVERY_KEYS));
  if (direct) return direct;

  const normalizedStrategy = strategy.toLowerCase();
  if (normalizedStrategy === 'google-apps' && clientId) {
    return 'https://accounts.google.com/.well-known/openid-configuration';
  }

  if (AZURE_OIDC_STRATEGIES.has(normalizedStrategy) && clientId) {
    const tenant = getFirstString(options, AZURE_TENANT_KEYS);
    if (tenant) {
      return `https://login.microsoftonline.com/${encodeURIComponent(
        tenant,
      )}/v2.0/.well-known/openid-configuration`;
    }
  }

  if (normalizedStrategy === 'okta' && clientId) {
    const domain = getFirstString(options, OIDC_ISSUER_DOMAIN_KEYS);
    if (domain) {
      return normalizeDiscoveryEndpoint(ensureHttps(domain));
    }
  }

  return null;
}

function hasSamlConnectionData(options: UnknownRecord): boolean {
  const metadataXml = getFirstString(options, SAML_XML_OPTION_KEYS);
  const parsedMetadata = parseSamlMetadata(metadataXml);
  return Boolean(
    parsedMetadata.entityId ||
    parsedMetadata.ssoRedirectUrl ||
    parsedMetadata.x509Cert ||
    getFirstString(options, SAML_METADATA_URL_KEYS) ||
    getFirstString(options, SAML_IDP_ENTITY_ID_KEYS) ||
    getFirstString(options, SAML_IDP_URL_KEYS) ||
    getFirstString(options, SAML_CERT_KEYS),
  );
}

function buildOrganizationContext(
  connection: Auth0Connection,
  orgBindings: Auth0SsoConnectionOrgBinding[],
  protocol: Auth0SsoProtocol,
  externalId: string,
): {
  organizationName: string;
  organizationExternalId: string;
  domains: string[];
  warnings: SsoHandoffWarning[];
} {
  const warnings: SsoHandoffWarning[] = [];
  const connectionName = connection.display_name || connection.name;

  if (orgBindings.length === 1) {
    const org = orgBindings[0].organization;
    const domains = extractDomains(org.metadata);
    const context = {
      organizationName: org.display_name || org.name,
      organizationExternalId: org.id,
      domains,
      warnings,
    };
    addMissingDomainWarning(context, protocol, externalId);
    return context;
  }

  if (orgBindings.length > 1) {
    const domains = uniqueDomains(
      orgBindings.flatMap((binding) => extractDomains(binding.organization.metadata)),
    );
    const organizationExternalId = connection.id;
    const context = {
      organizationName: connectionName,
      organizationExternalId,
      domains,
      warnings,
    };
    warnings.push(
      multiOrgConnectionConsolidationWarning({
        provider: 'auth0',
        protocol,
        externalId,
        organizationExternalId,
        sourceOrganizationIds: orgBindings.map((binding) => binding.organization.id),
        domains,
      }),
    );
    addMissingDomainWarning(context, protocol, externalId);
    return context;
  }

  const domains = uniqueDomains([
    ...extractDomains(connection.metadata),
    ...extractDomains(recordValue(connection.options)),
  ]);
  const context = {
    organizationName: connectionName,
    organizationExternalId: connection.id,
    domains,
    warnings,
  };
  addMissingDomainWarning(context, protocol, externalId);
  return context;
}

function addMissingDomainWarning(
  context: {
    organizationExternalId: string;
    organizationName: string;
    domains: string[];
    warnings: SsoHandoffWarning[];
  },
  protocol: Auth0SsoProtocol,
  externalId: string,
): void {
  if (context.domains.length > 0) return;
  context.warnings.push(
    missingDomainsWarning({
      provider: 'auth0',
      protocol,
      externalId,
      organizationExternalId: context.organizationExternalId,
      organizationName: context.organizationName,
    }),
  );
}

function extractAttributeMappings(connection: Auth0Connection): Record<string, string> {
  const options = recordValue(connection.options);
  const mappings: Record<string, string> = {};

  for (const key of ATTRIBUTE_MAPPING_KEYS) {
    const candidate = getOptionValue(options, [key]) ?? connection[key];
    if (!isRecord(candidate)) continue;

    for (const [attribute, claim] of Object.entries(candidate)) {
      const stringClaim = stringValue(claim);
      if (!stringClaim) continue;
      mappings[attribute] = stringClaim;
    }
  }

  return mappings;
}

function toCustomAttributeRows(
  attributeMappings: Record<string, string>,
  externalId: string,
  organization: { organizationExternalId: string },
  providerType: 'SAML' | 'OIDC',
): CustomAttrRow[] {
  return Object.entries(attributeMappings)
    .filter(([attribute, claim]) => Boolean(claim) && !COMMON_PROFILE_ATTRIBUTES.has(attribute))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([attribute, claim]) =>
      createCustomAttributeMappingRow({
        externalId,
        organizationExternalId: organization.organizationExternalId,
        providerType,
        userPoolAttribute: attribute,
        idpClaim: claim,
      }),
    );
}

function lookupMapping(attributeMappings: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = attributeMappings[key];
    if (value) return value;
  }
  return '';
}

function extractDomains(source: unknown): string[] {
  if (!isRecord(source)) return [];

  const values = [
    source.domains,
    source.domain,
    source.domain_aliases,
    source.domainAliases,
    source.email_domains,
    source.emailDomains,
  ];

  return uniqueDomains(values.flatMap((value) => parseDomainValue(value)));
}

function parseDomainValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseDomainValue(item));
  }

  const stringDomain = stringValue(value);
  if (!stringDomain) return [];

  return stringDomain
    .split(/[;,\s]+/)
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function uniqueDomains(domains: string[]): string[] {
  return [...new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))].sort();
}

function getSecretValues(options: UnknownRecord, keys: readonly string[]): string[] {
  return keys.filter((key) => Boolean(getFirstString(options, [key])));
}

function getFirstString(record: UnknownRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const value = stringValue(getOptionValue(record, [key]));
    if (value) return value;
  }
  return '';
}

function getOptionValue(record: UnknownRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = stringValue(value);
    if (normalized) return normalized;
  }
  return '';
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function recordValue(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, '').toLowerCase();
  return (
    normalized === 'secret' ||
    normalized.endsWith('secret') ||
    normalized === 'password' ||
    normalized.endsWith('password') ||
    normalized.endsWith('privatekey') ||
    normalized === 'requestsigningkey' ||
    normalized === 'assertionencryptionkey' ||
    normalized === 'nameidencryptionkey' ||
    normalized === 'accesstoken' ||
    normalized === 'refreshtoken' ||
    normalized === 'idtoken'
  );
}

function boolishString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return stringValue(value);
}

function ensureHttps(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function buildAuth0CallbackUrl(domain: string, connectionName: string): string {
  return `https://${domain}/login/callback?connection=${encodeURIComponent(connectionName)}`;
}
