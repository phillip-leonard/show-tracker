/**
 * setlist-source — where a band's setlists come from, and the re-sync
 * control the show page should offer (5.60.22, native Stage 1).
 *
 *   GET /.netlify/functions/setlist-source?artist=<name>[&mbid=<id>][&setlistSource=<id>]
 *
 *   artist         the band's name as stored on the show (required, ≤200)
 *   mbid           the show's artistMbid, when it has one
 *   setlistSource  the show's stored setlistSource, so the label can say
 *                  "Re-fetch" or "Get setlist" and `stored` can credit it
 *
 *   200 {
 *     ok: true,
 *     artist,
 *     source: { id, label, homeUrl, isBandSource, requiresReview, matchedOn },
 *     resync: { offered, action: 'resync'|'review'|null, label, busyLabel, hint },
 *     stored?: { id, label, homeUrl }      // only with setlistSource
 *   }
 *   400 { ok: false, error }   405 { ok: false, error }
 *
 * Read-only and public: no sign-in, so guests (and anyone) can ask. It
 * reads only the band registry built from config/ (lib/setlistSources.js),
 * spends no third-party quota and writes nothing, so it needs no proxy
 * limit. The answer changes only with a deploy, so it is cacheable.
 *
 * The answer itself is lib/setlistSourceAnswer.js; tests in
 * tests/setlists/setlistSource.test.js.
 */

const { corsHeaders } = require('./lib/cors');
const { readSetlistSourceRequest, setlistSourceAnswer } = require('../../lib/setlistSourceAnswer');

// An hour in the browser and at the CDN, then a day of serving the old
// answer while a fresh one is fetched. A deploy replaces the function, and
// the registry with it.
const CACHE = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400';

exports.handler = async function (event) {
  const headers = corsHeaders(event, { methods: 'GET, OPTIONS' });
  const reply = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...headers, ...extra }, body: JSON.stringify(body) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return reply(405, { ok: false, error: 'method_not_allowed' });

  const req = readSetlistSourceRequest(event.queryStringParameters || {});
  if (!req.ok) return reply(400, { ok: false, error: req.error }, { 'Cache-Control': 'no-store' });

  return reply(200, setlistSourceAnswer(req), { 'Cache-Control': CACHE });
};
