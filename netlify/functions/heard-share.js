// netlify/functions/heard-share.js
//
//   POST /api/heard-share  { slug, code }  ->  { ok, id }
//   GET  /api/heard-share?slug=&id=        ->  { ok, code }
//
// Stores a "Songs I've heard" selection too long to put in a link (see
// lib/heardShares.js) and hands it back by id: the GET is for the app's
// sign-up handoff, which needs the code itself. A code is only show dates,
// so nothing stored here is personal, and the GET returns the code alone.
//
// The "Songs I've heard" pages are a public, signed-out tool, so creating
// a share stays anonymous (5.59.12). What keeps it from being a free file
// host is the input rule and a limit (#398 follow-ups):
//   - the body is at most MAX_BODY bytes (413), a JSON object with exactly
//     `slug` and `code` and nothing else, a known band and a code in the
//     stored-code alphabet (400)
//   - 50 stores per network per day (lib/proxyLimit.js `heardshare`, 429)
// The key is a hash of band and code, never chosen by the caller.

const { withCors } = require('./lib/cors');
const { checkProxyLimit } = require('./lib/proxyLimit');
const { findArtist, hasShowList } = require('./lib/publicArtistSnapshot');
const { openShareStore, storeCode, resolveCode, STORED_CODE, STORED_ID, MAX_STORED_CODE } = require('./lib/heardShares');

// The longest stored code, its slug and JSON punctuation, with room to spare.
const MAX_BODY = MAX_STORED_CODE + 4096;
const ALLOWED_FIELDS = new Set(['slug', 'code']);

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (statusCode, body, cache = 'no-store') => ({ statusCode, headers: { ...JSON_HEADERS, 'Cache-Control': cache }, body: JSON.stringify(body) });

const knownBand = (slug) => {
  const artist = /^[a-z0-9-]{1,100}$/.test(slug) && findArtist(slug);
  return !!artist && hasShowList(artist);
};

/** The parsed body when it is exactly { slug, code } as strings, else null. */
function readShareBody(raw) {
  let body;
  try { body = JSON.parse(raw || ''); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (Object.keys(body).some((k) => !ALLOWED_FIELDS.has(k))) return null;
  if (typeof body.slug !== 'string' || typeof body.code !== 'string') return null;
  return { slug: body.slug, code: body.code };
}

async function handler(event, deps = {}) {
  try {
    if (event.httpMethod === 'POST') {
      if (String(event.body || '').length > MAX_BODY) return reply(413, { ok: false, error: 'too_large' });
      const body = readShareBody(event.body);
      const isKnownBand = deps.knownBand || knownBand;
      if (!body || !isKnownBand(body.slug) || !STORED_CODE.test(body.code)) return reply(400, { ok: false, error: 'bad_request' });
      const refused = await checkProxyLimit(event, 'heardshare', deps.limitOpts);
      if (refused) return refused;
      const id = await storeCode(deps.store || openShareStore(event), body.slug, body.code);
      return reply(200, { ok: true, id });
    }

    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      const slug = String(q.slug || '');
      const id = String(q.id || '');
      const isKnownBand = deps.knownBand || knownBand;
      if (!isKnownBand(slug) || !STORED_ID.test(id)) return reply(404, { ok: false, error: 'not_found' });
      const code = await resolveCode(() => deps.store || openShareStore(event), slug, id);
      if (!code) return reply(404, { ok: false, error: 'not_found' });
      // A stored code never changes.
      return reply(200, { ok: true, code }, 'public, max-age=86400, immutable');
    }

    return reply(405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('heard-share error:', err && err.message);
    return reply(500, { ok: false, error: 'server_error' });
  }
}

exports.handler = (event) => handler(event);
exports.handleHeardShare = handler;
exports.readShareBody = readShareBody;
exports.MAX_BODY = MAX_BODY;

// CORS allowlist on every response (lib/cors.js).
module.exports.handler = withCors(module.exports.handler);
