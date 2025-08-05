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

#### Other Providers

```bash
# These will record feature requests
npx workos-migrations clerk export
npx workos-migrations firebase export
npx workos-migrations cognito export

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
- ✅ **CSV Import to WorkOS** - Full import support with templates
- 🚧 **Clerk** - Coming soon
- 🚧 **Firebase Auth** - Coming soon
- 🚧 **AWS Cognito** - Coming soon

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