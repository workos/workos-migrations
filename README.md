# WorkOS Migrations

A CLI tool for migrating users from identity providers into WorkOS. Supports Auth0, Clerk, Firebase Auth, and custom CSV imports with password hashes, organization memberships, roles, and TOTP MFA factors.

## Quick Start

The fastest way to get started is with the interactive wizard:

```bash
export WORKOS_SECRET_KEY=sk_...

npx workos/workos-migrations wizard
```

The wizard walks you through provider selection, export/transform, validation, and import step by step.

## Installation

This tool isn't published to npm yet. The easiest way to run it is straight from GitHub with `npx`:

```bash
npx workos/workos-migrations <command>
```

If you'd rather have a local checkout (for example to hack on the tool), clone and build it:

```bash
git clone https://github.com/workos/workos-migrations.git
cd workos-migrations
npm install
npm run build
npm link            # optional: exposes `workos-migrate` on your PATH
```

## Commands

| Command                    | Description                                            |
| -------------------------- | ------------------------------------------------------ |
| `wizard`                   | Interactive step-by-step migration wizard              |
| `export-auth0`             | Export users from Auth0 via Management API             |
| `export-cognito`           | Export users + SSO connections from AWS Cognito        |
| `merge-passwords`          | Merge Auth0 password hashes into the export CSV        |
| `transform-clerk`          | Transform a Clerk CSV export to WorkOS format          |
| `transform-firebase`       | Transform a Firebase Auth JSON export to WorkOS format |
| `validate`                 | Validate a CSV file before import                      |
| `import`                   | Import users from CSV into WorkOS                      |
| `analyze`                  | Analyze import errors and generate retry CSV           |
| `enroll-totp`              | Enroll TOTP MFA factors for imported users             |
| `process-role-definitions` | Create roles and assign permissions in WorkOS          |

Run `npx workos/workos-migrations <command> --help` (or `workos-migrate <command> --help` from a local checkout) for full option details on any command.

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

### 2. Export users

```bash
workos-migrate export-auth0 \
  --domain my-tenant.us.auth0.com \
  --client-id <M2M_CLIENT_ID> \
  --client-secret <M2M_CLIENT_SECRET> \
  --output auth0-export.csv
```

To write a migration package with users, organizations, memberships, warnings, and skipped-user
sidecars:

```bash
workos-migrate export-auth0 \
  --domain my-tenant.us.auth0.com \
  --client-id <M2M_CLIENT_ID> \
  --client-secret <M2M_CLIENT_SECRET> \
  --package \
  --output-dir ./migration-auth0
```

To write only SSO handoff files:

```bash
workos-migrate export-auth0 \
  --domain my-tenant.us.auth0.com \
  --client-id <M2M_CLIENT_ID> \
  --client-secret <M2M_CLIENT_SECRET> \
  --package \
  --entities sso \
  --output-dir ./migration-auth0-sso
```

Options:

- `--orgs <ids...>` - Filter to specific Auth0 organization IDs
- `--entities <entities>` - Comma-separated package entities to export (`users,organizations,memberships,sso`)
- `--rate-limit <n>` - API requests per second (default: 50)
- `--use-metadata` - Use `user_metadata` for org discovery instead of the Organizations API
- `--include-federated-users` - Include federated/JIT users in package mode (skipped by default)
- `--include-secrets` - Include SSO connection secrets in package handoff files (redacted by default)
- `--job-id <id>` - Enable export checkpointing for large tenants
- `--resume [jobId]` - Resume a previously checkpointed export

The export maps Auth0 fields to WorkOS CSV format, including `email_verified`, `external_id`, and custom metadata.
Auth0 package SSO export is handoff-only: it emits only SAML and OIDC enterprise connections with enough configuration for WorkOS handoff. Database, passwordless, social, generic OAuth, and incomplete connections are skipped with warnings.

For a callback proxy reference implementation during Auth0 enterprise-connection cutover, see [`proxy-sample-auth0`](proxy-sample-auth0/README.md). The repo also includes [`proxy-sample-cognito`](proxy-sample-cognito/README.md) for Cognito migrations.

### 3. Merge password hashes (optional)

Auth0 does not include password hashes in the Management API export. You need to request a password export from Auth0 support, which provides an NDJSON file. Once you have it:

```bash
workos-migrate merge-passwords \
  --csv auth0-export.csv \
  --passwords auth0-passwords.ndjson \
  --output auth0-with-passwords.csv
```

This merges bcrypt hashes into the CSV by matching on email. Users without a matching hash are left without a password and will need to reset on first login.

### 4. Validate, import, and post-import

Continue to [Validation](#validation), [Import](#importing-users), and [Post-Import](#post-import-totp-and-roles) below.

---

## Migrating from Clerk

### 1. Export from Clerk

Export your users from the Clerk Dashboard as a CSV file. The export includes columns like `id`, `first_name`, `last_name`, `primary_email_address`, `password_digest`, `password_hasher`, etc.

### 2. Transform to WorkOS format

```bash
workos-migrate transform-clerk \
  --input clerk-export.csv \
  --output clerk-transformed.csv
```

Options:

- `--org-mapping <path>` - CSV mapping Clerk user IDs to organizations (`clerk_user_id,org_external_id,org_name`)
- `--role-mapping <path>` - CSV mapping Clerk user IDs to roles (`clerk_user_id,role_slug`)

The transformer handles:

- Field mapping (Clerk columns to WorkOS columns)
- bcrypt password passthrough (other hash types like argon2 are dropped with a warning since WorkOS does not support them)
- Username, phone number, and TOTP secret preservation in metadata
- Organization and role sidecar merging into the output CSV

### 3. Validate, import, and post-import

Continue to [Validation](#validation), [Import](#importing-users), and [Post-Import](#post-import-totp-and-roles) below.

---

## Migrating from Firebase Auth

### 1. Export from Firebase

Export your users from the Firebase Console or using the Firebase CLI (`firebase auth:export`). This produces a JSON file with a `users` array.

### 2. Get password hash parameters

If you want to migrate passwords, get the hash parameters from Firebase Console > Authentication > Users > Password Hash Parameters. You need the signer key, salt separator, rounds, and memory cost.

### 3. Transform to WorkOS format

```bash
workos-migrate transform-firebase \
  --input firebase-export.json \
  --output firebase-transformed.csv \
  --signer-key <BASE64_KEY> \
  --salt-separator <BASE64_SEP> \
  --rounds 8 \
  --memory-cost 14
```

Options:

- `--name-split <strategy>` - How to split `displayName` into first/last: `first-space` (default), `last-space`, or `first-name-only`
- `--include-disabled` - Include disabled users (excluded by default)
- `--skip-passwords` - Skip password hash encoding
- `--org-mapping <path>` - CSV mapping Firebase UIDs to organizations (`firebase_uid,org_external_id,org_name`)
- `--role-mapping <path>` - CSV mapping Firebase UIDs to roles (`firebase_uid,role_slug`)

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

```bash
workos-migrate export-cognito \
  --region us-east-1 \
  --user-pool-ids us-east-1_ABC123,us-east-1_DEF456
```

Options:

- `--entities <list>` - Comma-separated entities to export: `connections`, `users` (default: both)
- `--output-dir <dir>` - Output directory for CSV files (default: current directory)
- `--saml-custom-entity-id-template <url>` - Template for SAML custom Entity ID (default: `urn:amazon:cognito:sp:{user_pool_id}`)
- `--saml-custom-acs-url-template <url>` - Template for SAML custom ACS URL (placeholders: `{provider_name}`, `{user_pool_id}`, `{region}`)
- `--oidc-custom-redirect-uri-template <url>` - Template for OIDC custom redirect URI

The export produces:

- `workos_saml_connections.csv` - SAML SSO connections
- `workos_oidc_connections.csv` - OIDC SSO connections
- `custom_attribute_mappings.csv` - Supplementary attribute mappings
- `workos_users.csv` - Users in WorkOS import format

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
