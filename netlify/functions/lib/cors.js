/**
 * cors — the one CORS policy every function answers with.
 *
 * WHO CALLS US CROSS-ORIGIN. Only the iOS app: Capacitor serves the bundle
 * from capacitor://localhost and lib/api.js prefixes https://mysetlists.net.
 * The website calls relative URLs, so it is same-origin and CORS never
 * applies. That includes Netlify deploy previews, which call their own
 * functions; they need no *.netlify.app entry here.
 *
 * WHAT IT DOES. Echoes the request's Origin only when it is on the list,
 * and never rejects a request because of its Origin. CORS is enforced by
 * the browser: leaving the header out is what stops another website from
 * reading the response. curl, URLSession and server-to-server calls send
 * no Origin and are unaffected, which is why authentication, not CORS, is
 * what protects an endpoint.
 */

const ALLOWED_ORIGINS = [
  'https://mysetlists.net',
  'https://www.mysetlists.net',
  'capacitor://localhost', // the iOS app (capacitor.config.ts sets no iosScheme)
  'http://localhost:3000', // next dev
  'http://localhost:8888', // netlify dev
];

function requestOrigin(event) {
  const h = (event && event.headers) || {};
  return h.origin || h.Origin || '';
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // A deploy preview's own URL, set by Netlify at runtime. Only ever
  // matches the preview itself (same-origin), so this is belt and braces.
  const own = [process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL].filter(Boolean);
  return own.includes(origin);
}

/**
 * corsHeaders(event, { methods, headers, contentType })
 *   methods     — 'GET, OPTIONS' by default
 *   headers     — allowed request headers; Authorization is always included
 *   contentType — the response Content-Type (null to leave it out)
 */
function corsHeaders(event, { methods = 'GET, POST, OPTIONS', headers = 'Content-Type', contentType = 'application/json' } = {}) {
  const allow = new Set(String(headers).split(',').map((s) => s.trim()).filter(Boolean));
  allow.add('Authorization');
  const h = {
    'Access-Control-Allow-Headers': [...allow].join(', '),
    'Access-Control-Allow-Methods': methods,
    Vary: 'Origin',
  };
  if (contentType) h['Content-Type'] = contentType;
  const origin = requestOrigin(event);
  if (isAllowedOrigin(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

/**
 * withCors(handler) — the same policy for a Lambda-style handler that
 * builds its own headers. Whatever Access-Control-Allow-Origin the handler
 * set is dropped; an allowlisted Origin is echoed instead (with Vary:
 * Origin), and any other Origin gets no header at all. The handler's own
 * Allow-Methods / Allow-Headers are kept, with Authorization added.
 *
 * Used by the functions that answered `*` before 5.59.6. New functions
 * should build their headers with corsHeaders(event) directly.
 */
function withCors(handler) {
  return async function corsWrapped(event, context) {
    const res = await handler(event, context);
    if (!res || typeof res !== 'object') return res;
    const headers = {};
    for (const [k, v] of Object.entries(res.headers || {})) {
      if (k.toLowerCase() !== 'access-control-allow-origin') headers[k] = v;
    }
    const allowHeadersKey = Object.keys(headers).find((k) => k.toLowerCase() === 'access-control-allow-headers');
    if (allowHeadersKey && !/authorization/i.test(String(headers[allowHeadersKey]))) {
      headers[allowHeadersKey] = `${headers[allowHeadersKey]}, Authorization`;
    }
    const varyKey = Object.keys(headers).find((k) => k.toLowerCase() === 'vary');
    const vary = varyKey ? String(headers[varyKey]) : '';
    if (varyKey) delete headers[varyKey];
    headers.Vary = /\borigin\b/i.test(vary) ? vary : [vary, 'Origin'].filter(Boolean).join(', ');
    // A CDN-cached response must be cached per Origin, or the copy made
    // for a same-origin web request (no Allow-Origin) would be served to
    // the iOS app and fail CORS there. Netlify's CDN keys on Netlify-Vary,
    // not Vary.
    const cacheKey = Object.keys(headers).find((k) => k.toLowerCase() === 'cache-control');
    if (cacheKey && /public|s-maxage/i.test(String(headers[cacheKey]))) {
      const nvKey = Object.keys(headers).find((k) => k.toLowerCase() === 'netlify-vary');
      const nv = nvKey ? String(headers[nvKey]) : '';
      if (nvKey) delete headers[nvKey];
      headers['Netlify-Vary'] = /header=([^,]*\b)?origin\b/i.test(nv) ? nv : [nv, 'header=Origin'].filter(Boolean).join(',');
    }
    const origin = requestOrigin(event);
    if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin;
    return { ...res, headers };
  };
}

module.exports = { ALLOWED_ORIGINS, corsHeaders, isAllowedOrigin, requestOrigin, withCors };
