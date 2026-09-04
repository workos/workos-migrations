# Migration Package Contract

The migration package is the provider-neutral handoff format for WorkOS migrations. Provider exporters can write the same directory shape whether the source is Auth0, Cognito, Clerk, Firebase, CSV, or a future provider.

The current single-file `users.csv` import flow remains supported. Package mode adds richer sidecar files for organizations, memberships, roles, TOTP factors, SSO handoff, warnings, skipped records, and raw provider debugging data.

## Layout

```text
migration-<provider>-<timestamp>/
  manifest.json
  users.csv
  organizations.csv
  organization_memberships.csv
  role_definitions.csv
  user_role_assignments.csv
  totp_secrets.csv
  warnings.jsonl
  skipped_users.jsonl
  raw/
    <provider-specific snapshots>
  sso/
    saml_connections.csv
    oidc_connections.csv
    custom_attribute_mappings.csv
    proxy_routes.csv
    handoff_notes.md
  workos_upload/
    users.csv
    organizations.csv
    organization_memberships.csv
```

`raw/` is reserved for provider-specific files and is not required by the base validator.

`workos_upload/` contains a narrow compatibility projection for WorkOS's existing user, organization, and membership upload templates. SSO connections live in `sso/` and are created by `import-package` through the WorkOS Connections API (`POST /connections`); the same files double as the handoff artifact when the API is not enabled for an environment.

## Manifest

`manifest.json` is the stable contract between exporters, validators, and future import-package orchestration.

```json
{
  "schemaVersion": 1,
  "provider": "auth0",
  "sourceTenant": "example.us.auth0.com",
  "generatedAt": "2026-04-29T00:00:00.000Z",
  "entitiesRequested": ["users", "organizations", "memberships", "roles", "sso"],
  "entitiesExported": {
    "users": 1234,
    "organizations": 42,
    "memberships": 1400,
    "roleDefinitions": 9,
    "userRoleAssignments": 600,
    "totpSecrets": 0,
    "samlConnections": 18,
    "oidcConnections": 2,
    "customAttributeMappings": 24,
    "proxyRoutes": 20,
    "uploadUsers": 1234,
    "uploadOrganizations": 42,
    "uploadMemberships": 1400,
    "warnings": 3,
    "skippedUsers": 12
  },
  "files": {
    "manifest": "manifest.json",
    "users": "users.csv",
    "organizations": "organizations.csv",
    "memberships": "organization_memberships.csv",
    "roleDefinitions": "role_definitions.csv",
    "userRoleAssignments": "user_role_assignments.csv",
    "totpSecrets": "totp_secrets.csv",
    "warnings": "warnings.jsonl",
    "skippedUsers": "skipped_users.jsonl",
    "samlConnections": "sso/saml_connections.csv",
    "oidcConnections": "sso/oidc_connections.csv",
    "customAttributeMappings": "sso/custom_attribute_mappings.csv",
    "proxyRoutes": "sso/proxy_routes.csv",
    "handoffNotes": "sso/handoff_notes.md",
    "uploadUsers": "workos_upload/users.csv",
    "uploadOrganizations": "workos_upload/organizations.csv",
    "uploadMemberships": "workos_upload/organization_memberships.csv"
  },
  "importability": {
    "users": "automatic",
    "organizations": "automatic",
    "memberships": "automatic",
    "roles": "automatic",
    "totpSecrets": "automatic",
    "ssoConnections": "automatic"
  },
  "secretsRedacted": true,
  "secretRedaction": {
    "mode": "redacted",
    "redacted": true,
    "redactedFields": ["client_secret"],
    "files": ["raw/auth0-connections.jsonl"]
  },
  "warnings": []
}
```

Known package file paths are canonical. The validator rejects package manifests that point a canonical file key at a different path.

## CSV Contracts

### Users

```csv
email,password,password_hash,password_hash_type,first_name,last_name,email_verified,external_id,metadata,org_id,org_external_id,org_name,role_slugs
```

This is compatible with the existing WorkOS users importer. Exporters can use row-level organization columns for current importer compatibility and still write richer organization and membership sidecars.

### Organizations

```csv
org_id,org_external_id,org_name,domains,metadata
```

`org_id` is a WorkOS organization ID when already known. `org_external_id` is the source provider's stable organization identifier unless a customer-supplied mapping overrides it.

### Organization Memberships

```csv
email,external_id,user_id,org_id,org_external_id,org_name,role_slugs,metadata
```

At least one user identifier and one organization identifier should be present per row.

### Role Definitions

```csv
role_slug,role_name,role_type,permissions,org_id,org_external_id
```

This matches the current `process-role-definitions` command. `role_type` is `environment` or `organization`.

Auth0 roles are tenant-wide, so the Auth0 exporter writes them as `environment` roles. Permissions
are left blank because the Auth0 catalog API does not return permission lists in a single call;
operators can populate them by running `process-role-definitions` against an enriched copy.

Slugs are kebab-cased from the Auth0 role name. When two roles produce the same slug, the second
gets a numeric suffix (`admin-role`, `admin-role-2`, ...) and a `duplicate_role_slug` warning is
written to `warnings.jsonl`. Roles with empty or unmappable names get a synthesized
`auth0-role-<id>` slug and an `unmappable_role_name` warning so operators can rename them later.

### User Role Assignments

```csv
email,user_id,external_id,role_slug,org_id,org_external_id
```

This is the package-level mapping for assigning roles to user organization memberships.

The Auth0 exporter populates one row per (user, org, role) tuple, deduplicated by slug per user.
The same slug list is written into the `role_slugs` column on the matching `users.csv` and
`organization_memberships.csv` rows so importers that only consume those columns still receive the
mapping.

### TOTP Secrets

```csv
email,totp_secret,totp_issuer,totp_user
```

This matches the existing TOTP enrollment parser.

### SAML Connections

```csv
name,organizationName,organizationId,organizationExternalId,domains,idpEntityId,idpUrl,x509Cert,idpMetadataUrl,customEntityId,customAcsUrl,idpIdAttribute,emailAttribute,firstNameAttribute,lastNameAttribute,nameAttribute,idpInitiatedEnabled,requestSigningKey,requestSigningCert,assertionEncryptionKey,assertionEncryptionCert,nameIdEncryptionKey,externalId,connectionType
```

`import-package` maps each row onto a `POST /connections` call:

| Column                                                                                             | Connections API                                                                                                |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `organizationId` / `organizationExternalId`                                                        | `organization_id` (resolved, or created from `organizationName` + `organizationExternalId`)                    |
| `domains`                                                                                          | Added to the organization (verified by default, `--sso-domains pending|skip` to change; `,`/`;` separated)     |
| `name`                                                                                             | `name` (falls back to `organizationName`, then `externalId`)                                                   |
| `externalId`                                                                                       | `external_id` — required; creation is idempotent on it and rows without one (or duplicates) are skipped        |
| `connectionType`                                                                                   | `connection_type` (e.g. `OktaSAML`); blank lets WorkOS infer `GenericSAML`                                     |
| `idpMetadataUrl`                                                                                   | `saml_options.idp_metadata_url` (preferred; manual IdP columns are ignored when set)                           |
| `idpEntityId` / `idpUrl` / `x509Cert`                                                              | `saml_options.idp_entity_id` / `idp_sso_url` / `idp_signing_certs[]` (PEM or bare base64 accepted)             |
| `customAcsUrl` / `customEntityId`                                                                  | `saml_options.acs_url` / `sp_entity_id` (legacy overrides so customer IdPs need no changes)                     |
| `requestSigningKey` + `requestSigningCert`                                                         | `saml_options.sp_signing_key_pair` (both required; otherwise WorkOS generates the SP signing key pair)         |
| `assertionEncryptionKey` + `assertionEncryptionCert`                                               | `saml_options.sp_encryption_key_pairs[]` (both required; otherwise WorkOS generates the encryption key pair)   |
| `idpIdAttribute` / `emailAttribute` / `firstNameAttribute` / `lastNameAttribute` / `nameAttribute` | `attribute_maps.standard_attributes`                                                                           |
| `nameIdEncryptionKey`, `idpInitiatedEnabled`                                                       | No API field yet — surfaced as warnings; configure in the WorkOS dashboard after import                        |

`requestSigningCert`, `assertionEncryptionCert`, and `connectionType` were added after the schema-1 contract shipped. Packages written without them still validate, and readers treat the missing columns as empty.

### OIDC Connections

```csv
name,organizationName,organizationId,organizationExternalId,domains,clientId,clientSecret,discoveryEndpoint,customRedirectUri,externalId,connectionType
```

`clientId`, `clientSecret`, `discoveryEndpoint`, and `customRedirectUri` map to `oidc_options.client_id` / `client_secret` / `discovery_endpoint` / `redirect_uri`. `connectionType` maps to `connection_type` (blank infers `GenericOIDC`).

OIDC `clientSecret` should be omitted unless the exporter has an explicit include-secrets option. When secrets are omitted, write a warning and record secret redaction metadata in the manifest. The Connections API requires a client secret, so `import-package` skips OIDC rows without one unless the secret is supplied through `--sso-secrets <file>` (JSON `{ "<externalId>": "<secret>" }`, a JSON array of `{ externalId, clientSecret }`, or a CSV with `externalId,clientSecret` columns).

### Custom Attribute Mappings

```csv
externalId,organizationExternalId,providerType,userPoolAttribute,idpClaim
```

This keeps the current Cognito-compatible shape until all provider exporters move to the package contract. `import-package` groups rows by `externalId` and sends them as `attribute_maps.custom_attributes` (`userPoolAttribute` → WorkOS custom attribute name, `idpClaim` → IdP attribute). Custom attributes must already exist in the WorkOS dashboard; `import-package` lists the referenced names up front and lets the operator include them, skip them, or abort to create them first.

### Proxy Routes

```csv
externalId,organizationExternalId,provider,protocol,sourceAcsUrl,sourceEntityId,sourceRedirectUri,customAcsUrl,customEntityId,customRedirectUri,workosConnectionId,workosAcsUrl,cutoverState,notes
```

`cutoverState` values are `legacy`, `workos`, or `manual`.

After a live `import-package` run, `workosConnectionId` and `workosAcsUrl` are filled in from the created connections (`workosAcsUrl` is the connection's immutable `callback_endpoint`, protocol-agnostic), so a callback proxy can be configured directly from this file. Full per-connection results, including skips and failures, are written to `workos_sso_connections.csv` in the package root.

## WorkOS Upload Compatibility

Package exporters should also write upload-compatible files for the existing WorkOS upload flow:

```text
workos_upload/users.csv
workos_upload/organizations.csv
workos_upload/organization_memberships.csv
```

These files intentionally omit provider metadata and package-only fields. They must use the existing upload headers:

```csv
user_id,email,email_verified,first_name,last_name,password_hash
organization_id,name
organization_id,user_id
```

`user_id` should be the same stable source identifier used as package `external_id`. `organization_id` should be the same source organization identifier used as package `org_external_id`.

Providers should only write membership rows when the source provider exposes a reliable user-to-organization relationship or the customer supplied an explicit mapping. If a provider cannot infer organizations or memberships, it should write header-only compatibility files and add a warning instead of inventing relationships.

Roles are not represented in `workos_upload/` because the current upload templates cover only users, organizations, and memberships.

## JSONL Files

`warnings.jsonl` contains exporter warnings, one JSON object per line. `skipped_users.jsonl` contains skipped source users, one JSON object per line. Both files can be empty.

## Validation

The base validator checks:

- `manifest.json` schema version and required fields.
- Canonical package file paths.
- Required files referenced by the manifest.
- Exact CSV headers for canonical CSV files.
- JSONL parseability.
- Manifest count consistency against CSV and JSONL record counts.

Provider-specific validators should layer on source-specific rules such as required scopes, source connection option completeness, and source-specific password limitations.
