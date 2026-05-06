const RESERVED_SLUGS = new Set(['admin', 'member', 'owner']);
const SLUG_FALLBACK_PREFIX = 'auth0-role';
/**
 * Convert an Auth0 role name into a stable kebab-case slug. Returns an empty
 * string when the name has no slug-able characters so callers can decide
 * whether to synthesize a fallback.
 */
export function normalizeRoleSlug(input) {
    if (!input)
        return '';
    const lowered = input.toString().toLowerCase().normalize('NFKD');
    const replaced = lowered.replace(/[^a-z0-9]+/g, '-');
    return replaced.replace(/^-+|-+$/g, '');
}
export function normalizeAuth0Roles(roles) {
    const seenSlugs = new Map();
    const slugByRoleId = new Map();
    const warnings = [];
    const ordered = [];
    let fallbackIndex = 0;
    for (const role of roles) {
        if (!role || !role.id)
            continue;
        if (slugByRoleId.has(role.id)) {
            warnings.push({
                code: 'duplicate_role_id',
                message: `Auth0 returned role id ${role.id} more than once; using the first occurrence.`,
                role_id: role.id,
                role_name: role.name,
            });
            continue;
        }
        const baseSlug = normalizeRoleSlug(role.name);
        let synthesized = false;
        let candidate = baseSlug;
        if (!candidate || RESERVED_SLUGS.has(candidate)) {
            synthesized = !candidate;
            const fallbackSeed = candidate || normalizeRoleSlug(role.id) || `${SLUG_FALLBACK_PREFIX}-${++fallbackIndex}`;
            candidate = candidate ? `${candidate}-role` : fallbackSeed;
            if (!candidate.startsWith(SLUG_FALLBACK_PREFIX) && synthesized) {
                candidate = `${SLUG_FALLBACK_PREFIX}-${candidate}`;
            }
            if (synthesized) {
                warnings.push({
                    code: 'unmappable_role_name',
                    message: `Auth0 role ${role.id} has no slug-able name "${role.name ?? ''}"; using fallback slug "${candidate}".`,
                    role_id: role.id,
                    role_name: role.name,
                    slug: candidate,
                });
            }
        }
        let collisionSuffixed = false;
        let finalSlug = candidate;
        let suffix = 2;
        while (seenSlugs.has(finalSlug)) {
            collisionSuffixed = true;
            finalSlug = `${candidate}-${suffix}`;
            suffix += 1;
        }
        if (collisionSuffixed) {
            warnings.push({
                code: 'duplicate_role_slug',
                message: `Auth0 role "${role.name ?? role.id}" produced slug "${candidate}" which collided with another role; renamed to "${finalSlug}".`,
                role_id: role.id,
                role_name: role.name,
                slug: finalSlug,
            });
        }
        const normalized = {
            source: role,
            slug: finalSlug,
            name: role.name?.trim() || finalSlug,
            ...(role.description ? { description: role.description } : {}),
            synthesized,
            collisionSuffixed,
        };
        seenSlugs.set(finalSlug, normalized);
        slugByRoleId.set(role.id, finalSlug);
        ordered.push(normalized);
    }
    return {
        roles: ordered,
        warnings,
        slugByRoleId,
    };
}
/**
 * Convert an Auth0 member's role list into normalized assignment rows and the
 * deduplicated slug list to merge into the user/membership rows.
 */
export function buildRoleAssignmentRows(input, slugByRoleId) {
    const rows = [];
    const seenSlugs = new Set();
    const warnings = [];
    for (const role of input.roles) {
        if (!role || !role.id)
            continue;
        const slug = slugByRoleId.get(role.id);
        if (!slug) {
            warnings.push({
                code: 'unknown_role_assignment',
                message: `Auth0 user ${input.externalId} is assigned to role ${role.id} which is not in the role catalog; skipping assignment.`,
                role_id: role.id,
                role_name: role.name,
            });
            continue;
        }
        if (seenSlugs.has(slug))
            continue;
        seenSlugs.add(slug);
        rows.push({
            email: input.email ?? '',
            user_id: '',
            external_id: input.externalId,
            role_slug: slug,
            org_id: '',
            org_external_id: input.orgExternalId,
        });
    }
    return {
        rows,
        slugs: [...seenSlugs],
        warnings,
    };
}
