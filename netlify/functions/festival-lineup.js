// netlify/functions/festival-lineup.js
//
// POST { festivalId } with the user's Firebase ID token. Returns the
// festival's lineup for festival picks, fetching it from Ticketmaster first
// when the festival is upcoming and the stored copy is missing or more than a
// day old. What is matched, and the Ticketmaster terms this follows, are in
// lib/festivalLineup.js.
//
// festivalId is the CANONICAL id (festivals/{id}). Only someone attending
// the festival (or the admin) can ask, so the endpoint can't be used to
// drive Ticketmaster calls for arbitrary festivals.
//
// The lineup is written to the canonical document with the Admin SDK.
// firestore.rules lets no client write the lineup fields, so what other
// attendees see is only ever Ticketmaster's data or the admin's lineup
// file (data/festival-lineups.json, 5.58.0), never typed text. A lineup
// from the file is never replaced from Ticketmaster. A lineup
// someone enters by hand stays on their own attendance record.
//
// Since 5.60.36 (Stage 5 call B) the answer also carries the caller's
// picks: the shared lineup, or else the lineup they typed (`myLineup` on
// their attendance record), ranked by lib/recommendations.js
// festivalPicks (lib/festivalPicksServer.js). `picksFrom` says which
// lineup was ranked; picks are null when there is none. A picks failure
// never fails the lineup.
//
//   200 { lineup: [names], source, url, fetchedAt, upcoming,
//         picks: { recommended, love, everyoneElse } | null,
//         picksFrom: 'festival' | 'mine' | null }
//   401 not signed in · 403 not attending · 404 no such festival

const { withCors } = require('./lib/cors');
const { getDb, verifyUser, isAdminClaims, isAnonymous } = require('./lib/firebaseAdmin');
const { httpsGetJson } = require('./lib/ticketmasterEvents');
const { fetchLineup, isUpcoming, isFresh } = require('./lib/festivalLineup');
const { SEED_LINEUP_SOURCE } = require('./lib/festivalLineupSeed');
const { picksFor: defaultPicksFor } = require('./lib/festivalPicksServer');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function view(f, upcoming) {
  const at = f.lineupFetchedAt;
  return {
    lineup: Array.isArray(f.lineup) ? f.lineup : [],
    source: f.lineupSource || null,
    url: f.lineupUrl || null,
    fetchedAt: at && typeof at.toDate === 'function' ? at.toDate().toISOString() : at || null,
    upcoming,
  };
}

async function handle(event, { db, get = httpsGetJson, apiKey = process.env.TICKETMASTER_API_KEY, now = Date.now(), picksFor = defaultPicksFor } = {}) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  const claims = await verifyUser(event);
  if (!claims) return reply(401, { error: 'Sign in to see festival picks.' });
  // Festival picks are v1.x and account-only (5.60.13).
  if (isAnonymous(claims)) return reply(403, { error: 'Create an account to see festival picks.', code: 'account_required' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* empty */ }
  const festivalId = String(body.festivalId || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(festivalId)) return reply(400, { error: 'festivalId required' });

  const ref = db.collection('festivals').doc(festivalId);
  const snap = await ref.get();
  if (!snap.exists) return reply(404, { error: 'No such festival' });
  const festival = snap.data();

  const mine = await db.collection('users').doc(claims.uid).collection('festivals')
    .where('festivalId', '==', festivalId).limit(1).get();
  if (mine.empty && !isAdminClaims(claims)) return reply(403, { error: 'Join this festival to see its lineup.' });
  const myLineup = !mine.empty && Array.isArray(mine.docs[0].data().myLineup) ? mine.docs[0].data().myLineup : [];

  // The lineup view plus the caller's picks of it.
  const answer = async (f) => {
    const out = view(f, upcoming);
    const ranked = out.lineup.length ? out.lineup : myLineup;
    out.picks = null;
    out.picksFrom = null;
    if (ranked.length) {
      try {
        out.picks = await picksFor(db, claims.uid, ranked);
        out.picksFrom = out.lineup.length ? 'festival' : 'mine';
      } catch (err) {
        console.warn('[festivalLineup] picks failed', festivalId, err && err.message);
      }
    }
    return reply(200, out);
  };

  const upcoming = isUpcoming(festival, now);
  if (!upcoming || isFresh(festival, now) || !apiKey) return answer(festival);

  // A lineup from data/festival-lineups.json (lineupSource 'seed', written
  // by admin-seed-festival-lineups.js) is the one we chose, so Ticketmaster
  // never replaces it. The admin replaces it by editing the file and
  // running the seeder again.
  if (festival.lineupSource === SEED_LINEUP_SOURCE) return answer(festival);

  // No dates (added with only a year, 5.58.0): there is no window to search
  // Ticketmaster in, so there is nothing to ask it.
  if (!festival.startDate) return answer(festival);

  let found;
  try {
    found = await fetchLineup(festival, { apiKey, get });
  } catch (err) {
    console.warn('[festivalLineup] Ticketmaster lookup failed', festivalId, err.message);
    return answer(festival);
  }

  const fetchedAt = new Date(now);
  // Nothing found keeps any lineup already stored (Ticketmaster can drop an
  // event before the festival) but still records the check, so the next
  // visitor today doesn't ask again.
  const update = found
    ? { lineup: found.lineup, lineupSource: 'ticketmaster', lineupUrl: found.url, lineupFetchedAt: fetchedAt }
    : { lineupFetchedAt: fetchedAt };
  await ref.set(update, { merge: true });
  return answer({ ...festival, ...update });
}

exports.handler = async function (event) {
  try {
    return await handle(event, { db: getDb() });
  } catch (err) {
    console.error('[festivalLineup] failed', err && err.stack ? err.stack : err);
    return reply(500, { error: "Couldn't load the lineup." });
  }
};
exports.handle = handle;

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
