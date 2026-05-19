import type { CSVRow } from '../../shared/types.js';
import { splitDisplayName } from '../../shared/name-split.js';
import type { SupabaseAdminUser, SupabaseIdentity } from './types.js';

export interface MappedSupabaseUser {
  csvRow: CSVRow;
  skipped: boolean;
  skipReason?: string;
  warnings: string[];
}

function readStringField(
  source: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function resolveNames(user: SupabaseAdminUser): { firstName: string; lastName: string } {
  const meta = user.user_metadata;
  const explicitFirst = readStringField(meta, 'first_name');
  const explicitLast = readStringField(meta, 'last_name');
  if (explicitFirst || explicitLast) {
    return { firstName: explicitFirst ?? '', lastName: explicitLast ?? '' };
  }

  const fullName = readStringField(meta, 'full_name') ?? readStringField(meta, 'name');
  if (fullName) return splitDisplayName(fullName, 'first-space');

  return { firstName: '', lastName: '' };
}

/**
 * Returns true if the user is banned (now or forever). `banned_until` may be
 * `null`, an ISO timestamp, or `'infinity'` (Postgres timestamp keyword).
 * Treat unparseable values as banned-forever to err on the side of skipping.
 */
function isBanned(bannedUntil: string | null | undefined): boolean {
  if (bannedUntil === undefined || bannedUntil === null) return false;
  if (bannedUntil === '') return false;

  const trimmed = bannedUntil.trim().toLowerCase();
  if (trimmed === 'infinity') return true;
  if (trimmed === '-infinity') return false;

  const ms = Date.parse(bannedUntil);
  if (Number.isNaN(ms)) return true;
  return ms > Date.now();
}

function summarizeIdentity(identity: SupabaseIdentity): Record<string, unknown> {
  const summary: Record<string, unknown> = { provider: identity.provider };
  if (identity.provider_id) summary.provider_id = identity.provider_id;
  if (identity.identity_data && Object.keys(identity.identity_data).length > 0) {
    summary.identity_data = identity.identity_data;
  }
  if (identity.last_sign_in_at) summary.last_sign_in_at = identity.last_sign_in_at;
  return summary;
}

function buildMetadata(user: SupabaseAdminUser): Record<string, unknown> {
  const metadata: Record<string, unknown> = { supabase_uid: user.id };

  if (user.identities && user.identities.length > 0) {
    metadata.supabase_identities = user.identities.map(summarizeIdentity);
  }

  if (user.app_metadata && Object.keys(user.app_metadata).length > 0) {
    metadata.app_metadata = user.app_metadata;
  }

  if (user.last_sign_in_at) metadata.last_sign_in_at = user.last_sign_in_at;
  if (user.phone) metadata.phone = user.phone;
  if (user.created_at) metadata.supabase_created_at = user.created_at;

  return metadata;
}

export function mapSupabaseUser(user: SupabaseAdminUser): MappedSupabaseUser {
  const warnings: string[] = [];

  const email = user.email?.trim();
  if (!email) {
    return {
      csvRow: {},
      skipped: true,
      skipReason: 'Missing email address',
      warnings,
    };
  }

  if (isBanned(user.banned_until)) {
    return {
      csvRow: {},
      skipped: true,
      skipReason: 'Banned user',
      warnings,
    };
  }

  const { firstName, lastName } = resolveNames(user);
  const emailVerified = user.email_confirmed_at !== null && user.email_confirmed_at !== undefined;

  const metadata = buildMetadata(user);

  const csvRow: CSVRow = {
    email,
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    email_verified: emailVerified ? 'true' : 'false',
    external_id: user.id,
    metadata: JSON.stringify(metadata),
  };

  return { csvRow, skipped: false, warnings };
}
