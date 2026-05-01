export declare const MIGRATION_PACKAGE_SCHEMA_VERSION = 1;
export declare const MIGRATION_PACKAGE_FILES: {
    readonly manifest: "manifest.json";
    readonly users: "users.csv";
    readonly organizations: "organizations.csv";
    readonly memberships: "organization_memberships.csv";
    readonly roleDefinitions: "role_definitions.csv";
    readonly userRoleAssignments: "user_role_assignments.csv";
    readonly totpSecrets: "totp_secrets.csv";
    readonly warnings: "warnings.jsonl";
    readonly skippedUsers: "skipped_users.jsonl";
    readonly samlConnections: "sso/saml_connections.csv";
    readonly oidcConnections: "sso/oidc_connections.csv";
    readonly customAttributeMappings: "sso/custom_attribute_mappings.csv";
    readonly proxyRoutes: "sso/proxy_routes.csv";
    readonly handoffNotes: "sso/handoff_notes.md";
};
export type MigrationPackageFileKey = keyof typeof MIGRATION_PACKAGE_FILES;
export type MigrationPackageFilePath = (typeof MIGRATION_PACKAGE_FILES)[MigrationPackageFileKey];
export declare const MIGRATION_PACKAGE_FILE_KEYS: MigrationPackageFileKey[];
export declare const USER_CSV_HEADERS: readonly ["email", "password", "password_hash", "password_hash_type", "first_name", "last_name", "email_verified", "external_id", "metadata", "org_id", "org_external_id", "org_name", "role_slugs"];
export declare const ORGANIZATION_CSV_HEADERS: readonly ["org_id", "org_external_id", "org_name", "domains", "metadata"];
export declare const ORGANIZATION_MEMBERSHIP_CSV_HEADERS: readonly ["email", "external_id", "user_id", "org_id", "org_external_id", "org_name", "role_slugs", "metadata"];
export declare const ROLE_DEFINITION_CSV_HEADERS: readonly ["role_slug", "role_name", "role_type", "permissions", "org_id", "org_external_id"];
export declare const USER_ROLE_ASSIGNMENT_CSV_HEADERS: readonly ["email", "user_id", "external_id", "role_slug", "org_id", "org_external_id"];
export declare const TOTP_SECRET_CSV_HEADERS: readonly ["email", "totp_secret", "totp_issuer", "totp_user"];
export declare const SAML_CONNECTION_CSV_HEADERS: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "idpEntityId", "idpUrl", "x509Cert", "idpMetadataUrl", "customEntityId", "customAcsUrl", "idpIdAttribute", "emailAttribute", "firstNameAttribute", "lastNameAttribute", "name", "customAttributes", "idpInitiatedEnabled", "requestSigningKey", "assertionEncryptionKey", "nameIdEncryptionKey", "importedId"];
export declare const OIDC_CONNECTION_CSV_HEADERS: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "clientId", "clientSecret", "discoveryEndpoint", "customRedirectUri", "name", "customAttributes", "importedId"];
export declare const CUSTOM_ATTRIBUTE_MAPPING_CSV_HEADERS: readonly ["importedId", "organizationExternalId", "providerType", "userPoolAttribute", "idpClaim"];
export declare const PROXY_ROUTE_CSV_HEADERS: readonly ["importedId", "organizationExternalId", "provider", "protocol", "sourceAcsUrl", "sourceEntityId", "sourceRedirectUri", "customAcsUrl", "customEntityId", "customRedirectUri", "workosConnectionId", "workosAcsUrl", "cutoverState", "notes"];
export declare const MIGRATION_PACKAGE_CSV_HEADERS: {
    readonly users: readonly ["email", "password", "password_hash", "password_hash_type", "first_name", "last_name", "email_verified", "external_id", "metadata", "org_id", "org_external_id", "org_name", "role_slugs"];
    readonly organizations: readonly ["org_id", "org_external_id", "org_name", "domains", "metadata"];
    readonly memberships: readonly ["email", "external_id", "user_id", "org_id", "org_external_id", "org_name", "role_slugs", "metadata"];
    readonly roleDefinitions: readonly ["role_slug", "role_name", "role_type", "permissions", "org_id", "org_external_id"];
    readonly userRoleAssignments: readonly ["email", "user_id", "external_id", "role_slug", "org_id", "org_external_id"];
    readonly totpSecrets: readonly ["email", "totp_secret", "totp_issuer", "totp_user"];
    readonly samlConnections: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "idpEntityId", "idpUrl", "x509Cert", "idpMetadataUrl", "customEntityId", "customAcsUrl", "idpIdAttribute", "emailAttribute", "firstNameAttribute", "lastNameAttribute", "name", "customAttributes", "idpInitiatedEnabled", "requestSigningKey", "assertionEncryptionKey", "nameIdEncryptionKey", "importedId"];
    readonly oidcConnections: readonly ["organizationName", "organizationId", "organizationExternalId", "domains", "clientId", "clientSecret", "discoveryEndpoint", "customRedirectUri", "name", "customAttributes", "importedId"];
    readonly customAttributeMappings: readonly ["importedId", "organizationExternalId", "providerType", "userPoolAttribute", "idpClaim"];
    readonly proxyRoutes: readonly ["importedId", "organizationExternalId", "provider", "protocol", "sourceAcsUrl", "sourceEntityId", "sourceRedirectUri", "customAcsUrl", "customEntityId", "customRedirectUri", "workosConnectionId", "workosAcsUrl", "cutoverState", "notes"];
};
export type MigrationPackageCsvFileKey = keyof typeof MIGRATION_PACKAGE_CSV_HEADERS;
export declare const DEFAULT_ENTITY_COUNTS: {
    readonly users: 0;
    readonly organizations: 0;
    readonly memberships: 0;
    readonly roleDefinitions: 0;
    readonly userRoleAssignments: 0;
    readonly totpSecrets: 0;
    readonly samlConnections: 0;
    readonly oidcConnections: 0;
    readonly customAttributeMappings: 0;
    readonly proxyRoutes: 0;
    readonly warnings: 0;
    readonly skippedUsers: 0;
};
export type MigrationPackageEntityCounts = Record<string, number>;
export type MigrationPackageImportabilityLevel = 'automatic' | 'handoff' | 'manual' | 'unsupported';
export interface MigrationPackageImportability {
    users?: MigrationPackageImportabilityLevel;
    organizations?: MigrationPackageImportabilityLevel;
    memberships?: MigrationPackageImportabilityLevel;
    roles?: MigrationPackageImportabilityLevel;
    totpSecrets?: MigrationPackageImportabilityLevel;
    ssoConnections?: MigrationPackageImportabilityLevel;
    [entity: string]: MigrationPackageImportabilityLevel | undefined;
}
export declare const DEFAULT_IMPORTABILITY: MigrationPackageImportability;
export type SecretRedactionMode = 'redacted' | 'included' | 'not-applicable';
export interface SecretRedactionMetadata {
    mode: SecretRedactionMode;
    redacted: boolean;
    redactedFields?: string[];
    files?: string[];
    notes?: string[];
}
export type MigrationPackageFileMap = Partial<Record<MigrationPackageFileKey, string>>;
export interface MigrationPackageManifest {
    schemaVersion: typeof MIGRATION_PACKAGE_SCHEMA_VERSION;
    provider: string;
    sourceTenant?: string;
    generatedAt: string;
    entitiesRequested: string[];
    entitiesExported: MigrationPackageEntityCounts;
    files: MigrationPackageFileMap;
    importability: MigrationPackageImportability;
    secretsRedacted: boolean;
    secretRedaction?: SecretRedactionMetadata;
    warnings: string[];
    metadata?: Record<string, unknown>;
}
export interface CreateMigrationPackageManifestOptions {
    provider: string;
    sourceTenant?: string;
    generatedAt?: Date | string;
    entitiesRequested?: string[];
    entitiesExported?: MigrationPackageEntityCounts;
    files?: MigrationPackageFileMap;
    importability?: MigrationPackageImportability;
    secretsRedacted?: boolean;
    secretRedaction?: SecretRedactionMetadata;
    warnings?: string[];
    metadata?: Record<string, unknown>;
}
export declare function createMigrationPackageManifest(options: CreateMigrationPackageManifestOptions): MigrationPackageManifest;
export declare function isMigrationPackageFileKey(value: string): value is MigrationPackageFileKey;
export declare function isMigrationPackageCsvFileKey(value: string): value is MigrationPackageCsvFileKey;
