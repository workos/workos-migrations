export interface SupabaseIdentity {
  id?: string;
  user_id?: string;
  identity_id?: string;
  identity_data?: Record<string, unknown>;
  provider: string;
  provider_id?: string;
  last_sign_in_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SupabaseAdminUser {
  id: string;
  aud?: string;
  role?: string;
  email?: string;
  email_confirmed_at?: string | null;
  phone?: string;
  phone_confirmed_at?: string | null;
  confirmed_at?: string | null;
  invited_at?: string | null;
  last_sign_in_at?: string | null;
  created_at: string;
  updated_at?: string;
  banned_until?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  identities?: SupabaseIdentity[];
  is_anonymous?: boolean;
  [key: string]: unknown;
}

export interface SupabaseAdminListResponse {
  users: SupabaseAdminUser[];
  aud?: string;
  total_pages?: number;
  next_page?: number | string | null;
}

export interface SupabaseSkippedRecord {
  supabase_uid: string;
  email: string;
  reason: string;
}

export interface SupabaseExportStats {
  totalFetched: number;
  exported: number;
  skipped: number;
  totpExported: number;
  samlExported: number;
  orgsExported: number;
  membershipsExported: number;
  orphanMemberships: number;
  warnings: string[];
  skippedRecords: SupabaseSkippedRecord[];
}

export interface SupabaseMfaFactorRow {
  email: string;
  factor_type: string;
  secret: string;
  friendly_name?: string | null;
  status: string;
}

export interface SupabaseSamlProviderRow {
  id: string;
  sso_provider_id: string;
  entity_id: string | null;
  metadata_xml: string | null;
  metadata_url: string | null;
  attribute_mapping: Record<string, unknown> | null;
  resource_id: string | null;
  domains: string[] | null;
}

export class SupabasePgError extends Error {
  hint?: string;

  constructor(message: string, hint?: string) {
    super(hint ? `${message}\n  hint: ${hint}` : message);
    this.name = 'SupabasePgError';
    this.hint = hint;
  }
}

export class SupabaseAuthError extends Error {
  statusCode: number;
  body: string;
  hint?: string;

  constructor(statusCode: number, body: string, hint?: string) {
    const base = `Supabase Admin API error (${statusCode}): ${body}`;
    super(hint ? `${base}\n  hint: ${hint}` : base);
    this.name = 'SupabaseAuthError';
    this.statusCode = statusCode;
    this.body = body;
    this.hint = hint;
  }
}
