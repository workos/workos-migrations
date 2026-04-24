export interface CSVRow {
    email?: string;
    password?: string;
    password_hash?: string;
    password_hash_type?: string;
    first_name?: string;
    last_name?: string;
    email_verified?: string | boolean;
    external_id?: string;
    metadata?: string;
    org_id?: string;
    org_external_id?: string;
    org_name?: string;
    role_slugs?: string;
    [key: string]: unknown;
}
export interface UserRecord {
    email: string;
    firstName?: string;
    lastName?: string;
    emailVerified?: boolean;
    externalId?: string;
    passwordHash?: string;
    passwordHashType?: PasswordHashType;
    password?: string;
    metadata?: Record<string, string>;
    orgId?: string;
    orgExternalId?: string;
    orgName?: string;
    roleSlugs?: string[];
}
export type PasswordHashType = 'bcrypt' | 'firebase-scrypt' | 'ssha' | 'md5' | 'okta-bcrypt';
export interface ImportOptions {
    csvFilePath: string;
    concurrency: number;
    rateLimit: number;
    workers: number;
    chunkSize: number;
    jobId?: string;
    resume?: boolean;
    dryRun: boolean;
    plan: boolean;
    createOrgIfMissing: boolean;
    orgId?: string;
    orgExternalId?: string;
    orgName?: string;
    dedupe: boolean;
    errorsPath: string;
    quiet: boolean;
}
export interface ImportSummary {
    totalRows: number;
    usersCreated: number;
    membershipsCreated: number;
    duplicateUsers: number;
    duplicateMemberships: number;
    errors: number;
    rolesAssigned: number;
    roleAssignmentFailures: number;
    warnings: string[];
    duration: number;
    cacheStats?: {
        hits: number;
        misses: number;
        hitRate: string;
    };
    chunkProgress?: {
        completedChunks: number;
        totalChunks: number;
        percentComplete: number;
    };
}
export interface ErrorRecord {
    recordNumber: number;
    email?: string;
    userId?: string;
    errorType?: 'user_create' | 'membership_create' | 'org_resolution' | 'role_assignment';
    errorMessage: string;
    timestamp: string;
    httpStatus?: number;
    workosCode?: string;
    workosRequestId?: string;
    workosErrors?: unknown;
    orgId?: string;
    orgExternalId?: string;
    roleSlugs?: string[];
}
export interface Auth0ExportOptions {
    domain: string;
    clientId: string;
    clientSecret: string;
    output: string;
    orgs?: string[];
    pageSize: number;
    rateLimit: number;
    userFetchConcurrency: number;
    useMetadata: boolean;
    metadataOrgIdField?: string;
    metadataOrgNameField?: string;
    jobId?: string;
    resume?: boolean;
    quiet: boolean;
}
export interface ExportSummary {
    totalUsers: number;
    totalOrgs: number;
    skippedUsers: number;
    duration: number;
}
export interface CheckpointState {
    jobId: string;
    csvHash: string;
    totalRows: number;
    processedRows: number;
    chunkStates: Record<string, 'pending' | 'processing' | 'complete'>;
    orgCache: Record<string, string>;
    summary: Partial<ImportSummary>;
    timestamp: string;
}
export interface ProviderCredentials {
    [key: string]: string;
}
export interface Provider {
    name: string;
    displayName: string;
    credentials: CredentialField[];
    entities: EntityType[];
}
export interface CredentialField {
    key: string;
    name: string;
    type: 'input' | 'password';
    required: boolean;
    envVar?: string;
}
export interface EntityType {
    key: string;
    name: string;
    description: string;
    enabled: boolean;
}
export interface ProgressStats {
    processed: number;
    total: number;
    successes: number;
    failures: number;
    rate: number;
}
export interface WorkerMessage {
    type: 'rate-limit-request' | 'rate-limit-grant' | 'progress' | 'chunk-complete' | 'error';
    requestId?: string;
    data?: unknown;
}
