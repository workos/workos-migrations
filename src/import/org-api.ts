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

export async function createOrganization(
  workos: WorkOS,
  name: string,
  externalId: string,
): Promise<string> {
  try {
    const org = await (workos as any).organizations.createOrganization({
      name,
      externalId,
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
