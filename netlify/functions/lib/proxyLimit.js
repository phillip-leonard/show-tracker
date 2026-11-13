/**
 * proxyLimit — a per-IP daily limit on the functions that spend a shared
 * third-party API quota (5.59.8, #398 follow-up 2).
 *
 * setlist.fm, Ticketmaster and SeatGeek each give the app ONE key with a
 * daily quota. These proxies answer anyone, without sign-in (the website's
 * search works signed out, and old iOS builds send no token), so a script
 * looping on one of them could use up the quota and break search, setlists
 * and tour dates for every user until the next day. That would be an outage
 * for everyone, not one user's problem.
 *
 * Each request counts against rateLimits/proxy_{service}_ip_{hash}_{day}
 * (lib/rateLimit.js, IP HMAC-hashed and never stored raw). The limits are
 * far above what one person uses in a day, including a large spreadsheet
 * import or a long "find missing setlists" scan, so they only stop
 * automated traffic.
 *
 * Exempt:
 *   - OPTIONS preflights
 *   - our own server-to-server calls (admin-resync-setlists → band-setlist),
 *     which all come from Netlify's IPs. They send X-MySetlists-Internal,
 *     an HMAC of a fixed label under UNSUBSCRIBE_SECRET (internalProxyHeader).
 *
 * Fails open: if Firestore can't be reached, the request goes through. A
 * broken limiter must not take search down with it.
 *
 * Usage, around the handler and inside withCors so a 429 still gets CORS
 * headers:
 *   module.exports.handler = withCors(withProxyLimit('setlists', module.exports.handler));
 */

const crypto = require('crypto');
const { takeDailyQuota, clientIp, ipHash } = require('./rateLimit');

// Per IP per UTC day. A spreadsheet import searches setlist.fm once per
// row (lib/importMatch.js), so `setlists` allows a 1,000-row import with
// room to spare. Each can be changed without a deploy of code by setting
// PROXY_LIMIT_SETLISTS / PROXY_LIMIT_TICKETMASTER / PROXY_LIMIT_SEATGEEK.
const DEFAULT_LIMITS = {
  setlists: 2000,     // setlist.fm and the band sources behind band-setlist
  ticketmaster: 500,
  seatgeek: 500,
};

function limitFor(service) {
  if (!DEFAULT_LIMITS[service]) return 0;
  const env = Number(process.env[`PROXY_LIMIT_${service.toUpperCase()}`]);
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : DEFAULT_LIMITS[service];
}
const PROXY_DAILY_LIMITS = DEFAULT_LIMITS;

const INTERNAL_HEADER = 'x-mysetlists-internal';

function internalProxyToken() {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update('internal-proxy:v1').digest('hex');
}

/** Headers our own functions add when they call a limited proxy. */
function internalProxyHeader() {
  const t = internalProxyToken();
  return t ? { 'X-MySetlists-Internal': t } : {};
}

function isInternalCall(event) {
  const expected = internalProxyToken();
  if (!expected) return false;
  const h = (event && event.headers) || {};
  const key = Object.keys(h).find((k) => k.toLowerCase() === INTERNAL_HEADER);
  const got = key ? String(h[key]) : '';
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

function tooMany(limit) {
  return {
    statusCode: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '3600', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ error: `Too many requests from this network today (limit ${limit}). Try again tomorrow.` }),
  };
}

/**
 * checkProxyLimit(event, service, { db, now }) → null when allowed, or a
 * 429 response.
 */
async function checkProxyLimit(event, service, opts = {}) {
  if (!event || event.httpMethod === 'OPTIONS') return null;
  if (isInternalCall(event)) return null;
  const limit = limitFor(service);
  if (!limit) throw new Error(`proxyLimit: unknown service ${service}`);
  try {
    const db = opts.db || require('./firebaseAdmin').getDb();
    const q = await takeDailyQuota(db, `proxy_${service}_ip_${ipHash(clientIp(event))}`, limit, { now: opts.now });
    if (q.allowed) return null;
    console.warn(`[proxy-limit] ${service} limit reached for an IP (${limit}/day)`);
    return tooMany(limit);
  } catch (e) {
    console.error(`[proxy-limit] ${service} check failed, allowing:`, e.message);
    return null;
  }
}

function withProxyLimit(service, handler, opts = {}) {
  if (!PROXY_DAILY_LIMITS[service]) throw new Error(`proxyLimit: unknown service ${service}`);
  return async function proxyLimited(event, context) {
    const refused = await checkProxyLimit(event, service, opts);
    if (refused) return refused;
    return handler(event, context);
  };
}

module.exports = { withProxyLimit, checkProxyLimit, internalProxyHeader, isInternalCall, limitFor, PROXY_DAILY_LIMITS };
