import type { Provider } from '../../shared/types.js';

export const supabaseProvider: Provider = {
  name: 'supabase',
  displayName: 'Supabase Auth',
  credentials: [
    {
      key: 'url',
      name: 'Supabase project URL (https://xxxx.supabase.co)',
      type: 'input',
      required: true,
      envVar: 'SUPABASE_URL',
    },
    {
      key: 'serviceRoleKey',
      name: 'Service Role Key (JWT)',
      type: 'password',
      required: true,
      envVar: 'SUPABASE_SERVICE_ROLE_KEY',
    },
    {
      key: 'dbUrl',
      name: 'Postgres connection string (optional — needed for passwords/MFA/SSO/orgs)',
      type: 'password',
      required: false,
      envVar: 'SUPABASE_DB_URL',
    },
  ],
  entities: [
    {
      key: 'users',
      name: 'Users',
      description: 'auth.users via Admin API',
      enabled: true,
    },
    {
      key: 'identities',
      name: 'OAuth identities',
      description: 'Linked OAuth providers (stored as user metadata)',
      enabled: true,
    },
    {
      key: 'mfa',
      name: 'MFA TOTP factors',
      description: 'Requires Postgres connection',
      enabled: false,
    },
    {
      key: 'sso',
      name: 'SAML SSO connections',
      description: 'Requires Postgres connection',
      enabled: false,
    },
    {
      key: 'organizations',
      name: 'Organizations',
      description: 'From user-supplied org table — requires Postgres connection',
      enabled: false,
    },
  ],
};
