# WorkOS Migrations

A CLI tool for migrating from identity providers into WorkOS. Supports Auth0, AWS Cognito, Clerk, Firebase Auth, and custom CSV — moving users, organizations, memberships, roles + permissions, password hashes, and TOTP MFA factors, with SAML/OIDC SSO connections surfaced as handoff artifacts.

## Quick Start

The fastest way to get started is with the interactive wizard:

```bash
export WORKOS_SECRET_KEY=sk_...

npx @workos/migrations wizard
```

The wizard walks you through provider selection, export/transform, validation, and import step by step.

## Installation

Run directly with `npx` (no install needed):

```bash
npx @workos/migrations <command>
```

Or via the [WorkOS CLI](https://github.com/workos/cli):

```bash
npx workos migrations <command>
```

Or install globally:

```bash
npm install -g @workos/migrations
workos-migrate <command>
```

## Commands

| Command                     | Description                                                                   |
| --------------------------- | ----------------------------------------------------------------------------- |
| `export <provider>`         | **Unified export** — write a migration package from any source (see below)    |
| `wizard`                    | Interactive step-by-step migration wizard                                     |
| `export-auth0`              | _Deprecated alias for `export auth0` (removed in v4.0)_                       |
| `export-cognito`            | _Deprecated alias for `export cognito` (removed in v4.0)_                     |
| `export-template`           | Export a blank CSV template (users, saml_connections, oidc_connections, etc.) |
| `merge-passwords`           | Merge Auth0 password hashes into the export CSV                               |
| `transform-clerk`           | _Deprecated alias for `export clerk` (removed in v4.0)_                       |
| `transform-firebase`        | _Deprecated alias for `export firebase` (removed in v4.0)_                    |
| `validate`                  | Validate a CSV file before import                                             |
| `import`                    | Import users from CSV into WorkOS                                             |
| `import-package`            | Import a migration package directory into WorkOS                              |
| `generate-package-template` | Generate an empty migration package skeleton                                  |
| `validate-package`          | Validate a migration package against the contract                             |
| `analyze`                   | Analyze import errors and generate retry CSV                                  |
| `enroll-totp`               | Enroll TOTP MFA factors for imported users                                    |
| `process-role-definitions`  | Create roles and assign permissions in WorkOS                                 |

Run `npx @workos/migrations <command> --help` for full option details on any command.

## Exporting (unified command)

Every source is exported through one verb that always writes a [migration package](docs/migration-package.md):

```bash
workos-migrate export <provider> --output-dir <dir> [provider options]
```

| Provider   | Ingest | Example                                                                      |
| ---------- | ------ | ---------------------------------------------------------------------------- |
| `auth0`    | API    | `export auth0 --domain … --client-id … --client-secret … --output-dir ./pkg` |
| `cognito`  | API    | `export cognito --region … --user-pool-ids … --output-dir ./pkg`             |
| `clerk`    | file   | `export clerk --from-file clerk.csv --output-dir ./pkg`                      |
| `firebase` | file   | `export firebase --from-file firebase.json --output-dir ./pkg`               |
| `csv`      | file   | `export csv --output-dir ./pkg` (writes a fillable skeleton)                 |

Credentials and options are generated per provider — run `workos-migrate export <provider> --help` to see them. SSO handoff (SAML/OIDC) is opt-in where supported: pass `--secret-key` for Clerk, or `--service-account-key` + `--project-id` for Firebase.

The legacy `export-auth0`, `export-cognito`, `transform-clerk`, and `transform-firebase` commands still work but print a deprecation notice and will be removed in v4.0.

### End-to-end: generate and import a package

Every migration is the same four steps — generate the package, validate it, optionally merge password hashes, then import:

```bash
# 1. Generate a migration package FROM your source provider
workos-migrate export auth0 \
  --domain my-tenant.us.auth0.com \
  --client-id <M2M_CLIENT_ID> \
  --client-secret <M2M_CLIENT_SECRET> \
  --output-dir ./migration

# 2. Validate it against the package contract
workos-migrate validate-package ./migration

# 3. (Auth0 only) Merge the password-hash export from Auth0 support
workos-migrate merge-passwords --package ./migration --passwords auth0-passwords.ndjson

# 4. Import users, organizations, memberships, roles, and TOTP factors into WorkOS
#    (add --plan or --dry-run first to preview)
export WORKOS_SECRET_KEY=sk_...
workos-migrate import-package ./migration
```

The package itself is a provider-neutral directory (`users.csv`, `organizations.csv`, `organization_memberships.csv`, `role_definitions.csv`, `user_role_assignments.csv`, `totp_secrets.csv`, `sso/` handoff CSVs, `workos_upload/`, and `manifest.json`) — see [`docs/migration-package.md`](docs/migration-package.md) for the full contract. Swap `export auth0` for `export cognito`, `export clerk --from-file …`, `export firebase --from-file …`, or `export csv` to generate from a different source; steps 2–4 are identical.

The per-provider guides below cover provider-specific credential setup and options.

## Prerequisites

- Node.js 22.11+
- A WorkOS Secret Key (`WORKOS_SECRET_KEY` environment variable)

## CSV Format

The import CSV uses these columns:

| Column               | Required | Description                                         |
| -------------------- | -------- | --------------------------------------------------- |
| `email`              | Yes      | User email address                                  |
| `first_name`         | No       | First name                                          |
| `last_name`          | No       | Last name                                           |
| `email_verified`     | No       | `true` or `false`                                   |
| `password_hash`      | No       | Password hash value                                 |
| `password_hash_type` | No       | `bcrypt`, `firebase-scrypt`, `ssha`, `md5`          |
| `external_id`        | No       | External identifier from source system              |
| `metadata`           | No       | JSON string of custom metadata                      |
| `org_id`             | No       | WorkOS organization ID                              |
| `org_external_id`    | No       | External org identifier (looked up or auto-created) |
| `org_name`           | No       | Organization name (used with auto-creation)         |
| `role_slugs`         | No       | Comma-separated role slugs for org membership       |

The export and transform commands produce CSVs in this format automatically.

---

## Migrating from Auth0

Auth0 is a parity-complete migration source. The end-to-end flow is:

1. Run `export auth0` to produce a [migration package](docs/migration-package.md) with users, organizations, memberships, roles, SSO handoff files, warnings, and the upload-compatible projection. For very large tenants, `--engine bulk-job` is available; see step 3b.
2. Optionally run `merge-passwords --package <dir>` to merge the Auth0 password export into the package. Unsupported hash algorithms are skipped with warnings instead of failing the merge.
3. Run `import-package <dir>` to push organizations, users, memberships, roles, and TOTP factors into WorkOS in one shot. SSO connections are surfaced as **handoff-only**; see [`docs/auth0-sso-handoff.md`](docs/auth0-sso-handoff.md).

### 1. Set up Auth0 credentials

Create a Machine-to-Machine application in Auth0, authorize it for the Management API, and grant these scopes:

- `read:users`
- `read:user_idp_tokens`
- `read:organizations`
- `read:organization_members`
- `read:organization_member_roles`
- `read:roles`
- `read:connections`
- `read:connections_options`

`read:connections_options` is required for complete SAML/OIDC handoff exports because Auth0 stores
connection configuration inside the `options` object. If this scope is missing, later package phases
will warn and omit fields that cannot be read.

### 2. Export

```bash
workos-migrate export auth0 \
  --domain my-tenant.us.auth0.com \
  --client-id <M2M_CLIENT_ID> \
  --client-secret <M2M_CLIENT_SECRET> \
  --output-dir ./migration-auth0
```

This writes the full migration package: `users.csv`, `organizations.csv`,
`organization_memberships.csv`, warnings, and skipped-user sidecars, plus the
`workos_upload/` projection (narrower WorkOS upload templates) and any `sso/` handoff
artifacts.

To include the Auth0 role catalog and per-org role assignments alongside users, organizations, and
memberships:

```bash
workos-migrate export auth0 \
  --domain my-tenant.us.auth0.com \
  --client-id <M2M_CLIENT_ID> \
  --client-secret <M2M_CLIENT_SECRET> \
  --entities users,organizations,memberships,roles \
  --output-dir ./migration-auth0
```

This writes `role_definitions.csv` and `user_role_assignments.csv` and merges the matched
`role_slugs` into `users.csv` and `organization_memberships.csv`. The
[`process-role-definitions`](#post-import-totp-and-roles) command can then create the roles in
WorkOS and assign them to memberships. Note that the `--use-metadata` flow cannot fetch per-org
assignments from Auth0, so it writes the role catalog only and emits a warning.

To write only SSO handoff files:

```bash
workos-migrate export auth0 \
  --domain my-tenant.us.auth0.com \
  --client-id <M2M_CLIENT_ID> \
  --client-secret <M2M_CLIENT_SECRET> \
  --entities sso \
  --output-dir ./migration-auth0-sso
```

Options:

- `--orgs <ids...>` - Filter to specific Auth0 organization IDs
- `--entities <entities>` - Comma-separated package entities to export (`users,organizations,memberships,roles,sso`)
- `--rate-limit <n>` - API requests per second (default: 50)
- `--use-metadata` - Use metadata for org discovery instead of the Organizations API. By default only the admin-controlled `app_metadata` section is trusted (see security note below)
- `--allow-user-metadata-org` - **Insecure.** Also consult the end-user-writable `user_metadata` section for org discovery. Only enable this if you fully trust the contents of `user_metadata`; otherwise a source-tenant end user can plant a victim organization's identifier and be imported as a member of it
- `--include-federated-users` - Include federated/JIT users in package mode (skipped by default)
- `--include-secrets` - Include SSO connection secrets in package handoff files (redacted by default)
- `--job-id <id>` - Enable export checkpointing for large tenants
- `--resume [jobId]` - Resume a previously checkpointed export

> **Security note on `--use-metadata`:** organization membership is an authorization grant, so org discovery is sourced only from the admin-controlled `app_metadata` section by default. The `user_metadata` section is writable by end users (Auth0 public signup and self-service profile updates) and is ignored unless you pass `--allow-user-metadata-org`. If your tenant legitimately stores org identifiers in `user_metadata`, add that flag; be aware it lets any end user route themselves into an organization by editing their own metadata before export. Users with no org identifier in the trusted section(s) are skipped with reason `no_org_in_metadata`.

The export maps Auth0 fields to WorkOS CSV format, including `email_verified`, `external_id`, and custom metadata.
Auth0 package SSO export is handoff-only: it inspects Auth0 enterprise strategies for SAML/OIDC configuration and emits only connections with enough reliable handoff data. Database, passwordless, social, generic OAuth, non-SAML/OIDC enterprise, and incomplete connections are skipped with warnings.

For a callback proxy reference implementation during Auth0 enterprise-connection cutover, see [`proxy-sample-auth0`](proxy-sample-auth0/README.md). The repo also includes [`proxy-sample-cognito`](proxy-sample-cognito/README.md) for Cognito migrations.

### 3. Merge password hashes (optional)

Auth0 does not include password hashes in the Management API export. You need to request a password export from Auth0 support, which provides an NDJSON file. Once you have it, the CLI supports both legacy single-CSV merging and package-aware merging:

```bash
# Single CSV (legacy)
workos-migrate merge-passwords \
  --csv auth0-export.csv \
  --passwords auth0-passwords.ndjson \
  --output auth0-with-passwords.csv

# Migration package — updates users.csv, workos_upload/users.csv, and the manifest
workos-migrate merge-passwords \
  --package ./migration-auth0 \
  --passwords auth0-passwords.ndjson
```

Package mode warns and omits credentials for users whose hash algorithm is not supported by WorkOS imports (anything other than `bcrypt` or `md5`). Users without a matching hash are left without a password and will need to reset on first login.

### 3b. Bulk export engine for very large tenants

For tenants where the Management API per-user fetch is too slow, package mode can use Auth0's `users-exports` job engine instead. This engine returns users without organization membership, so you'll typically run it alongside a Management API run that captured org/membership data, or follow up with a CSV-driven membership reconciliation.

```bash
workos-migrate export auth0 \
  --domain my-tenant.us.auth0.com \
  --client-id <M2M_CLIENT_ID> \
  --client-secret <M2M_CLIENT_SECRET> \
  --engine bulk-job \
  --output-dir ./migration-auth0-bulk
```

A `bulk_export_no_org_membership` warning is recorded in the package and bulk mode does not populate `organizations.csv`, `organization_memberships.csv`, or per-org role assignments.

### 4. Validate, import, and post-import

Continue to [Validation](#validation), [Import](#importing-users), and [Post-Import](#post-import-totp-and-roles) below.

---

## Migrating from Clerk

### 1. Export from Clerk

Export your users from the Clerk Dashboard as a CSV file. The export includes columns like `id`, `first_name`, `last_name`, `primary_email_address`, `password_digest`, `password_hasher`, etc.

### 2. Export to a migration package

```bash
workos-migrate export clerk \
  --from-file clerk-export.csv \
  --output-dir ./migration-clerk \
  --org-mapping orgs.csv \
  --role-mapping roles.csv
```

This writes the canonical layout (`users.csv`, `organizations.csv`,
`organization_memberships.csv`, `role_definitions.csv`, `user_role_assignments.csv`,
`workos_upload/`, manifest, warnings, skipped users) so the result can be fed
straight into `import-package`. Unsupported password hashers are recorded as
warnings instead of failing the export.

To also pull Clerk enterprise SAML/OIDC connections into the `sso/` handoff CSVs, pass
your Clerk Backend API key with `--secret-key <sk_…>` (or set `CLERK_SECRET_KEY`).

Options:

- `--from-file <path>` - Path to the Clerk dashboard CSV export (required)
- `--org-mapping <path>` - CSV mapping Clerk user IDs to organizations (`clerk_user_id,org_external_id,org_name`)
- `--role-mapping <path>` - CSV mapping Clerk user IDs to roles (`clerk_user_id,role_slug`)
- `--secret-key <key>` - Clerk Backend API key; enables enterprise SSO connection export
- `--source-tenant <name>` - Optional tenant identifier recorded in the manifest.

The transformer handles:

- Field mapping (Clerk columns to WorkOS columns)
- bcrypt password passthrough (other hash types like argon2 are dropped with a warning since WorkOS does not support them)
- Username, phone number, and TOTP secret preservation in metadata
- Organization and role sidecar merging into the output CSV (or package)

### 3. Validate, import, and post-import

Continue to [Validation](#validation), [Import](#importing-users), and [Post-Import](#post-import-totp-and-roles) below.

---

## Migrating from Firebase Auth

The recommended path is `export firebase`, which writes a [migration package](docs/migration-package.md) ready for `import-package`.

### 1. Export from Firebase

Export your users from the Firebase Console or using the Firebase CLI (`firebase auth:export`). This produces a JSON file with a `users` array.

### 2. Get password hash parameters

If you want to migrate passwords, get the hash parameters from Firebase Console > Authentication > Users > Password Hash Parameters. You need the signer key, salt separator, rounds, and memory cost.

### 3. Export to a migration package

```bash
workos-migrate export firebase \
  --from-file firebase-export.json \
  --output-dir ./migration-firebase \
  --signer-key <BASE64_KEY> \
  --salt-separator <BASE64_SEP> \
  --rounds 8 \
  --memory-cost 14 \
  --org-mapping orgs.csv
```

To also pull Identity Platform SAML/OIDC configs into the `sso/` handoff CSVs, pass a
service-account key file with `--service-account-key <path>` and `--project-id <id>` (or set
`GOOGLE_APPLICATION_CREDENTIALS` and `GOOGLE_CLOUD_PROJECT` / `GCLOUD_PROJECT`). If the
project ID cannot be resolved, the export fails rather than silently skipping SSO.

Options:

- `--from-file <path>` - Path to the Firebase Auth JSON export (required)
- `--source-tenant <name>` - Optional tenant identifier recorded in the manifest.
- `--name-split <strategy>` - How to split `displayName` into first/last: `first-space` (default), `last-space`, or `first-name-only`
- `--include-disabled` - Include disabled users (excluded by default)
- `--skip-passwords` - Skip password hash encoding
- `--org-mapping <path>` - CSV mapping Firebase UIDs to organizations (`firebase_uid,org_external_id,org_name`)
- `--role-mapping <path>` - CSV mapping Firebase UIDs to roles (`firebase_uid,role_slug`)
- `--service-account-key <path>` + `--project-id <id>` - Enable Identity Platform SSO connection export

The transformer handles:

- Firebase scrypt to PHC format encoding (`$firebase-scrypt$hash=...`)
- `displayName` splitting into `first_name` and `last_name`
- Phone number, custom claims, and Firebase UID preservation in metadata
- Skipping users without an email address

### 4. Validate, import, and post-import

Continue to [Validation](#validation), [Import](#importing-users), and [Post-Import](#post-import-totp-and-roles) below.

---

## Migrating from AWS Cognito

### 1. Set up AWS credentials

Configure your AWS credentials using one of the standard methods:

- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`)
- AWS credentials file (`~/.aws/credentials`)
- IAM role (when running on EC2/ECS/Lambda)

The Cognito exporter requires these IAM permissions:

- `cognito-idp:ListUserPools`
- `cognito-idp:ListIdentityProviders`
- `cognito-idp:DescribeIdentityProvider`
- `cognito-idp:ListUsers`

### 2. Export users and connections

The recommended path is to write a [migration package](docs/migration-package.md) that the
`import-package` orchestrator can consume in a single step:

```bash
workos-migrate export cognito \
  --region us-east-1 \
  --user-pool-ids us-east-1_ABC123,us-east-1_DEF456 \
  --output-dir ./migration-cognito \
  --entities users,organizations,memberships,sso
```

This writes the canonical layout: `users.csv`, `organizations.csv`,
`organization_memberships.csv`, the `sso/` handoff CSVs, and the `workos_upload/` projection.
By default each Cognito user pool maps to one WorkOS organization; pass
`--org-strategy connection` for one org per identity provider (memberships then become
header-only) or `--org-strategy none` to skip organization rows entirely.

Options:

- `--entities <list>` - `users,organizations,memberships,sso`.
- `--org-strategy <strategy>` - `user-pool` (default), `connection`, or `none`.
- `--output-dir <dir>` - Output directory for the migration package
- `--saml-custom-entity-id-template <url>` - Template for SAML custom Entity ID (default: `urn:amazon:cognito:sp:{user_pool_id}`)
- `--saml-custom-acs-url-template <url>` - Template for SAML custom ACS URL (placeholders: `{provider_name}`, `{user_pool_id}`, `{region}`)
- `--oidc-custom-redirect-uri-template <url>` - Template for OIDC custom redirect URI
- `--skip-external-provider-users` - Skip Cognito users whose `userStatus=EXTERNAL_PROVIDER`.

**Note:** Cognito does not expose password hashes via its API. The `password_hash` column will be blank for all users. Affected users will need to reset their password post-migration or rely on SSO + JIT provisioning via the migration proxy.

### 3. Migration proxy (optional)

For a seamless cutover where existing IdP configurations continue to work, see the reference proxy implementation in [`proxy-sample-cognito/`](./proxy-sample-cognito/). This Lambda handler routes per-tenant traffic between Cognito and WorkOS during the migration window.

### 4. Validate and import users

Continue to [Validation](#validation), [Import](#importing-users), and [Post-Import](#post-import-totp-and-roles) below.

---

## Custom CSV

If you already have a CSV in WorkOS format (see [CSV Format](#csv-format) above), skip straight to validation:

```bash
workos-migrate validate --csv my-users.csv
workos-migrate import --csv my-users.csv
```

### CSV migration package (manual provider path)

For unsupported providers, you can hand-build a [migration package](docs/migration-package.md) and run it through the same `import-package` orchestrator the dedicated providers use:

```bash
# Scaffold an empty package skeleton (generate-package-template is an equivalent alias)
workos-migrate export csv --output-dir ./migration-csv

# Populate users.csv (and optionally organizations.csv, organization_memberships.csv,
# role_definitions.csv, user_role_assignments.csv) with the canonical headers from
# docs/migration-package.md.

# Validate the package against the contract
workos-migrate validate-package ./migration-csv

# Run it through the importer (or --plan / --dry-run first)
workos-migrate import-package ./migration-csv
```

`validate-package` checks the manifest schema, every canonical CSV header, every required file, manifest count consistency, and JSONL parseability. It's safe to run repeatedly — exit 0 means the package is ready for `import-package`.

---

## Validation

Validate your CSV before importing to catch problems early:

```bash
workos-migrate validate --csv users.csv
```

The validator checks:

- Required fields (`email` is present and non-empty)
- Email format
- Duplicate emails
- Password hash format (valid bcrypt or firebase-scrypt structure)
- Organization reference consistency

### Auto-fix

The `--auto-fix` flag corrects common issues automatically:

```bash
workos-migrate validate --csv users.csv --auto-fix --output users-fixed.csv
```

Auto-fix handles whitespace trimming, email lowercasing, and empty field cleanup.

---

## Importing Users

### Basic import

```bash
workos-migrate import --csv users.csv
```

### Organization modes

**User only** (no org membership):

```bash
workos-migrate import --csv users.csv
```

**Single org** (all users into one organization):

```bash
workos-migrate import --csv users.csv --org-id org_01ABC
```

**Multi-org** (org per row, from CSV columns):

```bash
workos-migrate import --csv users.csv --create-org-if-missing
```

In multi-org mode, the importer reads `org_id`, `org_external_id`, or `org_name` from each row. Organizations are cached in memory to avoid repeated API lookups. If `--create-org-if-missing` is set, organizations referenced by name or external ID that don't exist in WorkOS are created automatically.

### Performance options

```bash
workos-migrate import \
  --csv users.csv \
  --concurrency 20 \
  --rate-limit 50 \
  --workers 4 \
  --chunk-size 5000 \
  --job-id my-migration
```

- `--concurrency <n>` - Parallel API requests per worker (default: 10)
- `--rate-limit <n>` - Max requests per second across all workers (default: 50)
- `--workers <n>` - Worker threads for CPU distribution (default: 1, requires `--job-id`)
- `--chunk-size <n>` - Rows per checkpoint chunk (default: 1000)

### Checkpoint and resume

For large migrations, use `--job-id` to enable checkpointing. If the process crashes or is interrupted, resume from where it left off:

```bash
# Start with checkpointing
workos-migrate import --csv users.csv --job-id my-migration

# Resume after interruption
workos-migrate import --csv users.csv --resume my-migration
```

Checkpoint state is stored in `.workos-checkpoints/<job-id>/`.

### Dry run

Preview what the import would do without making any API calls:

```bash
workos-migrate import --csv users.csv --dry-run
```

### Error output

Import errors are written to a JSONL file (default: `errors.jsonl`). Each line contains the email, error type, HTTP status, and message for a single failure.

---

## Error Analysis

After an import, analyze errors to understand what went wrong and generate a retry CSV:

```bash
workos-migrate analyze \
  --errors errors.jsonl \
  --retry-csv retry.csv \
  --original-csv users.csv
```

The analyzer groups errors by pattern, classifies them as retryable or non-retryable, and suggests fixes. The retry CSV contains only the rows that failed with retryable errors, so you can re-import just those users.

---

## Importing a migration package

Migration packages produced by `export <provider>` can be imported in one step with `import-package`:

```bash
# Plan only — print what would happen and exit
workos-migrate import-package ./migration-auth0 --plan

# Dry run — validate the package and write workos_import_summary.json with status=planned
workos-migrate import-package ./migration-auth0 --dry-run

# Live import
workos-migrate import-package ./migration-auth0
```

The orchestrator runs entities in this order:

1. Organizations (resolved or created during user import via `--create-org-if-missing` semantics).
2. Users + memberships (`runImport` on `users.csv`).
3. Role definitions (`process-role-definitions` on `role_definitions.csv`).
4. User-role assignments (per-org slices of `user_role_assignments.csv`).
5. TOTP enrollment (`enroll-totp` on `totp_secrets.csv`).
6. SSO connections — surfaced as **handoff-only**. The orchestrator never creates WorkOS SSO connections automatically. See `sso/handoff_notes.md` in the package for next steps.

Every run writes `workos_import_summary.json` (or `--summary <path>`) with per-entity status, totals, succeeded/failed counts, and warnings. Per-row errors land in `workos_import_errors.jsonl` (or `--errors <path>`).

---

## Post-Import: TOTP and Roles

### TOTP MFA enrollment

If your source system has TOTP secrets (e.g., from Auth0 or Clerk), you can enroll them in WorkOS after import:

```bash
workos-migrate enroll-totp \
  --input totp-secrets.csv \
  --totp-issuer "MyApp"
```

The input file can be CSV (`email,totp_secret`) or NDJSON (one JSON object per line with `email` and `totp_secret` or `mfa_factors` fields). Format is auto-detected from the file extension.

Options:

- `--format <csv|ndjson>` - Override auto-detection
- `--concurrency <n>` - Parallel requests (default: 5)
- `--rate-limit <n>` - Requests per second (default: 10)
- `--totp-issuer <name>` - Issuer shown in authenticator apps
- `--dry-run` - Validate without enrolling

### Role definitions and assignment

Create roles and permissions in WorkOS from a CSV, then assign them to users:

```bash
# Create roles and permissions
workos-migrate process-role-definitions \
  --definitions role-definitions.csv

# Create roles and assign to users
workos-migrate process-role-definitions \
  --definitions role-definitions.csv \
  --user-mapping user-roles.csv \
  --org-id org_01ABC
```

**Role definitions CSV** (`role_slug,role_name,role_type,permissions[,org_id]`):

```csv
role_slug,role_name,role_type,permissions
admin,Administrator,environment,"read,write,delete"
viewer,Viewer,environment,read
org-admin,Org Admin,organization,"read,write",org_01ABC
```

**User-role mapping CSV** (`email,role_slug`):

```csv
email,role_slug
alice@example.com,admin
bob@example.com,viewer
```

---

## Development

```bash
npm install
npm run build
npm run dev         # Run with tsx (no build step)
npm run lint
npm run typecheck
npm test            # 120 tests across 10 suites
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines. Security issues should be reported privately as described in [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
