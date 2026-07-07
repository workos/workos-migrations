import {
  createOidcConnectionRow,
  createSamlConnectionRow,
  incompleteConnectionConfigurationWarning,
  missingDomainsWarning,
  redactedSecretsWarning,
  type OidcRow,
  type SamlRow,
  type SsoHandoffWarning,
} from '../../sso/handoff.js';

/** Shape returned by `GET /v2/projects/{p}/inboundSamlConfigs`. */
export interface FirebaseInboundSamlConfig {
  /** Fully qualified resource name e.g. `projects/{p}/inboundSamlConfigs/saml.acme` */
  name?: string | null;
  displayName?: string | null;
  enabled?: boolean;
  idpConfig?: {
    idpEntityId?: string | null;
    ssoUrl?: string | null;
    signRequest?: boolean;
    idpCertificates?: Array<{ x509Certificate?: string | null }>;
  } | null;
  spConfig?: {
    spEntityId?: string | null;
    callbackUri?: string | null;
    spCertificates?: Array<{ x509Certificate?: string | null; expiresAt?: string | null }>;
  } | null;
}

/** Shape returned by `GET /v2/projects/{p}/oauthIdpConfigs`. */
export interface FirebaseOAuthIdpConfig {
  name?: string | null;
  displayName?: string | null;
  enabled?: boolean;
  clientId?: string | null;
  clientSecret?: string | null;
  issuer?: string | null;
  responseType?: {
    idToken?: boolean;
    code?: boolean;
    token?: boolean;
  } | null;
}

export interface FirebaseSsoMappingScope {
  /** Identity Platform tenant ID, if the config is tenant-scoped. */
  tenantId?: string;
  /** Optional display name of the tenant, used as the org name. */
  tenantDisplayName?: string;
}

export interface FirebaseSamlMappingInput {
  config: FirebaseInboundSamlConfig;
  scope?: FirebaseSsoMappingScope;
}

export interface FirebaseOidcMappingInput {
  config: FirebaseOAuthIdpConfig;
  scope?: FirebaseSsoMappingScope;
}

export type FirebaseSsoConnectionMapping<TRow> =
  | {
      status: 'mapped';
      protocol: 'saml' | 'oidc';
      externalId: string;
      row: TRow;
      warnings: SsoHandoffWarning[];
    }
  | {
      status: 'skipped';
      protocol: 'saml' | 'oidc';
      externalId: string;
      reason: string;
      warnings: SsoHandoffWarning[];
    };

export function mapFirebaseSamlConfig(
  input: FirebaseSamlMappingInput,
): FirebaseSsoConnectionMapping<SamlRow> {
  const { config, scope } = input;
  const configId = extractConfigId(config.name);
  const externalId = scope?.tenantId
    ? `firebase:${scope.tenantId}:${configId}`
    : `firebase:${configId}`;
  const warnings: SsoHandoffWarning[] = [];

  const idpEntityId = config.idpConfig?.idpEntityId?.trim() ?? '';
  const idpUrl = config.idpConfig?.ssoUrl?.trim() ?? '';
  const x509Cert =
    (config.idpConfig?.idpCertificates ?? [])
      .map((c) => c.x509Certificate?.trim())
      .find((c) => c && c.length > 0) ?? '';

  const missingFields: string[] = [];
  if (!idpEntityId) missingFields.push('idpConfig.idpEntityId');
  if (!idpUrl) missingFields.push('idpConfig.ssoUrl');
  if (!x509Cert) missingFields.push('idpConfig.idpCertificates');

  if (missingFields.length > 0) {
    const warning = incompleteConnectionConfigurationWarning({
      provider: 'firebase',
      protocol: 'saml',
      externalId,
      missingFields,
      reason: 'Firebase inboundSamlConfig is missing required IdP handoff fields',
    });
    return {
      status: 'skipped',
      protocol: 'saml',
      externalId,
      reason: warning.message,
      warnings: [warning],
    };
  }

  const samlRow = createSamlConnectionRow({
    organizationName: scope?.tenantDisplayName ?? scope?.tenantId ?? '',
    organizationId: '',
    organizationExternalId: scope?.tenantId ?? '',
    domains: '',
    idpEntityId,
    idpUrl,
    x509Cert,
    idpMetadataUrl: '',
    customEntityId: config.spConfig?.spEntityId ?? '',
    customAcsUrl: config.spConfig?.callbackUri ?? '',
    externalId,
  });

  warnings.push(
    missingDomainsWarning({
      provider: 'firebase',
      protocol: 'saml',
      externalId,
      organizationExternalId: scope?.tenantId,
      organizationName: scope?.tenantDisplayName,
    }),
  );

  if (config.idpConfig?.signRequest === true) {
    warnings.push(
      incompleteConnectionConfigurationWarning({
        provider: 'firebase',
        protocol: 'saml',
        externalId,
        missingFields: ['sp_request_signing'],
        reason:
          'IdP expects signed SAML AuthnRequests (idpConfig.signRequest=true); verify SP request signing is configured in WorkOS',
      }),
    );
  }

  const expiringCerts = collectExpiringSpCertificates(config.spConfig?.spCertificates);
  if (expiringCerts.length > 0) {
    warnings.push(
      incompleteConnectionConfigurationWarning({
        provider: 'firebase',
        protocol: 'saml',
        externalId,
        missingFields: ['sp_certificate_renewal'],
        reason: `Firebase-managed SP certificate(s) expire(d) at: ${expiringCerts.join(', ')}. After cutover to WorkOS, customer must register WorkOS's SP signing certificate at the IdP.`,
      }),
    );
  }

  return {
    status: 'mapped',
    protocol: 'saml',
    externalId,
    row: samlRow,
    warnings,
  };
}

export function mapFirebaseOidcConfig(
  input: FirebaseOidcMappingInput,
): FirebaseSsoConnectionMapping<OidcRow> {
  const { config, scope } = input;
  const configId = extractConfigId(config.name);
  const externalId = scope?.tenantId
    ? `firebase:${scope.tenantId}:${configId}`
    : `firebase:${configId}`;
  const warnings: SsoHandoffWarning[] = [];

  const clientId = config.clientId?.trim() ?? '';
  const issuer = config.issuer?.trim() ?? '';

  const missingFields: string[] = [];
  if (!clientId) missingFields.push('clientId');
  if (!issuer) missingFields.push('issuer');

  if (missingFields.length > 0) {
    const warning = incompleteConnectionConfigurationWarning({
      provider: 'firebase',
      protocol: 'oidc',
      externalId,
      missingFields,
      reason: 'Firebase oauthIdpConfig is missing required handoff fields',
    });
    return {
      status: 'skipped',
      protocol: 'oidc',
      externalId,
      reason: warning.message,
      warnings: [warning],
    };
  }

  const hadSecret = Boolean(config.clientSecret && config.clientSecret.trim().length > 0);

  const oidcRow = createOidcConnectionRow({
    organizationName: scope?.tenantDisplayName ?? scope?.tenantId ?? '',
    organizationId: '',
    organizationExternalId: scope?.tenantId ?? '',
    domains: '',
    clientId,
    // Redact: WorkOS handoff CSVs must never carry source-provider client
    // secrets — the customer re-enters them in the WorkOS dashboard.
    clientSecret: '',
    discoveryEndpoint: normalizeDiscoveryEndpoint(issuer),
    externalId,
  });

  if (hadSecret) {
    warnings.push(
      redactedSecretsWarning({
        provider: 'firebase',
        protocol: 'oidc',
        externalId,
        file: 'sso/oidc_connections.csv',
        fields: ['clientSecret'],
      }),
    );
  }

  warnings.push(
    missingDomainsWarning({
      provider: 'firebase',
      protocol: 'oidc',
      externalId,
      organizationExternalId: scope?.tenantId,
      organizationName: scope?.tenantDisplayName,
    }),
  );

  return {
    status: 'mapped',
    protocol: 'oidc',
    externalId,
    row: oidcRow,
    warnings,
  };
}

const CERT_EXPIRY_WARNING_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function collectExpiringSpCertificates(
  certs: Array<{ x509Certificate?: string | null; expiresAt?: string | null }> | undefined,
): string[] {
  if (!certs || certs.length === 0) return [];
  const now = Date.now();
  const cutoff = now + CERT_EXPIRY_WARNING_WINDOW_MS;
  const expiring: string[] = [];
  for (const cert of certs) {
    const expiresAt = cert.expiresAt?.trim();
    if (!expiresAt) continue;
    const ts = Date.parse(expiresAt);
    if (Number.isNaN(ts)) continue;
    if (ts <= cutoff) expiring.push(expiresAt);
  }
  return expiring;
}

function extractConfigId(resourceName: string | null | undefined): string {
  if (!resourceName) return '';
  const segments = resourceName.split('/');
  return segments[segments.length - 1] ?? '';
}

function normalizeDiscoveryEndpoint(issuer: string): string {
  const trimmed = issuer.replace(/\/+$/, '');
  return trimmed.endsWith('/.well-known/openid-configuration')
    ? trimmed
    : `${trimmed}/.well-known/openid-configuration`;
}
