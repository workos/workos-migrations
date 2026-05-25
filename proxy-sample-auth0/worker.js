/**
 * Auth0 -> WorkOS enterprise SSO callback proxy with Feature Flag rollout.
 *
 * Deploy on the Auth0 custom-domain callback route:
 *
 *   auth0.example.com/login/callback*
 *
 * Required Worker variables:
 *
 *   WORKOS_CUSTOM_DOMAIN   workos.example.com
 *   WORKOS_CLIENT_ID       client_...
 *   AUTH0_FALLBACK_ORIGIN  https://my-tenant.us.auth0.com
 *   WORKOS_SECRET_KEY      sk_...  (used to evaluate feature flags)
 *   FEATURE_FLAG_SLUG      enable-connection
 *
 * Required KV namespace binding:
 *
 *   CONNECTION_ORG_MAP     KV namespace mapping Auth0 connection names to WorkOS org IDs.
 *                          Keys are Auth0 connection names; values are WorkOS organization IDs.
 *
 * Optional variables:
 *
 *   FLAG_CACHE_TTL_SECONDS  How long to cache feature flag evaluations (default 60).
 */

const CALLBACK_PATH = '/login/callback';
const FALLBACK_PARAM = 'fallback';
const FALLBACK_VALUE = 'auth0';
const DEFAULT_CACHE_TTL = 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== CALLBACK_PATH) {
      return proxyToAuth0(request, env);
    }

    if (url.searchParams.get(FALLBACK_PARAM) === FALLBACK_VALUE) {
      return proxyToAuth0(request, env, { stripFallback: true });
    }

    const connection = url.searchParams.get('connection');
    const shouldRouteToWorkOS = await evaluateConnectionFlag(connection, env, ctx);

    if (shouldRouteToWorkOS) {
      return redirectToWorkOS(request, env);
    }

    return proxyToAuth0(request, env);
  },
};

/**
 * Evaluate whether the given connection should be routed to WorkOS by checking
 * the WorkOS Feature Flag for the mapped organization.
 *
 * Returns true when the connection's organization has the migration flag
 * enabled, false otherwise (including on errors — fail-open to Auth0).
 */
async function evaluateConnectionFlag(connection, env, ctx) {
  if (!connection) {
    return false;
  }

  assertEnv(env, 'WORKOS_SECRET_KEY');
  assertEnv(env, 'FEATURE_FLAG_SLUG');

  const orgId = await resolveOrgId(connection, env);
  if (!orgId) {
    return false;
  }

  return isFlagEnabled(env.FEATURE_FLAG_SLUG, orgId, env, ctx);
}

/**
 * Look up the WorkOS organization ID for a given Auth0 connection name.
 * Uses a KV namespace binding (CONNECTION_ORG_MAP) for the mapping.
 */
async function resolveOrgId(connection, env) {
  if (!env.CONNECTION_ORG_MAP) {
    return null;
  }

  return env.CONNECTION_ORG_MAP.get(connection);
}

/**
 * Check if a feature flag is enabled for the given organization by calling
 * the WorkOS Feature Flags API.
 *
 * Results are cached in the Cloudflare Cache API to avoid per-request API
 * calls. The cache TTL defaults to 60 seconds and is configurable via
 * FLAG_CACHE_TTL_SECONDS.
 */
async function isFlagEnabled(slug, orgId, env, ctx) {
  const cacheKey = new Request(`https://ff-cache.internal/${slug}/${orgId}`, { method: 'GET' });
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.json();
    return body.enabled;
  }

  let enabled = false;

  try {
    const res = await fetch(
      `https://api.workos.com/organizations/${encodeURIComponent(orgId)}/feature-flags`,
      {
        headers: {
          Authorization: `Bearer ${env.WORKOS_SECRET_KEY}`,
        },
      },
    );

    if (res.ok) {
      const json = await res.json();
      const flags = json.data || [];
      enabled = flags.some((flag) => flag.slug === slug);
    }
  } catch {
    // On network or parsing errors, fail-open to Auth0.
    return false;
  }

  const ttl = parseInt(env.FLAG_CACHE_TTL_SECONDS, 10) || DEFAULT_CACHE_TTL;
  const cacheResponse = new Response(JSON.stringify({ enabled }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `s-maxage=${ttl}`,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, cacheResponse));

  return enabled;
}

function redirectToWorkOS(request, env) {
  assertEnv(env, 'WORKOS_CUSTOM_DOMAIN');
  assertEnv(env, 'WORKOS_CLIENT_ID');

  const incoming = new URL(request.url);
  const target = new URL(
    `/sso/${encodeURIComponent(env.WORKOS_CLIENT_ID)}/auth0/callback`,
    `https://${env.WORKOS_CUSTOM_DOMAIN}`,
  );
  target.search = incoming.search;

  return Response.redirect(target.toString(), 307);
}

function proxyToAuth0(request, env, options = {}) {
  assertEnv(env, 'AUTH0_FALLBACK_ORIGIN');

  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname, normalizeOrigin(env.AUTH0_FALLBACK_ORIGIN));
  target.search = incoming.search;

  if (options.stripFallback) {
    target.searchParams.delete(FALLBACK_PARAM);
  }

  return fetch(new Request(target.toString(), request));
}

function normalizeOrigin(origin) {
  const url = new URL(origin);
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function assertEnv(env, key) {
  if (!env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
