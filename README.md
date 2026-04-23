# WorkOS Migrations

A CLI tool to migrate data from various identity providers to WorkOS.

## Features

- **Multiple Provider Support**: Auth0, Clerk, Firebase Auth, AWS Cognito
- **Interactive Mode**: User-friendly prompts to guide you through the process
- **CLI Arguments**: Automate exports with command-line arguments
- **Config File Support**: Save credentials for repeated use
- **Entity Selection**: Choose which data types to export (users, connections, etc.)

## Installation

```bash
npm install -g workos-migrations
```

## Usage

### Interactive Mode

Run the tool without arguments to enter interactive mode:

```bash
npx workos-migrations
```

### Command Line Mode

#### Auth0 Export

```bash
# Using environment variables
export AUTH0_CLIENT_ID="your_client_id"
export AUTH0_CLIENT_SECRET="your_client_secret"
export AUTH0_DOMAIN="your-tenant.auth0.com"

npx workos-migrations auth0 export

# Using CLI arguments
npx workos-migrations auth0 export \
  --client-id "your_client_id" \
  --client-secret "your_client_secret" \
  --domain "your-tenant.auth0.com"

# Export specific entities
npx workos-migrations auth0 export --entities users,connections
```

#### AWS Cognito Export

```bash
# Using environment variables (default AWS credential chain works too — env, ~/.aws, aws-vault, etc.)
export AWS_REGION="us-east-1"
export COGNITO_USER_POOL_IDS="us-east-1_AAA,us-east-1_BBB"

npx workos-migrations cognito export

# Using CLI arguments
npx workos-migrations cognito export \
  --region us-east-1 \
  --user-pool-ids us-east-1_AAA,us-east-1_BBB \
  --out-dir ./out

# Pick specific entities
npx workos-migrations cognito export --entities connections
npx workos-migrations cognito export --entities users
npx workos-migrations cognito export --entities connections,users

# Migration-proxy mode: populate customAcsUrl / customEntityId / customRedirectUri via templates.
# Placeholders: {provider_name}, {user_pool_id}, {region}.
npx workos-migrations cognito export \
  --region us-east-1 \
  --user-pool-ids us-east-1_AAA \
  --saml-custom-acs-url-template "https://sso.example.com/{provider_name}/acs" \
  --oidc-custom-redirect-uri-template "https://sso.example.com/{provider_name}/oidc-callback"
```

Output files (written to `--out-dir`, or the current directory by default):

- `workos_saml_connections.csv` — matches the WorkOS standalone SSO import template
- `workos_oidc_connections.csv` — same, for OIDC
- `custom_attribute_mappings.csv` — supplementary view of all non-standard mappings
- `workos_users.csv` — matches the WorkOS users import template (when `users` is selected)
- `cognito-export-<timestamp>.json` — full raw export dump

**On passwords:** the `password_hash` column is written blank for every exported user. Cognito does not expose user password hashes via its API, so users authenticating with email/password in Cognito will need to reset their password after migration (or rely on SSO + JIT provisioning, which avoids the password flow entirely).

See [`proxy-sample-cognito/`](./proxy-sample-cognito) for a reference Lambda-based SAML migration proxy (receives SAML POSTs at the legacy ACS URL, forwards to WorkOS or Cognito per-tenant based on DynamoDB migration state).

#### Other Providers

```bash
# These will record feature requests
npx workos-migrations clerk export
npx workos-migrations firebase export

# CSV Import to WorkOS
export WORKOS_API_KEY="your_workos_api_key"

# Generate CSV templates
npx workos-migrations csv generate-template --template users
npx workos-migrations csv generate-template --template organizations
npx workos-migrations csv generate-template --template organization_memberships
npx workos-migrations csv generate-template --template connections

# Validate CSV files
npx workos-migrations csv validate --template users --file users.csv

# Import CSV files to WorkOS
npx workos-migrations csv import --template users --file users.csv

# List import jobs
npx workos-migrations csv list-jobs
```

### Configuration

Credentials can be saved to `~/.workos-migrations/config.json`:

```json
{
  "providers": {
    "auth0": {
      "clientId": "your_client_id",
      "clientSecret": "your_client_secret",
      "domain": "your-tenant.auth0.com"
    },
    "csv": {
      "workosApiKey": "your_workos_api_key"
    }
  }
}
```

## Supported Providers

- ✅ **Auth0** - Full export support
- ✅ **AWS Cognito** - User + connection (SAML + OIDC) export → WorkOS import CSVs
- ✅ **CSV Import to WorkOS** - Full import support with templates
- 🚧 **Clerk** - Coming soon
- 🚧 **Firebase Auth** - Coming soon

## AWS Cognito Setup

The tool uses the standard AWS credential chain — env vars, `~/.aws/credentials` profile, instance profile, aws-vault, or SSO. IAM permissions needed on the target account:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cognito-idp:ListUserPools",
        "cognito-idp:ListIdentityProviders",
        "cognito-idp:DescribeIdentityProvider",
        "cognito-idp:ListUsers"
      ],
      "Resource": "*"
    }
  ]
}
```

The exporter is **read-only** — it calls list/describe only, never writes to your Cognito setup.

### Cognito → WorkOS column mapping

The exporter handles the `name` + `customAttributes` columns that WorkOS is adding alongside the standard `firstNameAttribute` / `lastNameAttribute` / `emailAttribute` fields. Cognito custom attribute mappings (`custom:department`, `custom:location`, etc.) are serialized into the `customAttributes` cell as a compact JSON blob with the `custom:` prefix stripped, matching the import-side contract.

The `customEntityId` column defaults to the Cognito SP pattern (`urn:amazon:cognito:sp:{user_pool_id}`) so WorkOS accepts SAML assertions that customers' IdPs signed for the existing Cognito SP. Override with `--saml-custom-entity-id-template` when migrating off a non-Cognito SP.

## Auth0 Setup

1. Create a Machine-to-Machine application in Auth0
2. Authorize it for the Auth0 Management API
3. Grant the following scopes:
   - `read:users` (for user export)
   - `read:connections` (for connection export)
   - `read:connections_options` (for connection details)
   - `read:clients` (for application export)
   - `read:roles` (for role export)
   - `read:organizations` (for organization export)

## CSV Import Templates

The tool supports importing data to WorkOS using predefined CSV templates:

### Users Template (`users.csv`)
- **Required**: `user_id`, `email`
- **Optional**: `email_verified`, `first_name`, `last_name`, `password_hash`

### Organizations Template (`organizations.csv`)
- **Required**: `organization_id`, `name`

### Organization Memberships Template (`organization_memberships.csv`)
- **Required**: `organization_id`, `user_id`

### Connections Template (`connections.csv`)
- **Required**: `organizationName`, `organizationId`
- **Optional**: `domains`, `idpEntityId`, `idpUrl`, `x509Cert`, `idpIdAttribute`, `idpMetadataUrl`, `customEntityId`, `customAcsUrl`, `requestSigningCert`

**Field Descriptions:**
- `organizationName`: Name of the organization
- `organizationId`: Unique identifier for the organization  
- `domains`: Semicolon-separated list of domains (e.g., "acme.com;app.acme.com")
- `idpEntityId`: Identity Provider Entity ID
- `idpUrl`: Identity Provider SSO URL
- `x509Cert`: X.509 certificate for SAML signing
- `idpIdAttribute`: Attribute mapping for user ID (e.g., "email", "uid")
- `idpMetadataUrl`: URL to IdP metadata
- `customEntityId`: Custom Entity ID override
- `customAcsUrl`: Custom ACS (Assertion Consumer Service) URL
- `requestSigningCert`: Certificate for signing SAML requests

Generate templates with examples:
```bash
npx workos-migrations csv generate-template --template users --output my-users.csv
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development
npm run dev

# Run built version
npm start
```

## License

MIT