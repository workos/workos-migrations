import { createSamlConnectionRow, type SamlRow } from '../../sso/handoff.js';
import { parseSamlMetadata } from '../../sso/saml-metadata.js';
import type { SupabasePgQueryClient } from './pg-client.js';
import type { SupabaseSamlProviderRow } from './types.js';

const SAML_QUERY = `
  SELECT sp.id::text                                    AS id,
         sp.sso_provider_id::text                       AS sso_provider_id,
         sp.entity_id                                    AS entity_id,
         sp.metadata_xml                                 AS metadata_xml,
         sp.metadata_url                                 AS metadata_url,
         sp.attribute_mapping                            AS attribute_mapping,
         ssp.resource_id                                 AS resource_id,
         COALESCE(
           (SELECT array_agg(domain) FROM auth.sso_domains WHERE sso_provider_id = sp.sso_provider_id),
           ARRAY[]::text[]
         )                                               AS domains
    FROM auth.saml_providers sp
    JOIN auth.sso_providers ssp ON ssp.id = sp.sso_provider_id
`;

const METADATA_FETCH_TIMEOUT_MS = 10_000;

export interface SamlExportResult {
  rows: SamlRow[];
  warnings: string[];
}

export async function exportSamlProviders(pg: SupabasePgQueryClient): Promise<SamlExportResult> {
  const result: SamlExportResult = { rows: [], warnings: [] };

  let providers: SupabaseSamlProviderRow[];
  try {
    providers = await pg.query<SupabaseSamlProviderRow>(SAML_QUERY);
  } catch (error: unknown) {
    const message = (error as Error).message ?? 'unknown error';
    if (isMissingTableError(message)) {
      result.warnings.push(
        'auth.saml_providers table not found (older GoTrue schema?); SAML export skipped.',
      );
      return result;
    }
    throw error;
  }

  for (const provider of providers) {
    const row = await buildRow(provider, result.warnings);
    result.rows.push(row);
  }

  return result;
}

async function buildRow(provider: SupabaseSamlProviderRow, warnings: string[]): Promise<SamlRow> {
  let metadataXml = provider.metadata_xml?.trim() ?? '';

  if (!metadataXml && provider.metadata_url) {
    const fetched = await fetchMetadata(provider.metadata_url, warnings, provider.id);
    if (fetched) metadataXml = fetched;
  }

  const parsed = parseSamlMetadata(metadataXml || undefined);

  if (!parsed.entityId && !provider.entity_id) {
    warnings.push(`SAML provider ${provider.id} has no entityId in metadata or row`);
  }
  if (!parsed.ssoRedirectUrl) {
    warnings.push(`SAML provider ${provider.id} has no SingleSignOnService URL`);
  }
  if (!parsed.x509Cert) {
    warnings.push(`SAML provider ${provider.id} has no X.509 certificate in metadata`);
  }

  const attrMap = provider.attribute_mapping ?? {};
  const attributes = readAttributeMapping(attrMap);

  if (!attributes.email) {
    warnings.push(
      `SAML provider ${provider.id} has no email attribute mapping; WorkOS will require manual configuration`,
    );
  }

  const domains = (provider.domains ?? []).filter(Boolean).join(',');
  if (!domains) {
    warnings.push(
      `SAML provider ${provider.id} has no domains configured; domain-capture will be empty`,
    );
  }

  return createSamlConnectionRow({
    organizationName: '',
    organizationId: '',
    organizationExternalId: provider.resource_id ?? '',
    domains,
    idpEntityId: parsed.entityId ?? provider.entity_id ?? '',
    idpUrl: parsed.ssoRedirectUrl ?? '',
    x509Cert: parsed.x509Cert ?? '',
    idpMetadataUrl: provider.metadata_url ?? '',
    emailAttribute: attributes.email,
    firstNameAttribute: attributes.firstName,
    lastNameAttribute: attributes.lastName,
    importedId: provider.id,
  });
}

interface SamlAttributeNames {
  email: string;
  firstName: string;
  lastName: string;
}

function readAttributeMapping(map: Record<string, unknown>): SamlAttributeNames {
  const keys = (map.keys ?? map) as Record<string, unknown>;
  return {
    email: pickAttribute(keys, ['email', 'emailaddress', 'email_address']),
    firstName: pickAttribute(keys, ['first_name', 'firstname', 'given_name', 'givenname']),
    lastName: pickAttribute(keys, [
      'last_name',
      'lastname',
      'family_name',
      'familyname',
      'surname',
    ]),
  };
}

function pickAttribute(source: Record<string, unknown>, candidates: string[]): string {
  for (const key of Object.keys(source)) {
    const lower = key.toLowerCase();
    if (candidates.includes(lower)) {
      const value = source[key];
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object' && 'name' in value) {
        const name = (value as { name?: unknown }).name;
        if (typeof name === 'string') return name;
      }
    }
  }
  return '';
}

async function fetchMetadata(
  url: string,
  warnings: string[],
  providerId: string,
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/xml,text/xml' },
    });
    if (!response.ok) {
      warnings.push(
        `Failed to fetch SAML metadata for provider ${providerId} from ${url}: HTTP ${response.status}`,
      );
      return null;
    }
    return await response.text();
  } catch (error: unknown) {
    warnings.push(
      `Failed to fetch SAML metadata for provider ${providerId} from ${url}: ${(error as Error).message}`,
    );
    return null;
  }
}

function isMissingTableError(message: string): boolean {
  return /does not exist/i.test(message) && /saml_providers|sso_providers|auth\./i.test(message);
}
