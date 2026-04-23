/**
 * Auth0 user → WorkOS users.csv transform.
 *
 * Exercises every connection type in `tests/fixtures/auth0/users/` with the
 * exact expected output, plus the provider-prefix breakdown helper.
 */
import fs from 'fs';
import path from 'path';
import {
  toWorkOSUserRow,
  summarizeAuth0Users,
  providerPrefix,
} from '../../../src/providers/auth0/user';
import type { Auth0User } from '../../../src/providers/auth0/client';
import { USER_HEADERS } from '../../../src/shared/csv';

const FIXTURES = path.join(__dirname, '../../fixtures/auth0/users');

function load(name: string): Auth0User {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8')) as Auth0User;
}

describe('toWorkOSUserRow — output shape', () => {
  it('always returns every column in the USER_HEADERS schema', () => {
    const row = toWorkOSUserRow(load('database.json'));
    for (const header of USER_HEADERS) {
      expect(row).toHaveProperty(header);
    }
  });

  it('never populates password_hash', () => {
    const fixtures = fs
      .readdirSync(FIXTURES)
      .filter((f) => f.endsWith('.json'));
    for (const name of fixtures) {
      const row = toWorkOSUserRow(load(name));
      expect(row.password_hash).toBe('');
    }
  });
});

describe('toWorkOSUserRow — per connection type', () => {
  describe('database (username/password)', () => {
    it('maps all standard fields cleanly', () => {
      expect(toWorkOSUserRow(load('database.json'))).toEqual({
        user_id: 'auth0|64abc123def4567890abcdef',
        email: 'alice@example.com',
        email_verified: 'true',
        first_name: 'Alice',
        last_name: 'Smith',
        password_hash: '',
      });
    });
  });

  describe('social: google-oauth2', () => {
    it('maps given/family name directly', () => {
      expect(toWorkOSUserRow(load('google-oauth2.json'))).toEqual({
        user_id: 'google-oauth2|109876543210123456789',
        email: 'bob@gmail.com',
        email_verified: 'true',
        first_name: 'Bob',
        last_name: 'Jones',
        password_hash: '',
      });
    });
  });

  describe('social: github', () => {
    it('does NOT split `name` when it equals the nickname (looks like no real name)', () => {
      // GitHub often sets both `name` and `nickname` to the username. Splitting
      // that on whitespace is fine when it's genuinely a multi-word name, but
      // here it's a single token so last_name stays empty.
      const row = toWorkOSUserRow(load('github.json'));
      expect(row).toMatchObject({
        user_id: 'github|12345678',
        email: 'carolcoder@users.noreply.github.com',
        email_verified: 'true',
        first_name: 'carolcoder',
        last_name: '',
      });
    });
  });

  describe('social: facebook', () => {
    it('maps the given/family pair', () => {
      expect(toWorkOSUserRow(load('facebook.json'))).toEqual({
        user_id: 'facebook|10163424000000',
        email: 'iris@example.com',
        email_verified: 'true',
        first_name: 'Iris',
        last_name: 'Johnson',
        password_hash: '',
      });
    });
  });

  describe('social: linkedin', () => {
    it('maps the given/family pair', () => {
      expect(toWorkOSUserRow(load('linkedin.json'))).toEqual({
        user_id: 'linkedin|ABCdef123XYZ',
        email: 'jack@example.com',
        email_verified: 'true',
        first_name: 'Jack',
        last_name: 'Brown',
        password_hash: '',
      });
    });
  });

  describe('social: twitter', () => {
    it('handles users with no email (Twitter does not expose email)', () => {
      const row = toWorkOSUserRow(load('twitter.json'));
      expect(row).toEqual({
        user_id: 'twitter|1234567890',
        email: '',
        email_verified: '',
        first_name: 'Leo',
        last_name: 'Rivera',
        password_hash: '',
      });
    });
  });

  describe('enterprise: samlp', () => {
    it('preserves the samlp|connection-name|id prefix structure', () => {
      expect(toWorkOSUserRow(load('saml.json'))).toEqual({
        user_id: 'samlp|acme-saml|eve@acme.com',
        email: 'eve@acme.com',
        email_verified: 'true',
        first_name: 'Eve',
        last_name: 'Parker',
        password_hash: '',
      });
    });
  });

  describe('enterprise: waad (Azure AD)', () => {
    it('maps Azure AD profile data', () => {
      expect(toWorkOSUserRow(load('waad.json'))).toEqual({
        user_id: 'waad|a74900dd-e48b-47b6-b212-306653d7f33d',
        email: 'dave@acme.com',
        email_verified: 'true',
        first_name: 'Dave',
        last_name: 'Wilson',
        password_hash: '',
      });
    });
  });

  describe('enterprise: okta', () => {
    it('preserves the okta|id prefix', () => {
      expect(toWorkOSUserRow(load('okta.json'))).toEqual({
        user_id: 'okta|00ue1234abcd5678',
        email: 'frank@acme.com',
        email_verified: 'true',
        first_name: 'Frank',
        last_name: 'Miller',
        password_hash: '',
      });
    });
  });

  describe('enterprise: adfs', () => {
    it('preserves the adfs|connection-name|id prefix', () => {
      expect(toWorkOSUserRow(load('adfs.json'))).toEqual({
        user_id: 'adfs|acme-adfs|hector@acme.com',
        email: 'hector@acme.com',
        email_verified: 'true',
        first_name: 'Hector',
        last_name: 'Kim',
        password_hash: '',
      });
    });
  });

  describe('enterprise: google-apps', () => {
    it('maps Google Workspace users correctly', () => {
      expect(toWorkOSUserRow(load('google-apps.json'))).toEqual({
        user_id: 'google-apps|grace@acme.com',
        email: 'grace@acme.com',
        email_verified: 'true',
        first_name: 'Grace',
        last_name: 'Zhao',
        password_hash: '',
      });
    });
  });

  describe('passwordless: email', () => {
    it('does NOT split `name` when it equals the email address', () => {
      // Passwordless-email users often have `name` = the email. Splitting
      // "henry@example.com" would give first_name = "henry@example.com",
      // last_name = "" — better to leave both blank.
      const row = toWorkOSUserRow(load('passwordless-email.json'));
      expect(row).toEqual({
        user_id: 'email|user_abc123def456',
        email: 'henry@example.com',
        email_verified: 'true',
        first_name: '',
        last_name: '',
        password_hash: '',
      });
    });
  });

  describe('passwordless: sms', () => {
    it('has no email and does not treat the phone number as a name', () => {
      const row = toWorkOSUserRow(load('passwordless-sms.json'));
      expect(row).toEqual({
        user_id: 'sms|user_sms_xyz789',
        email: '',
        email_verified: '',
        first_name: '',
        last_name: '',
        password_hash: '',
      });
    });
  });

  describe('multi-identity linked accounts', () => {
    it('uses the root user fields, ignoring linked identities for CSV shape', () => {
      const row = toWorkOSUserRow(load('multi-identity-linked.json'));
      expect(row).toEqual({
        user_id: 'auth0|primary_karen_id',
        email: 'karen@example.com',
        email_verified: 'true',
        first_name: 'Karen',
        last_name: 'Kim',
        password_hash: '',
      });
    });
  });
});

describe('toWorkOSUserRow — edge cases', () => {
  it('leaves first/last blank when the user has no name at all', () => {
    const row = toWorkOSUserRow(load('edge-missing-name.json'));
    expect(row.first_name).toBe('');
    expect(row.last_name).toBe('');
    expect(row.email_verified).toBe('false');
  });

  it('splits `name` when given/family are absent but `name` is a real name', () => {
    const row = toWorkOSUserRow(load('edge-only-name.json'));
    expect(row.first_name).toBe('Maya');
    expect(row.last_name).toBe('Patel');
  });

  it('preserves unicode + multi-token last names from given/family', () => {
    const row = toWorkOSUserRow(load('edge-unicode-name.json'));
    expect(row.first_name).toBe('María');
    expect(row.last_name).toBe('García López');
  });

  it('splits multi-word-last-name into first + rest when only `name` is set', () => {
    const row = toWorkOSUserRow(load('edge-multi-word-last-name.json'));
    expect(row.first_name).toBe('Mary');
    expect(row.last_name).toBe('Ann Jones Smith');
  });

  it('exports blocked users unchanged (block status is not in the users.csv template)', () => {
    const row = toWorkOSUserRow(load('edge-blocked.json'));
    expect(row.user_id).toBe('auth0|blocked_user');
    expect(row.email).toBe('blocked@example.com');
    // block status is metadata; the row itself looks identical to a normal user
  });

  it('serializes email_verified=false correctly', () => {
    const row = toWorkOSUserRow(load('edge-unverified-email.json'));
    expect(row.email_verified).toBe('false');
    expect(row.email).toBe('unverified@example.com');
  });
});

describe('toWorkOSUserRow — defensive handling', () => {
  it('treats non-string user_id as empty', () => {
    // Auth0 never returns a number here, but be defensive.
    const row = toWorkOSUserRow({ user_id: 123 as unknown as string } as Auth0User);
    expect(row.user_id).toBe('');
  });

  it('treats non-boolean email_verified as empty', () => {
    const row = toWorkOSUserRow({
      user_id: 'x',
      email: 'x@y.com',
      email_verified: undefined,
    } as unknown as Auth0User);
    expect(row.email_verified).toBe('');
  });

  it('accepts string email_verified (some older Auth0 tenants return strings)', () => {
    const row = toWorkOSUserRow({
      user_id: 'x',
      email: 'x@y.com',
      email_verified: 'true' as unknown as boolean,
    } as unknown as Auth0User);
    expect(row.email_verified).toBe('true');
  });
});

describe('providerPrefix', () => {
  it.each([
    ['auth0|abc', 'auth0'],
    ['google-oauth2|109', 'google-oauth2'],
    ['samlp|acme-saml|user@acme.com', 'samlp'],
    ['email|user_1', 'email'],
    ['sms|user_2', 'sms'],
    ['', 'unknown'],
    ['no-pipe', 'unknown'],
    [undefined, 'unknown'],
    [null, 'unknown'],
  ])('%p → %p', (input, expected) => {
    expect(providerPrefix(input)).toBe(expected);
  });
});

describe('summarizeAuth0Users', () => {
  it('counts users by provider prefix', () => {
    const users = [
      load('database.json'),
      load('google-oauth2.json'),
      load('github.json'),
      load('saml.json'),
      load('passwordless-email.json'),
    ];
    const rows = users.map(toWorkOSUserRow);
    const summary = summarizeAuth0Users(users, rows);
    expect(summary.total).toBe(5);
    expect(summary.byProvider).toEqual({
      auth0: 1,
      'google-oauth2': 1,
      github: 1,
      samlp: 1,
      email: 1,
    });
  });

  it('counts users missing an email', () => {
    const users = [
      load('database.json'),
      load('passwordless-sms.json'),
      load('twitter.json'),
    ];
    const rows = users.map(toWorkOSUserRow);
    const summary = summarizeAuth0Users(users, rows);
    expect(summary.missingEmail).toBe(2); // sms + twitter
  });

  it('counts users missing a display name', () => {
    const users = [
      load('database.json'),
      load('edge-missing-name.json'),
      load('passwordless-sms.json'),
      load('passwordless-email.json'),
    ];
    const rows = users.map(toWorkOSUserRow);
    const summary = summarizeAuth0Users(users, rows);
    // edge-missing-name + passwordless-sms + passwordless-email all have no first/last
    expect(summary.missingName).toBe(3);
  });
});
