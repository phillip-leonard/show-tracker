// netlify/functions/my-poster.js
//
//   POST /api/my-poster  { action: 'image', kind: 'feed'|'story', record }
//                        -> image/png, drawn and stored nowhere
//   POST /api/my-poster  { action: 'share', record }
//                        -> { ok, code, url }, the record stored for /p/<code>/
//
// For the personal posters (lib/myPosters.js, /my-poster/ in the app).
// Signed-in users only: a Firebase ID token in Authorization. The record
// is cleaned by heardRecord.js's cleanPersonalRecord before it is drawn or
// stored, so only its listed fields survive; the token's uid is checked
// and never stored.
//
// CORS is open: the iOS app calls this from capacitor://localhost.
//
// The same two actions draw and share a Year in Review recap when the body
// carries `recap` instead of `record` (lib/yearRecapCard.js):
//   { action: 'image', kind, recap, buddyUid?, buddyShows? } -> image/png
//   { action: 'share', recap, buddyUid?, buddyShows? }       -> { ok, code, url }
// The show buddy's first name is added here, from Firestore, only for a
// friend of the caller whose profile is public; never from the request.

const { withCors } = require('./lib/cors');
const heard = require('./lib/heardRecord');
const { render } = require('./lib/posterImage');
const { verifyUser, getDb } = require('./lib/firebaseAdmin');
const { openPosterStore, storeRecord, storeRecap, posterPath } = require('./lib/myPosters');
const { withBuddy, firestoreBuddyLookup, recapSvg } = require('./lib/yearRecapCard');
const { SITE_URL } = require('./lib/publicPageHtml');

const CORS = {
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const IMAGE_KINDS = new Set(['feed', 'story']);
// Every song a long-time fan has heard, as JSON, is well under this.
const MAX_BODY = 512 * 1024;

const reply = (statusCode, body) => ({
  statusCode,
  headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });

  try {
    const decoded = await verifyUser(event);
    if (!decoded) return reply(401, { ok: false, error: 'sign_in' });
    if ((event.body || '').length > MAX_BODY) return reply(413, { ok: false, error: 'too_large' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { ok: false, error: 'bad_request' }); }

    if (body && body.recap) return await handleRecap(event, body, decoded);

    const record = heard.cleanPersonalRecord(body && body.record);
    if (!record) return reply(400, { ok: false, error: 'bad_request' });

    if (body.action === 'image') {
      if (!IMAGE_KINDS.has(body.kind)) return reply(400, { ok: false, error: 'bad_request' });
      const png = render(heard.posterSvg(heard.personalData(record), record, body.kind));
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
        body: png.toString('base64'),
        isBase64Encoded: true,
      };
    }

    if (body.action === 'share') {
      const code = await storeRecord(openPosterStore(event), record);
      return reply(200, { ok: true, code, url: `${SITE_URL}${posterPath(code)}` });
    }

    return reply(400, { ok: false, error: 'bad_request' });
  } catch (err) {
    console.error('my-poster error:', err);
    return reply(500, { ok: false, error: 'server_error' });
  }
};

async function handleRecap(event, body, decoded) {
  let lookup = null;
  if (body.buddyUid) {
    try { lookup = firestoreBuddyLookup(getDb()); } catch { lookup = null; }
  }
  let recap;
  try {
    recap = await withBuddy(body.recap, { uid: decoded.uid, buddyUid: body.buddyUid, buddyShows: body.buddyShows }, lookup);
  } catch (err) {
    // A failed buddy lookup leaves the buddy off; it never fails the card.
    console.error('my-poster recap buddy lookup failed:', err);
    recap = await withBuddy(body.recap, {}, null);
  }
  if (!recap) return reply(400, { ok: false, error: 'bad_request' });

  if (body.action === 'image') {
    if (!IMAGE_KINDS.has(body.kind)) return reply(400, { ok: false, error: 'bad_request' });
    const png = render(recapSvg(recap, body.kind));
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
      body: png.toString('base64'),
      isBase64Encoded: true,
    };
  }
  if (body.action === 'share') {
    const code = await storeRecap(openPosterStore(event), recap);
    return reply(200, { ok: true, code, url: `${SITE_URL}${posterPath(code)}` });
  }
  return reply(400, { ok: false, error: 'bad_request' });
}

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
