# Cognito user fixtures

Representative `ListUsers` / `AdminGetUser` response shapes for each kind of Cognito user. Drives the test suite in `tests/providers/cognito/workos-csv.test.ts`.

Each fixture is a `CognitoUser` as stored on our side — `userPoolId`, `username`, a flattened `attributes` dict, plus the `UserStatus` / `Enabled` flags. This matches what `client.ts` produces from raw `UserType` after mapping `Attributes[]` into a key/value dict.

## Coverage

- `native-database.json` — standard username/password user (all attributes set)
- `saml-federated-full.json` — SAML-federated user with given_name + family_name + custom attrs
- `saml-federated-name-only.json` — SAML-federated user with only `name` attribute set (EveryoneSocial pattern)
- `saml-federated-with-customs.json` — SAML-federated user with all 5 `custom:*` attributes populated
- `oidc-federated.json` — OIDC-federated user (e.g. Azure AD sign-in)
- `social-google.json` — Google social login through Cognito
- `social-facebook.json` — Facebook social login
- `edge-missing-email.json` — user with no email attribute (rare, e.g. phone-only auth)
- `edge-missing-sub.json` — user with no sub attribute (shouldn't happen but defensive)
- `edge-name-only-no-given.json` — user with only `name` attribute (needs splitting)
- `edge-unicode.json` — unicode names with diacritics
- `edge-multi-word-last-name.json` — compound last name, name-split edge case
