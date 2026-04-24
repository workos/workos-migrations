// --- CSV Row (raw input from CSV file) ---

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

// --- User Record (parsed and normalized) ---

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

export type PasswordHashType =
  | 'bcrypt'
  | 'firebase-scrypt'
  | 'ssha'
  | 'md5'
  | 'okta-bcrypt';

// --- Import Types ---

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

// --- Error Types ---

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

// --- Export Types ---

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

// --- Auth0 Types ---

export interface Auth0User {
  user_id: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
  picture?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_login?: string;
  logins_count?: number;
  identities?: Array<{
    provider: string;
    user_id: string;
    connection: string;
    isSocial: boolean;
  }>;
}

export interface Auth0Organization {
  id: string;
  name: string;
  display_name?: string;
  branding?: {
    logo_url?: string;
    colors?: Record<string, string>;
  };
  metadata?: Record<string, unknown>;
}

export interface Auth0PasswordRecord {
  _id?: { $oid: string };
  email: string;
  email_verified?: boolean;
  passwordHash: string;
  password_set_date?: { $date: string };
  tenant?: string;
  connection?: string;
}

export interface PasswordLookup {
  [email: string]: {
    hash: string;
    algorithm: string;
    setDate?: string;
  };
}

// --- Checkpoint Types ---

export interface CheckpointState {
  jobId: string;
  csvPath: string;
  csvHash: string;
  createdAt: number;
  updatedAt: number;
  chunkSize: number;
  concurrency: number;
  totalRows: number;
  chunks: ChunkMetadata[];
  summary: CheckpointSummary;
  orgCache?: SerializedOrgCache;
  mode: 'single-org' | 'multi-org' | 'user-only';
  orgId?: string | null;
}

export interface ChunkMetadata {
  chunkId: number;
  startRow: number;
  endRow: number;
  status: 'pending' | 'completed' | 'failed';
  successes: number;
  failures: number;
  membershipsCreated: number;
  usersCreated: number;
  duplicateUsers: number;
  duplicateMemberships: number;
  rolesAssigned?: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export interface CheckpointSummary {
  total: number;
  successes: number;
  failures: number;
  membershipsCreated: number;
  usersCreated: number;
  duplicateUsers: number;
  duplicateMemberships: number;
  rolesAssigned?: number;
  roleAssignmentFailures?: number;
  startedAt: number;
  endedAt: number | null;
  warnings: string[];
}

export interface SerializedOrgCache {
  entries: SerializedCacheEntry[];
  stats: {
    hits: number;
    misses: number;
    evictions: number;
  };
}

export interface SerializedCacheEntry {
  key: string;
  id: string;
  externalId?: string;
  name?: string;
}

export interface CreateCheckpointOptions {
  jobId: string;
  csvPath: string;
  csvHash: string;
  totalRows: number;
  chunkSize: number;
  concurrency: number;
  mode: 'single-org' | 'multi-org' | 'user-only';
  orgId?: string | null;
  checkpointDir?: string;
}

export interface ChunkSummary {
  successes: number;
  failures: number;
  membershipsCreated: number;
  usersCreated: number;
  duplicateUsers: number;
  duplicateMemberships: number;
  rolesAssigned: number;
  durationMs: number;
  warnings?: string[];
}

// --- Provider Types (kept from original repo) ---

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

// --- Progress Types ---

export interface ProgressStats {
  processed: number;
  total: number;
  successes: number;
  failures: number;
  rate: number;
}

// --- Worker Message Types ---

export type CoordinatorMessage =
  | { type: 'initialize'; payload: InitializePayload }
  | { type: 'process-chunk'; payload: ProcessChunkPayload }
  | { type: 'rate-limit-grant'; requestId: string }
  | { type: 'shutdown' };

export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'rate-limit-request'; requestId: string }
  | { type: 'chunk-complete'; payload: ChunkCompletePayload }
  | { type: 'chunk-failed'; payload: ChunkFailedPayload };

export interface InitializePayload {
  cacheEntries: SerializedCacheEntry[];
  options: WorkerImportOptions;
  checkpointDir: string;
}

export interface ProcessChunkPayload {
  chunk: ChunkMetadata;
}

export interface ChunkCompletePayload {
  chunkId: number;
  summary: ChunkSummary;
  cacheUpdates: CacheUpdate[];
}

export interface ChunkFailedPayload {
  chunkId: number;
  error: string;
  partialSummary?: Partial<ChunkSummary>;
}

export interface CacheUpdate {
  key: string;
  id: string;
  externalId?: string;
  name?: string;
}

export interface WorkerImportOptions {
  csvPath: string;
  concurrency: number;
  orgId: string | null;
  dryRun: boolean;
  quiet?: boolean;
}

// --- Create User Payload (for WorkOS SDK) ---

export interface CreateUserPayload {
  email: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  passwordHash?: string;
  passwordHashType?: string;
  emailVerified?: boolean;
  externalId?: string;
  metadata?: Record<string, unknown>;
}
