function sanitizeMetadataForWorkOS(metadata) {
    const sanitized = {};
    for (const [key, value] of Object.entries(metadata)) {
        // Rename reserved org field names with auth0_ prefix
        if (key === 'organization_id' ||
            key === 'organization_name' ||
            key === 'org_id' ||
            key === 'org_name' ||
            key === 'organizationId' ||
            key === 'organizationName') {
            sanitized[`auth0_${key}`] = convertToString(value);
            continue;
        }
        sanitized[key] = convertToString(value);
    }
    return sanitized;
}
function convertToString(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'string')
        return value;
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number')
        return String(value);
    return JSON.stringify(value);
}
export function mapAuth0UserToWorkOS(user, org, passwordHash) {
    let firstName = user.given_name;
    let lastName = user.family_name;
    // Fallback: parse 'name' field
    if (!firstName && !lastName && user.name) {
        const nameParts = user.name.trim().split(/\s+/);
        firstName = nameParts[0];
        lastName = nameParts.slice(1).join(' ');
    }
    // Merge user_metadata and app_metadata
    const rawMetadata = {
        ...user.user_metadata,
        ...user.app_metadata,
    };
    rawMetadata.auth0_user_id = user.user_id;
    rawMetadata.auth0_created_at = user.created_at;
    rawMetadata.auth0_updated_at = user.updated_at;
    if (user.identities && user.identities.length > 0) {
        rawMetadata.auth0_identities = user.identities.map((identity) => ({
            provider: identity.provider,
            connection: identity.connection,
            isSocial: identity.isSocial,
        }));
    }
    if (user.last_login) {
        rawMetadata.auth0_last_login = user.last_login;
    }
    if (user.logins_count !== undefined) {
        rawMetadata.auth0_logins_count = user.logins_count;
    }
    const metadata = sanitizeMetadataForWorkOS(rawMetadata);
    const csvRow = {
        email: user.email,
        first_name: firstName,
        last_name: lastName,
        email_verified: user.email_verified,
        external_id: user.user_id,
        metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : undefined,
        org_external_id: org.id,
        org_name: org.display_name || org.name,
        password_hash: passwordHash?.hash,
        password_hash_type: passwordHash?.algorithm
            ? mapAuth0PasswordAlgorithm(passwordHash.algorithm)
            : undefined,
    };
    return csvRow;
}
function mapAuth0PasswordAlgorithm(algorithm) {
    const lower = algorithm.toLowerCase();
    if (lower.includes('bcrypt'))
        return 'bcrypt';
    if (lower.includes('md5'))
        return 'md5';
    return 'auth0';
}
export function validateMappedRow(row) {
    if (!row.email || typeof row.email !== 'string' || row.email.trim() === '') {
        return 'Missing required field: email';
    }
    if (!row.email.includes('@')) {
        return `Invalid email format: ${row.email}`;
    }
    if (row.metadata) {
        try {
            JSON.parse(row.metadata);
        }
        catch {
            return 'Invalid metadata: must be valid JSON';
        }
    }
    return null;
}
export function extractOrgFromMetadata(user, customOrgIdField, customOrgNameField) {
    const extractFromMetadata = (metadata) => {
        let orgId;
        let orgName;
        if (customOrgIdField)
            orgId = metadata[customOrgIdField];
        if (customOrgNameField)
            orgName = metadata[customOrgNameField];
        if (!orgId) {
            orgId = metadata.organization_id || metadata.org_id || metadata.organizationId;
        }
        if (!orgName) {
            orgName = metadata.organization_name || metadata.org_name || metadata.organizationName;
        }
        if (orgId || orgName) {
            return {
                orgId: orgId ? String(orgId) : undefined,
                orgName: orgName ? String(orgName) : undefined,
            };
        }
        return null;
    };
    if (user.user_metadata) {
        const result = extractFromMetadata(user.user_metadata);
        if (result)
            return result;
    }
    if (user.app_metadata) {
        const result = extractFromMetadata(user.app_metadata);
        if (result)
            return result;
    }
    return null;
}
