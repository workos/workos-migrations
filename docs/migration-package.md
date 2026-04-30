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
```

`raw/` is reserved for provider-specific files and is not required by the base validator.

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
    "handoffNotes": "sso/handoff_notes.md"
  },
  "importability": {
    "users": "automatic",
    "organizations": "automatic",
    "memberships": "automatic",
    "roles": "automatic",
    "totpSecrets": "automatic",
    "ssoConnections": "handoff"
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

### User Role Assignments

```csv
email,user_id,external_id,role_slug,org_id,org_external_id
```

This is the package-level mapping for assigning roles to user organization memberships.

### TOTP Secrets

```csv
email,totp_secret,totp_issuer,totp_user
```

This matches the existing TOTP enrollment parser.

### SAML Connections

```csv
organizationName,organizationId,organizationExternalId,domains,idpEntityId,idpUrl,x509Cert,idpMetadataUrl,customEntityId,customAcsUrl,idpIdAttribute,emailAttribute,firstNameAttribute,lastNameAttribute,name,customAttributes,idpInitiatedEnabled,requestSigningKey,assertionEncryptionKey,nameIdEncryptionKey,importedId
```

SSO connections are handoff-only. The package should not attempt to create WorkOS SSO connections automatically.

### OIDC Connections

```csv
organizationName,organizationId,organizationExternalId,domains,clientId,clientSecret,discoveryEndpoint,customRedirectUri,name,customAttributes,importedId
```

OIDC `clientSecret` should be omitted unless the exporter has an explicit include-secrets option. When secrets are omitted, write a warning and record secret redaction metadata in the manifest.

### Custom Attribute Mappings

```csv
importedId,organizationExternalId,providerType,userPoolAttribute,idpClaim
```

This keeps the current Cognito-compatible shape until all provider exporters move to the package contract.

### Proxy Routes

```csv
importedId,organizationExternalId,provider,protocol,sourceAcsUrl,sourceEntityId,sourceRedirectUri,customAcsUrl,customEntityId,customRedirectUri,workosConnectionId,workosAcsUrl,cutoverState,notes
```

`cutoverState` values are `legacy`, `workos`, or `manual`.

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
