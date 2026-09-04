import type { WorkOS } from '@workos-inc/node';

export async function getOrganizationById(workos: WorkOS, orgId: string): Promise<boolean> {
  try {
    const org = await (workos as any).organizations.getOrganization(orgId);
    return Boolean(org?.id);
  } catch (err: any) {
    const status: number | undefined = err?.status ?? err?.httpStatus ?? err?.response?.status;
    if (status === 404) return false;
    throw err;
  }
}

export async function getOrganizationByExternalId(
  workos: WorkOS,
  externalId: string,
): Promise<string | null> {
  try {
    const org = await (workos as any).organizations.getOrganizationByExternalId(externalId);
    return org?.id ?? null;
  } catch (err: any) {
    const status: number | undefined = err?.status ?? err?.httpStatus ?? err?.response?.status;
    if (status === 404) return null;
    throw err;
  }
}

export type OrganizationDomainState = 'verified' | 'pending';

export interface OrganizationDomainData {
  domain: string;
  state: OrganizationDomainState;
}

export async function createOrganization(
  workos: WorkOS,
  name: string,
  externalId: string,
  domainData?: OrganizationDomainData[],
): Promise<string> {
  try {
    const org = await (workos as any).organizations.createOrganization({
      name,
      externalId,
      ...(domainData && domainData.length > 0 ? { domainData } : {}),
    });
    return org.id as string;
  } catch (err: any) {
    const enhancedErr = new Error(
      `Failed to create organization "${name}" with external_id "${externalId}": ${err.message}`,
    );
    enhancedErr.stack = err.stack;
    (enhancedErr as any).status = err.status;
    (enhancedErr as any).original = err;
    throw enhancedErr;
  }
}

export interface EnsureOrganizationDomainsResult {
  added: string[];
  existing: string[];
}

/**
 * Add any missing domains to an existing organization. Domains already on the
 * organization keep their current verification state; new ones are added with
 * the requested state. Returns which domains were added.
 */
export async function ensureOrganizationDomains(
  workos: WorkOS,
  orgId: string,
  domains: string[],
  state: OrganizationDomainState = 'verified',
): Promise<EnsureOrganizationDomainsResult> {
  const wanted = Array.from(new Set(domains.map((domain) => domain.trim().toLowerCase()))).filter(
    Boolean,
  );
  if (wanted.length === 0) return { added: [], existing: [] };

  const org = await (workos as any).organizations.getOrganization(orgId);
  const current: Array<{ domain: string; state: string }> = Array.isArray(org?.domains)
    ? org.domains
    : [];
  const currentByName = new Map(current.map((d) => [d.domain.toLowerCase(), d]));

  const missing = wanted.filter((domain) => !currentByName.has(domain));
  if (missing.length === 0) return { added: [], existing: wanted };

  // updateOrganization replaces the whole domain set and only accepts
  // verified/pending. Refuse to touch an organization whose existing domains
  // carry any other state (failed, legacy_verified, ...) rather than silently
  // rewriting their verification state.
  const untouchable = current.filter(
    (d) => d.state.toLowerCase() !== 'verified' && d.state.toLowerCase() !== 'pending',
  );
  if (untouchable.length > 0) {
    throw new Error(
      `Organization ${orgId} has domain(s) in a state the update API cannot round-trip (${untouchable
        .map((d) => `${d.domain}=${d.state}`)
        .join(', ')}); add ${missing.join(', ')} in the WorkOS dashboard instead.`,
    );
  }

  const domainData = [
    ...current.map((d) => ({
      domain: d.domain,
      state: d.state.toLowerCase() === 'verified' ? 'verified' : 'pending',
    })),
    ...missing.map((domain) => ({ domain, state })),
  ];

  await (workos as any).organizations.updateOrganization({
    organization: orgId,
    domainData,
  });

  return {
    added: missing,
    existing: wanted.filter((domain) => currentByName.has(domain)),
  };
}
