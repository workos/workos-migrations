# Auth0 SSO Migration Proxy - Sample Implementation

A minimal Cloudflare Worker proxy for Auth0 -> WorkOS enterprise SSO migrations. It sits on the Auth0 custom domain callback route during cutover so customer IdPs can keep posting to the existing Auth0 callback while WorkOS handles migrated SAML/OIDC connections.

This is a **reference implementation**, not a drop-in production binary. Adapt logging, rollout controls, monitoring, and deployment to your environment before production use.

## Architecture

```text
Customer IdP
  |
  | POST/GET https://auth0.example.com/login/callback
  v
Cloudflare Worker on Auth0 custom domain
  |
  |-- Feature Flag enabled for org?
  |     yes -> 307 -> https://workos.example.com/sso/<workos-client-id>/auth0/callback
  |
  |-- Feature Flag disabled / org not mapped?
  |     proxy -> https://<tenant>.auth0.com/login/callback
  |
  `-- fallback=auth0 (WorkOS could not process)
        proxy -> https://<tenant>.auth0.com/login/callback
```

The flow uses WorkOS Feature Flags for incremental connection rollout:

1. The IdP sends the SAML response or OIDC callback to the existing Auth0 callback URL.
2. The Worker resolves the Auth0 connection name to a WorkOS organization ID via KV lookup.
3. It checks if the `enable-connection` feature flag is enabled for that organization using the WorkOS Feature Flags API.
4. If the flag is enabled, the Worker redirects callback traffic to WorkOS at `/sso/<client-id>/auth0/callback`.
5. If the flag is disabled or the organization is not mapped, traffic is proxied to Auth0 unchanged.
6. If WorkOS cannot process the callback, it sends the browser back with `fallback=auth0`, and the Worker forwards the original callback to Auth0.

## Incremental Rollout with Feature Flags

WorkOS Feature Flags let you control which organizations are routed through WorkOS during migration. This enables a safe, incremental cutover:

1. **Create a feature flag** in the WorkOS dashboard with the slug `enable-connection`.
2. **Populate the CONNECTION_ORG_MAP** KV namespace with entries mapping each Auth0 connection name to its corresponding WorkOS organization ID.
3. **Enable the flag for a single organization** to test the migration path for one customer.
4. **Monitor** — watch for fallback volume and Auth0 fallback responses.
5. **Expand rollout** — enable the flag for additional organizations as confidence grows.
6. **Complete migration** — once all organizations are enabled and stable, the proxy can be removed.

If an issue arises, simply disable the flag for the affected organization in the WorkOS dashboard. Traffic for that organization immediately reverts to Auth0 on the next request (after cache TTL expires).

## Files

| File                    | Purpose                                                    |
| ----------------------- | ---------------------------------------------------------- |
| `worker.js`             | Cloudflare Worker callback proxy with feature flag gating. |
| `wrangler.toml.example` | Minimal Wrangler config to adapt for deployment.           |

## Environment Variables

Set these as Worker variables or secrets:

- `WORKOS_CUSTOM_DOMAIN` - WorkOS custom auth domain, for example `workos.example.com`.
- `WORKOS_CLIENT_ID` - WorkOS environment client ID used in the callback path.
- `AUTH0_FALLBACK_ORIGIN` - Auth0 tenant origin to forward fallback traffic to, for example `https://my-tenant.us.auth0.com`.
- `WORKOS_SECRET_KEY` - WorkOS secret key for Feature Flags API calls. **Set as a Wrangler secret.**
- `FEATURE_FLAG_SLUG` - The feature flag slug to evaluate (e.g., `enable-connection`).
- `FLAG_CACHE_TTL_SECONDS` - (Optional) How long to cache flag evaluations, in seconds. Defaults to `60`.

`AUTH0_FALLBACK_ORIGIN` should not be the same proxied custom-domain hostname or the fallback request can loop through the Worker.

## KV Namespace: CONNECTION_ORG_MAP

A Cloudflare Workers KV namespace that maps Auth0 connection names to WorkOS organization IDs.

**Keys:** Auth0 connection name (e.g., `okta-corp`, `saml-acme`)
**Values:** WorkOS organization ID (e.g., `org_01EHZNVPK3SFK441A1RGBFSHRT`)

### Populating the KV namespace

```sh
# Add a single mapping
npx wrangler kv key put --binding CONNECTION_ORG_MAP "okta-corp" "org_01EHZNVPK3SFK441A1RGBFSHRT"

# Bulk import from JSON
npx wrangler kv bulk put --binding CONNECTION_ORG_MAP mappings.json
```

Example `mappings.json`:

```json
[
  { "key": "okta-corp", "value": "org_01EHZNVPK3SFK441A1RGBFSHRT" },
  { "key": "saml-acme", "value": "org_01EHQMYV6MBK39QC5PZXHY59C3" }
]
```

## Deploy With Wrangler

```sh
cp wrangler.toml.example wrangler.toml
# Edit route, account_id, KV namespace ID, and vars.

# Set the WorkOS secret key
npx wrangler secret put WORKOS_SECRET_KEY

# Create the KV namespace
npx wrangler kv namespace create CONNECTION_ORG_MAP
# Update the namespace ID in wrangler.toml

# Populate connection-to-org mappings
npx wrangler kv key put --binding CONNECTION_ORG_MAP "my-connection" "org_..."

# Deploy
npx wrangler deploy
```

Recommended Worker route:

```text
auth0.example.com/login/callback*
```

Keep the Worker scoped to the callback route. Other Auth0 traffic should continue to route normally.

## Rollback

Feature flag based rollback is instant:

- **Per-organization:** Disable the `enable-connection` flag for the affected organization in the WorkOS dashboard. After the cache TTL expires (default 60s), that organization's traffic routes to Auth0.
- **Global:** Disable the feature flag entirely. All traffic falls back to Auth0.
- **DNS/routing-level:** Disable the Worker route to send all callback traffic directly to Auth0.

Per-connection rollback should normally happen in the application authorization flow by routing that connection back to Auth0 before the IdP callback is reached.

## Local Smoke Tests

With Wrangler dev running:

```sh
curl -i "http://localhost:8787/login/callback?connection=okta-corp"
curl -i "http://localhost:8787/login/callback?connection=okta-corp&fallback=auth0"
curl -i "http://localhost:8787/login/callback?connection=unmapped-conn"
```

Expected behavior:

- First request: if the org mapped to `okta-corp` has the flag enabled, returns `307` with a `Location` under `https://<WORKOS_CUSTOM_DOMAIN>/sso/<WORKOS_CLIENT_ID>/auth0/callback`. Otherwise, proxies to Auth0.
- Second request: proxied to `AUTH0_FALLBACK_ORIGIN` after removing `fallback=auth0` (fallback always bypasses the flag check).
- Third request: no org mapping found, proxied to Auth0.

## Production Notes

- Use a WorkOS custom domain before cutover so callback URLs remain stable.
- Preserve the request method and body. The sample uses `307` so browser POSTs remain POSTs.
- Keep query parameters intact except for the fallback flag when forwarding to Auth0.
- Add monitoring around WorkOS fallback volume and Auth0 fallback responses.
- Start with one organization, validate end-to-end, then expand the rollout.
- The cache TTL controls how quickly flag changes take effect — lower values mean faster rollout control but more API calls.
