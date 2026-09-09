/**
 * WorkOS SSO connection types accepted by `POST /connections`.
 *
 * The API infers `GenericSAML` / `GenericOIDC` when `connection_type` is
 * omitted, so exporters only set the column when they can name a specific
 * provider. Values are matched case-insensitively at import time.
 */
export const WORKOS_SAML_CONNECTION_TYPES = [
  'ADFSSAML',
  'Auth0SAML',
  'AzureSAML',
  'CasSAML',
  'ClassLinkSAML',
  'CloudflareSAML',
  'CyberArkSAML',
  'DuoSAML',
  'GenericSAML',
  'GoogleSAML',
  'JumpCloudSAML',
  'KeycloakSAML',
  'LastPassSAML',
  'MiniOrangeSAML',
  'NetIqSAML',
  'OktaSAML',
  'OneLoginSAML',
  'OracleSAML',
  'PingFederateSAML',
  'PingOneSAML',
  'RipplingSAML',
  'SalesforceSAML',
  'ShibbolethGenericSAML',
  'ShibbolethSAML',
  'SimpleSamlPhpSAML',
  'VMwareSAML',
] as const;

export const WORKOS_OIDC_CONNECTION_TYPES = [
  'AdpOidc',
  'EntraIdOIDC',
  'GenericOIDC',
  'LoginGovOidc',
] as const;

export type WorkOSSamlConnectionType = (typeof WORKOS_SAML_CONNECTION_TYPES)[number];
export type WorkOSOidcConnectionType = (typeof WORKOS_OIDC_CONNECTION_TYPES)[number];
export type WorkOSConnectionType = WorkOSSamlConnectionType | WorkOSOidcConnectionType;

const CANONICAL_BY_LOWER = new Map<string, WorkOSConnectionType>(
  [...WORKOS_SAML_CONNECTION_TYPES, ...WORKOS_OIDC_CONNECTION_TYPES].map((type) => [
    type.toLowerCase(),
    type,
  ]),
);

/** Resolve a loosely-cased connection type to its canonical WorkOS name. */
export function normalizeConnectionType(
  value: string | undefined | null,
): WorkOSConnectionType | undefined {
  if (!value) return undefined;
  return CANONICAL_BY_LOWER.get(value.trim().toLowerCase());
}

export function isSamlConnectionType(type: string): type is WorkOSSamlConnectionType {
  return (WORKOS_SAML_CONNECTION_TYPES as readonly string[]).includes(type);
}

export function isOidcConnectionType(type: string): type is WorkOSOidcConnectionType {
  return (WORKOS_OIDC_CONNECTION_TYPES as readonly string[]).includes(type);
}

const SAML_HOST_HINTS: Array<[RegExp, WorkOSSamlConnectionType]> = [
  [/(^|\.)okta(preview|-emea)?\.com$/i, 'OktaSAML'],
  [/(^|\.)oktapreview\.com$/i, 'OktaSAML'],
  [/(^|\.)(login\.microsoftonline\.com|sts\.windows\.net|login\.windows\.net)$/i, 'AzureSAML'],
  [/(^|\.)(accounts\.google\.com|google\.com)$/i, 'GoogleSAML'],
  [/(^|\.)onelogin\.com$/i, 'OneLoginSAML'],
  [/(^|\.)jumpcloud\.com$/i, 'JumpCloudSAML'],
  [/(^|\.)pingone\.(com|eu|ca|asia)$/i, 'PingOneSAML'],
  [/(^|\.)pingidentity\.com$/i, 'PingOneSAML'],
  [/(^|\.)duosecurity\.com$/i, 'DuoSAML'],
  [/(^|\.)cyberark\.(com|cloud)$/i, 'CyberArkSAML'],
  [/(^|\.)idaptive\.app$/i, 'CyberArkSAML'],
  [/(^|\.)lastpass\.com$/i, 'LastPassSAML'],
  [/(^|\.)classlink\.com$/i, 'ClassLinkSAML'],
  [/(^|\.)cloudflareaccess\.com$/i, 'CloudflareSAML'],
  [/(^|\.)rippling\.com$/i, 'RipplingSAML'],
  [/(^|\.)(salesforce\.com|force\.com|my\.salesforce\.com)$/i, 'SalesforceSAML'],
  [/(^|\.)miniorange\.com$/i, 'MiniOrangeSAML'],
  [/(^|\.)auth0\.com$/i, 'Auth0SAML'],
];

/**
 * Best-effort SAML connection type from an IdP URL (SSO URL, metadata URL, or
 * entity ID). Returns undefined when the host is not a recognizable hosted IdP
 * so callers can leave `connection_type` blank and let WorkOS infer Generic.
 */
export function inferSamlConnectionTypeFromUrl(
  ...urls: Array<string | undefined | null>
): WorkOSSamlConnectionType | undefined {
  for (const raw of urls) {
    if (!raw) continue;
    let host: string;
    try {
      host = new URL(raw.trim()).hostname;
    } catch {
      continue;
    }
    for (const [pattern, type] of SAML_HOST_HINTS) {
      if (pattern.test(host)) return type;
    }
  }
  return undefined;
}
