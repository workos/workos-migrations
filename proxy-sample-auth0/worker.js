/**
 * Auth0 -> WorkOS enterprise SSO callback proxy.
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
 */

const CALLBACK_PATH = '/login/callback';
const FALLBACK_PARAM = 'fallback';
const FALLBACK_VALUE = 'auth0';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== CALLBACK_PATH) {
      return proxyToAuth0(request, env);
    }

    if (url.searchParams.get(FALLBACK_PARAM) === FALLBACK_VALUE) {
      return proxyToAuth0(request, env, { stripFallback: true });
    }

    return redirectToWorkOS(request, env);
  },
};

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
