export async function getOrganizationById(workos, orgId) {
    try {
        const org = await workos.organizations.getOrganization(orgId);
        return Boolean(org?.id);
    }
    catch (err) {
        const status = err?.status ?? err?.httpStatus ?? err?.response?.status;
        if (status === 404)
            return false;
        throw err;
    }
}
export async function getOrganizationByExternalId(workos, externalId) {
    try {
        const org = await workos.organizations.getOrganizationByExternalId(externalId);
        return org?.id ?? null;
    }
    catch (err) {
        const status = err?.status ?? err?.httpStatus ?? err?.response?.status;
        if (status === 404)
            return null;
        throw err;
    }
}
export async function createOrganization(workos, name, externalId) {
    try {
        const org = await workos.organizations.createOrganization({
            name,
            externalId,
        });
        return org.id;
    }
    catch (err) {
        const enhancedErr = new Error(`Failed to create organization "${name}" with external_id "${externalId}": ${err.message}`);
        enhancedErr.stack = err.stack;
        enhancedErr.status = err.status;
        enhancedErr.original = err;
        throw enhancedErr;
    }
}
