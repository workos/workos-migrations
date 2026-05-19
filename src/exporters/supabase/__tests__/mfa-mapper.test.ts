import type { PoolConfig } from 'pg';
import { SupabasePgClient, type PgPoolLike } from '../pg-client.js';
import { exportMfaFactors } from '../mfa-mapper.js';
import type { SupabaseMfaFactorRow } from '../types.js';

function fakeClientWithRows(rows: SupabaseMfaFactorRow[] | (() => never)): SupabasePgClient {
  const factory = (_config: PoolConfig): PgPoolLike => ({
    async query() {
      if (typeof rows === 'function') {
        rows();
        return { rows: [] };
      }
      return { rows };
    },
    async end() {},
  });
  return new SupabasePgClient({ connectionString: 'postgresql://x', poolFactory: factory });
}

describe('exportMfaFactors', () => {
  it('emits TotpRecord rows for verified TOTP factors only', async () => {
    const pg = fakeClientWithRows([
      {
        email: 'alice@example.com',
        factor_type: 'totp',
        secret: 'JBSWY3DPEHPK3PXP',
        friendly_name: 'Phone',
        status: 'verified',
      },
    ]);

    const result = await exportMfaFactors(pg);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toEqual({
      email: 'alice@example.com',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      totpIssuer: 'Supabase',
      totpUser: 'alice@example.com',
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('skips non-TOTP factor types with a warning per factor', async () => {
    const pg = fakeClientWithRows([
      {
        email: 'bob@example.com',
        factor_type: 'webauthn',
        secret: 'IRRELEVANT',
        status: 'verified',
      },
      {
        email: 'carol@example.com',
        factor_type: 'phone',
        secret: 'IRRELEVANT',
        status: 'verified',
      },
    ]);
    const result = await exportMfaFactors(pg);
    expect(result.records).toHaveLength(0);
    expect(result.skippedNonTotp).toBe(2);
    expect(result.warnings.some((w) => /webauthn/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /phone/.test(w))).toBe(true);
  });

  it('skips factors whose secret is not valid Base32', async () => {
    const pg = fakeClientWithRows([
      { email: 'dana@example.com', factor_type: 'totp', secret: 'not-base32!', status: 'verified' },
    ]);
    const result = await exportMfaFactors(pg);
    expect(result.records).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/Base32/);
  });

  it('uses the supplied totpIssuer when provided', async () => {
    const pg = fakeClientWithRows([
      { email: 'alice@example.com', factor_type: 'totp', secret: 'JBSWY3DPEHPK3PXP', status: 'verified' },
    ]);
    const result = await exportMfaFactors(pg, { totpIssuer: 'Acme' });
    expect(result.records[0].totpIssuer).toBe('Acme');
  });

  it('returns empty records + warning when auth.mfa_factors does not exist', async () => {
    const pg = fakeClientWithRows((() => {
      throw new Error('relation "auth.mfa_factors" does not exist');
    }) as () => never);
    const result = await exportMfaFactors(pg);
    expect(result.records).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/skipped/i);
  });

  it('emits an extra warning when query returned rows but emitted nothing', async () => {
    const pg = fakeClientWithRows([
      { email: 'webauthn-only@example.com', factor_type: 'webauthn', secret: 'x', status: 'verified' },
    ]);
    const result = await exportMfaFactors(pg);
    expect(result.warnings.some((w) => /emitted 0/.test(w))).toBe(true);
  });
});
