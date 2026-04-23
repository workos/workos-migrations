# Auth0 user fixtures

Realistic `/api/v2/users` response shapes for each Auth0 connection type. Sourced from Auth0's documented attribute set and validated against their [user profile schema](https://auth0.com/docs/manage-users/user-accounts/user-profiles/user-profile-structure). These drive the transform test suite in `tests/providers/auth0/user.test.ts`.

Each fixture models one concrete scenario; the test file asserts what `toWorkOSUserRow` should produce for each. Fixtures focus on the *shape differences* that affect the transform (which name / email / verification fields are present, multi-identity linking, edge cases around missing or synthetic values).

## Coverage

- `database.json` — Username-Password-Authentication (traditional email/password signup)
- `google-oauth2.json` — Google social login
- `github.json` — GitHub social login (demonstrates the "name = nickname = display name" pattern and `@users.noreply.github.com` emails)
- `facebook.json` — Facebook social login
- `linkedin.json` — LinkedIn social login
- `twitter.json` — Twitter social login (X)
- `saml.json` — Generic SAML enterprise connection
- `waad.json` — Azure AD / Entra ID enterprise connection
- `okta.json` — Okta enterprise connection
- `adfs.json` — ADFS enterprise connection
- `google-apps.json` — Google Workspace enterprise connection
- `passwordless-email.json` — Email-code passwordless (name=email pattern)
- `passwordless-sms.json` — SMS passwordless (no email, phone-only)
- `multi-identity-linked.json` — Primary account with a linked secondary identity
- `edge-missing-name.json` — Database user with only email set, no name fields
- `edge-only-name.json` — User with `name` only, no given/family (needs split)
- `edge-unicode-name.json` — Unicode names with diacritics
- `edge-multi-word-last-name.json` — Compound last name
- `edge-blocked.json` — Blocked user
- `edge-unverified-email.json` — User whose email is not yet verified
