export const MIGRATION_PACKAGE_SCHEMA_VERSION = 1;
export const MIGRATION_PACKAGE_FILES = {
    manifest: 'manifest.json',
    users: 'users.csv',
    organizations: 'organizations.csv',
    memberships: 'organization_memberships.csv',
    roleDefinitions: 'role_definitions.csv',
    userRoleAssignments: 'user_role_assignments.csv',
    totpSecrets: 'totp_secrets.csv',
    warnings: 'warnings.jsonl',
    skippedUsers: 'skipped_users.jsonl',
    samlConnections: 'sso/saml_connections.csv',
    oidcConnections: 'sso/oidc_connections.csv',
    customAttributeMappings: 'sso/custom_attribute_mappings.csv',
    proxyRoutes: 'sso/proxy_routes.csv',
    handoffNotes: 'sso/handoff_notes.md',
};
export const MIGRATION_PACKAGE_FILE_KEYS = Object.keys(MIGRATION_PACKAGE_FILES);
export const USER_CSV_HEADERS = [
    'email',
    'password',
    'password_hash',
    'password_hash_type',
    'first_name',
    'last_name',
    'email_verified',
    'external_id',
    'metadata',
    'org_id',
    'org_external_id',
    'org_name',
    'role_slugs',
];
export const ORGANIZATION_CSV_HEADERS = [
    'org_id',
    'org_external_id',
    'org_name',
    'domains',
    'metadata',
];
export const ORGANIZATION_MEMBERSHIP_CSV_HEADERS = [
    'email',
    'external_id',
    'user_id',
    'org_id',
    'org_external_id',
    'org_name',
    'role_slugs',
    'metadata',
];
export const ROLE_DEFINITION_CSV_HEADERS = [
    'role_slug',
    'role_name',
    'role_type',
    'permissions',
    'org_id',
    'org_external_id',
];
export const USER_ROLE_ASSIGNMENT_CSV_HEADERS = [
    'email',
    'user_id',
    'external_id',
    'role_slug',
    'org_id',
    'org_external_id',
];
export const TOTP_SECRET_CSV_HEADERS = [
    'email',
    'totp_secret',
    'totp_issuer',
    'totp_user',
];
export const SAML_CONNECTION_CSV_HEADERS = [
    'organizationName',
    'organizationId',
    'organizationExternalId',
    'domains',
    'idpEntityId',
    'idpUrl',
    'x509Cert',
    'idpMetadataUrl',
    'customEntityId',
    'customAcsUrl',
    'idpIdAttribute',
    'emailAttribute',
    'firstNameAttribute',
    'lastNameAttribute',
    'name',
    'customAttributes',
    'idpInitiatedEnabled',
    'requestSigningKey',
    'assertionEncryptionKey',
    'nameIdEncryptionKey',
    'importedId',
];
export const OIDC_CONNECTION_CSV_HEADERS = [
    'organizationName',
    'organizationId',
    'organizationExternalId',
    'domains',
    'clientId',
    'clientSecret',
    'discoveryEndpoint',
    'customRedirectUri',
    'name',
    'customAttributes',
    'importedId',
];
export const CUSTOM_ATTRIBUTE_MAPPING_CSV_HEADERS = [
    'importedId',
    'organizationExternalId',
    'providerType',
    'userPoolAttribute',
    'idpClaim',
];
export const PROXY_ROUTE_CSV_HEADERS = [
    'importedId',
    'organizationExternalId',
    'provider',
    'protocol',
    'sourceAcsUrl',
    'sourceEntityId',
    'sourceRedirectUri',
    'customAcsUrl',
    'customEntityId',
    'customRedirectUri',
    'workosConnectionId',
    'workosAcsUrl',
    'cutoverState',
    'notes',
];
export const MIGRATION_PACKAGE_CSV_HEADERS = {
    users: USER_CSV_HEADERS,
    organizations: ORGANIZATION_CSV_HEADERS,
    memberships: ORGANIZATION_MEMBERSHIP_CSV_HEADERS,
    roleDefinitions: ROLE_DEFINITION_CSV_HEADERS,
    userRoleAssignments: USER_ROLE_ASSIGNMENT_CSV_HEADERS,
    totpSecrets: TOTP_SECRET_CSV_HEADERS,
    samlConnections: SAML_CONNECTION_CSV_HEADERS,
    oidcConnections: OIDC_CONNECTION_CSV_HEADERS,
    customAttributeMappings: CUSTOM_ATTRIBUTE_MAPPING_CSV_HEADERS,
    proxyRoutes: PROXY_ROUTE_CSV_HEADERS,
};
export const DEFAULT_ENTITY_COUNTS = {
    users: 0,
    organizations: 0,
    memberships: 0,
    roles: 0,
    roleDefinitions: 0,
    roleAssignments: 0,
    totpSecrets: 0,
    samlConnections: 0,
    oidcConnections: 0,
    customAttributeMappings: 0,
    proxyRoutes: 0,
    warnings: 0,
    skippedUsers: 0,
};
export const DEFAULT_IMPORTABILITY = {
    users: 'automatic',
    organizations: 'automatic',
    memberships: 'automatic',
    roles: 'automatic',
    totpSecrets: 'automatic',
    ssoConnections: 'handoff',
};
export function createMigrationPackageManifest(options) {
    const generatedAt = options.generatedAt instanceof Date
        ? options.generatedAt.toISOString()
        : (options.generatedAt ?? new Date().toISOString());
    const secretsRedacted = options.secretsRedacted ?? options.secretRedaction?.redacted ?? true;
    return {
        schemaVersion: MIGRATION_PACKAGE_SCHEMA_VERSION,
        provider: options.provider,
        ...(options.sourceTenant ? { sourceTenant: options.sourceTenant } : {}),
        generatedAt,
        entitiesRequested: [...(options.entitiesRequested ?? [])],
        entitiesExported: {
            ...DEFAULT_ENTITY_COUNTS,
            ...(options.entitiesExported ?? {}),
        },
        files: {
            ...MIGRATION_PACKAGE_FILES,
            ...(options.files ?? {}),
        },
        importability: {
            ...DEFAULT_IMPORTABILITY,
            ...(options.importability ?? {}),
        },
        secretsRedacted,
        ...(options.secretRedaction ? { secretRedaction: options.secretRedaction } : {}),
        warnings: [...(options.warnings ?? [])],
        ...(options.metadata ? { metadata: options.metadata } : {}),
    };
}
export function isMigrationPackageFileKey(value) {
    return Object.prototype.hasOwnProperty.call(MIGRATION_PACKAGE_FILES, value);
}
export function isMigrationPackageCsvFileKey(value) {
    return Object.prototype.hasOwnProperty.call(MIGRATION_PACKAGE_CSV_HEADERS, value);
}
