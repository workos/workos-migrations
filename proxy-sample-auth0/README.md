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
  |-- no fallback=auth0
  |     307 -> https://workos.example.com/sso/<workos-client-id>/auth0/callback
  |
  `-- fallback=auth0
        proxy -> https://<tenant>.auth0.com/login/callback
```

The flow mirrors the Auth0 enterprise-connection migration guide:

1. The IdP sends the SAML response or OIDC callback to the existing Auth0 callback URL.
2. The Worker redirects callback traffic to WorkOS at `/sso/<client-id>/auth0/callback`.
3. WorkOS resolves the imported connection by Auth0 connection information in the callback.
4. If WorkOS cannot process that callback, it sends the browser back with `fallback=auth0`.
5. The Worker strips `fallback=auth0` and forwards the original callback to Auth0.

## Files

| File                    | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `worker.js`             | Cloudflare Worker callback proxy.                |
| `wrangler.toml.example` | Minimal Wrangler config to adapt for deployment. |

## Environment Variables

Set these as Worker variables or secrets:

- `WORKOS_CUSTOM_DOMAIN` - WorkOS custom auth domain, for example `workos.example.com`.
- `WORKOS_CLIENT_ID` - WorkOS environment client ID used in the callback path.
- `AUTH0_FALLBACK_ORIGIN` - Auth0 tenant origin to forward fallback traffic to, for example `https://my-tenant.us.auth0.com`.

`AUTH0_FALLBACK_ORIGIN` should not be the same proxied custom-domain hostname or the fallback request can loop through the Worker.

## Deploy With Wrangler

```sh
cp wrangler.toml.example wrangler.toml
# Edit route, account_id, and vars.
npx wrangler deploy
```

Recommended Worker route:

```text
auth0.example.com/login/callback*
```

Keep the Worker scoped to the callback route. Other Auth0 traffic should continue to route normally.

## Rollback

Rollback is DNS/routing-level:

- Disable the Worker route to send all callback traffic directly to Auth0.
- Or add a temporary Worker rule that treats all callbacks as `fallback=auth0`.

Per-connection rollback should normally happen in the application authorization flow by routing that connection back to Auth0 before the IdP callback is reached.

## Local Smoke Tests

With Wrangler dev running:

```sh
curl -i "http://localhost:8787/login/callback?connection=okta"
curl -i "http://localhost:8787/login/callback?connection=okta&fallback=auth0"
```

Expected behavior:

- First request returns `307` with a `Location` under `https://<WORKOS_CUSTOM_DOMAIN>/sso/<WORKOS_CLIENT_ID>/auth0/callback`.
- Second request is proxied to `AUTH0_FALLBACK_ORIGIN` after removing `fallback=auth0`.

## Production Notes

- Use a WorkOS custom domain before cutover so callback URLs remain stable.
- Preserve the request method and body. The sample uses `307` so browser POSTs remain POSTs.
- Keep query parameters intact except for the fallback flag when forwarding to Auth0.
- Add monitoring around WorkOS fallback volume and Auth0 fallback responses.
- Test in staging with one connection before routing broad production traffic.
