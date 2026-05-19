import { mapSupabaseUser } from '../user-mapper.js';
import type { SupabaseAdminUser } from '../types.js';

function baseUser(overrides: Partial<SupabaseAdminUser> = {}): SupabaseAdminUser {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'user@example.com',
    email_confirmed_at: '2025-01-15T10:30:00.000Z',
    created_at: '2025-01-15T10:00:00.000Z',
    user_metadata: {},
    app_metadata: {},
    identities: [],
    ...overrides,
  };
}

describe('mapSupabaseUser', () => {
  it('skips users with no email', () => {
    const result = mapSupabaseUser(baseUser({ email: undefined }));
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('Missing email address');
  });

  it('skips users with empty-string email', () => {
    const result = mapSupabaseUser(baseUser({ email: '   ' }));
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('Missing email address');
  });

  it('skips users banned in the future', () => {
    const result = mapSupabaseUser(baseUser({ banned_until: '2099-01-01T00:00:00.000Z' }));
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('Banned user');
  });

  it('does not skip users whose ban has expired', () => {
    const result = mapSupabaseUser(baseUser({ banned_until: '2000-01-01T00:00:00.000Z' }));
    expect(result.skipped).toBe(false);
  });

  it("treats banned_until = 'infinity' as banned forever", () => {
    const result = mapSupabaseUser(baseUser({ banned_until: 'infinity' }));
    expect(result.skipped).toBe(true);
  });

  it('uses first_name / last_name from user_metadata when present', () => {
    const result = mapSupabaseUser(
      baseUser({ user_metadata: { first_name: 'Alice', last_name: 'Anderson' } }),
    );
    expect(result.csvRow.first_name).toBe('Alice');
    expect(result.csvRow.last_name).toBe('Anderson');
  });

  it("splits full_name with the 'first-space' strategy when explicit names are absent", () => {
    const result = mapSupabaseUser(
      baseUser({ user_metadata: { full_name: 'Bob Junior Builder' } }),
    );
    expect(result.csvRow.first_name).toBe('Bob');
    expect(result.csvRow.last_name).toBe('Junior Builder');
  });

  it('falls back to user_metadata.name when full_name is missing', () => {
    const result = mapSupabaseUser(baseUser({ user_metadata: { name: 'Charlie Chaplin' } }));
    expect(result.csvRow.first_name).toBe('Charlie');
    expect(result.csvRow.last_name).toBe('Chaplin');
  });

  it('sets email_verified=true only when email_confirmed_at is non-null', () => {
    const verified = mapSupabaseUser(baseUser({ email_confirmed_at: '2025-01-01T00:00:00Z' }));
    expect(verified.csvRow.email_verified).toBe('true');

    const unverified = mapSupabaseUser(baseUser({ email_confirmed_at: null }));
    expect(unverified.csvRow.email_verified).toBe('false');
  });

  it('writes the Supabase user.id as external_id', () => {
    const result = mapSupabaseUser(baseUser());
    expect(result.csvRow.external_id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('records all linked identities in metadata.supabase_identities', () => {
    const result = mapSupabaseUser(
      baseUser({
        identities: [
          { provider: 'google', provider_id: 'g-1', identity_data: { sub: 'g-1' } },
          { provider: 'github', provider_id: 'gh-2' },
          { provider: 'email', provider_id: 'user@example.com' },
        ],
      }),
    );

    const metadata = JSON.parse(result.csvRow.metadata as string);
    expect(metadata.supabase_identities).toHaveLength(3);
    expect(metadata.supabase_identities[0].provider).toBe('google');
    expect(metadata.supabase_identities[0].identity_data).toEqual({ sub: 'g-1' });
    expect(metadata.supabase_identities[1].provider).toBe('github');
    expect(metadata.supabase_identities[2].provider).toBe('email');
    expect(metadata.supabase_uid).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('includes app_metadata in user metadata when non-empty', () => {
    const result = mapSupabaseUser(
      baseUser({ app_metadata: { provider: 'google', providers: ['google', 'github'] } }),
    );
    const metadata = JSON.parse(result.csvRow.metadata as string);
    expect(metadata.app_metadata.provider).toBe('google');
  });

  it('omits supabase_identities when there are no identities', () => {
    const result = mapSupabaseUser(baseUser({ identities: [] }));
    const metadata = JSON.parse(result.csvRow.metadata as string);
    expect(metadata.supabase_identities).toBeUndefined();
  });
});
