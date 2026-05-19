import type { TotpRecord } from '../../shared/types.js';
import type { SupabasePgQueryClient } from './pg-client.js';
import type { SupabaseMfaFactorRow } from './types.js';

const MFA_QUERY = `
  SELECT u.email,
         f.factor_type,
         f.secret,
         f.friendly_name,
         f.status
    FROM auth.mfa_factors f
    JOIN auth.users u ON u.id = f.user_id
   WHERE f.status = 'verified'
   ORDER BY u.email
`;

const BASE32_RE = /^[A-Z2-7]+=*$/i;

export interface MfaExportResult {
  records: TotpRecord[];
  warnings: string[];
  skippedNonTotp: number;
}

export interface MfaExportOptions {
  totpIssuer?: string;
}

export async function exportMfaFactors(
  pg: SupabasePgQueryClient,
  options: MfaExportOptions = {},
): Promise<MfaExportResult> {
  const issuer = options.totpIssuer ?? 'Supabase';
  const result: MfaExportResult = { records: [], warnings: [], skippedNonTotp: 0 };

  let rows: SupabaseMfaFactorRow[];
  try {
    rows = await pg.query<SupabaseMfaFactorRow>(MFA_QUERY);
  } catch (error: unknown) {
    const message = (error as Error).message ?? 'unknown error';
    if (isMissingTableError(message)) {
      result.warnings.push(
        'auth.mfa_factors table not found (older GoTrue schema?); MFA export skipped.',
      );
      return result;
    }
    throw error;
  }

  for (const row of rows) {
    if (!row.email?.trim()) {
      result.warnings.push('Skipping MFA factor with empty email');
      continue;
    }

    if (row.factor_type !== 'totp') {
      result.skippedNonTotp++;
      result.warnings.push(
        `Skipping non-TOTP factor (${row.factor_type}) for ${row.email}; only TOTP factors are migrated`,
      );
      continue;
    }

    const secret = row.secret?.trim();
    if (!secret || !BASE32_RE.test(secret)) {
      result.warnings.push(
        `Skipping TOTP factor for ${row.email}: secret is not a valid Base32 string`,
      );
      continue;
    }

    result.records.push({
      email: row.email.trim(),
      totpSecret: secret,
      totpIssuer: issuer,
      totpUser: row.email.trim(),
    });
  }

  if (rows.length === 0) {
    result.warnings.push('No verified TOTP MFA factors found in auth.mfa_factors.');
  } else if (result.records.length === 0) {
    result.warnings.push(
      `Queried ${rows.length} MFA factor(s) but emitted 0 (all skipped due to type/format).`,
    );
  }

  return result;
}

function isMissingTableError(message: string): boolean {
  return /does not exist/i.test(message) && /mfa_factors|auth\./i.test(message);
}
