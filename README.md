# Auth0 Connection Migration Tool

A CLI tool to export Auth0 enterprise connections and applications for migration purposes.

## Installation

You can run this tool directly with npx:

```bash
npx github:workos/migrate-auth0-connections
```

## Usage

### Environment Variables

You can provide Auth0 credentials via environment variables:

```bash
AUTH0_CLIENT_ID=your_client_id \
AUTH0_CLIENT_SECRET=your_client_secret \
AUTH0_API_DOMAIN=your-tenant.auth0.com \
npx github:workos/migrate-auth0-connections
```

### Interactive Mode

If environment variables are not provided, the CLI will prompt you for the required credentials:

- **AUTH0_CLIENT_ID**: Your Auth0 Management API client ID
- **AUTH0_CLIENT_SECRET**: Your Auth0 Management API client secret  
- **AUTH0_API_DOMAIN**: Your Auth0 domain (e.g., `your-tenant.auth0.com`)

## Features

- **Export Connections and Applications**: Exports all SSO connections (AD, ADFS, SAML, OIDC, Okta, PingFederate) and their associated applications
- **Detailed Reporting**: Generates comprehensive JSON reports with connection configurations and client associations
- **Secure**: Redacts sensitive information in the export (client secrets, etc.)
- **Interactive CLI**: User-friendly prompts with validation

## Output

The tool generates a timestamped JSON file containing:

- All clients/applications with their basic information
- All enterprise connections with their configurations
- Mapping of which clients are enabled for each connection
- Summary statistics by connection strategy

## Auth0 Setup

To use this tool, you need to create a Machine-to-Machine application in Auth0 with the following scopes:

- `read:clients`
- `read:connections`

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run built version
npm start
```