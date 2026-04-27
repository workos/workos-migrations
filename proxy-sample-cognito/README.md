# SSO Migration Proxy — Sample Implementation

A minimal AWS Lambda + DynamoDB proxy that sits between customers' IdPs and your auth backend during a Cognito → WorkOS migration. Each SAML Response hits the proxy, which looks up per-tenant migration state and forwards to either the existing Cognito ACS URL or the new WorkOS ACS URL.

This is a **reference implementation**, not a drop-in production binary. Adapt to your infra (logging, secrets, observability, deployment) before shipping.

## Architecture

```
┌─────────────┐       ┌──────────────────────────────┐       ┌──────────────┐
│ Customer IdP│──POST─▶│    sso.example.com/...       │       │    Cognito   │
│   (Okta)    │       │   (Route 53 → API Gateway)   │──────▶│  (legacy)    │
└─────────────┘       │         ↓                    │       └──────────────┘
                      │    Lambda: lambda_function.py│             OR
                      │         ↓                    │       ┌──────────────┐
                      │    DynamoDB: migrations      │──────▶│    WorkOS    │
                      │    (migrated? + acs url)     │       │    (new)     │
                      └──────────────────────────────┘       └──────────────┘
                                   ▲
                                   │ periodic sync
                      ┌────────────┴─────────────────┐
                      │   sync_workos.py (Lambda)    │
                      │   polls WorkOS API, updates  │
                      │   DynamoDB with current ACS  │
                      │   URLs + active status       │
                      └──────────────────────────────┘
```

### Flow

1. Customer IdP POSTs a SAML Response to the **existing** ACS URL on your custom domain (e.g. `https://sso.example.com/tenant-a/acs`). The IdP does not know anything changed.
2. Route 53 + API Gateway route the POST to the proxy Lambda.
3. The Lambda looks up the tenant in DynamoDB:
   - `migrated=true` and `workos_acs_url` populated → forward to WorkOS
   - anything else → forward to the legacy Cognito ACS URL
4. The forward is an auto-submitting HTML form. The browser re-POSTs the SAML Response and its RelayState to the target URL. Standard SAML proxy pattern.
5. WorkOS (or Cognito) validates the assertion against the `customEntityId` + `customAcsUrl` you registered on the connection.

### Per-tenant rollback

Flip `migrated` to `false` for a tenant in DynamoDB → next POST goes back to Cognito. No deploy, no DNS change.

## Files

| File | Purpose |
|---|---|
| `lambda_function.py` | Proxy handler. Receives SAML POST, looks up tenant, forwards via auto-submit form. |
| `sync_workos.py` | Scheduled Lambda (or CLI). Pulls connection list from WorkOS API, grabs each connection's SP metadata ACS URL, upserts DynamoDB rows. |

## DynamoDB table

Create a table named whatever you like, with partition key `tenant_id` (String). The proxy and sync scripts expect this schema:

```json
{
  "tenant_id":            "tenant-a-saml",
  "migrated":             true,
  "workos_connection_id": "conn_01ABCDEFGHIJKLMNOPQRSTUVWX",
  "workos_acs_url":       "https://api.workos.com/sso/saml/acs/01HXYZ...",
  "connection_type":      "GenericSAML",
  "updated_at":           1716466000
}
```

AWS CLI to create it:

```sh
aws dynamodb create-table \
  --table-name sso-migration-state \
  --attribute-definitions AttributeName=tenant_id,AttributeType=S \
  --key-schema AttributeName=tenant_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

## Deploy the proxy Lambda

Environment variables it needs:

- `MIGRATIONS_TABLE` — DynamoDB table name
- `COGNITO_FALLBACK_ACS_URL` — full Cognito ACS URL (e.g. `https://<pool-prefix>.auth.us-east-1.amazoncognito.com/saml2/idpresponse`)

IAM policy fragment:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem"],
      "Resource": "arn:aws:dynamodb:us-east-1:*:table/sso-migration-state"
    }
  ]
}
```

API Gateway HTTP API route: `POST /sso/{tenant_id}/acs` → Lambda.

Route 53 + custom domain: point your existing ACS hostname at the API Gateway distribution. The hostname stays the same so customer IdPs need no reconfiguration.

## Deploy the sync Lambda

Environment variables:

- `WORKOS_API_KEY` — stored in Secrets Manager ideally
- `MIGRATIONS_TABLE` — same table
- `WORKOS_API_BASE` — default `https://api.workos.com`

IAM policy fragment:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:us-east-1:*:table/sso-migration-state"
    }
  ]
}
```

Schedule it with EventBridge — every 5 min during cutover, hourly after stabilization. Or invoke on-demand when you cut over a tenant.

## Run sync locally

```sh
export WORKOS_API_KEY=sk_live_...
export MIGRATIONS_TABLE=sso-migration-state
python3 sync_workos.py
```

Prints stats on what it updated.

## Bootstrapping before the first customer cuts over

Before any connection is flipped to `migrated=true`, the table can be populated in one of two ways:

- Run `sync_workos.py` once after importing connections to WorkOS. `migrated` will start as `false` until you actively flip a tenant (because the WorkOS connection starts in `inactive` state).
- Manually insert rows with `migrated=false` for every tenant. The proxy handles missing rows the same way (routes to Cognito), but pre-populating makes dashboards + rollback drills cleaner.

## Adjust for your tenant routing scheme

The Lambda extracts `tenant_id` from the URL path (`/sso/{tenant_id}/acs`). If your legacy ACS URLs use a different layout (subdomain, query param, hardcoded per tenant), edit `_tenant_from_path` and/or `lambda_handler` accordingly. The rest of the logic is path-agnostic.

## What this sample does not do

- No signature validation of the inbound SAML Response. The proxy forwards verbatim; WorkOS / Cognito validate.
- No rate limiting. Add an API Gateway usage plan or Lambda concurrency cap if you expect abuse.
- No telemetry beyond CloudWatch logs. Add your observability stack of choice.
- No admin UI for flipping `migrated`. A one-line `aws dynamodb update-item` works; build a UI if ops wants one.
