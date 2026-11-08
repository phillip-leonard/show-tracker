/**
 * resolve-artist — finds and caches a band's Ticketmaster attraction id when
 * someone follows it. The app calls this just after writing the follow and
 * doesn't wait for it: the scan backfills any band this missed.
 *
 * POST { artistName }  Auth: Bearer {idToken}. Only for a band the caller
 * follows, so a signed-in client can't fill artists/ with whatever it likes.
 */

const { getDb, verifyUser } = require('./lib/firebaseAdmin');
const { artistKey, ledgerId } = require('./lib/followedBandAlerts');
const { resolveAttraction } = require('./lib/ticketmasterEvents');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  const decoded = await verifyUser(event);
  if (!decoded) return reply(401, { error: 'Unauthorized' });

  let name = '';
  try { name = String(JSON.parse(event.body || '{}').artistName || '').trim(); } catch { /* no body */ }
  const key = artistKey(name);
  if (!key || key.length > 200) return reply(400, { error: 'artistName is required' });

  try {
    const db = getDb();
    const profile = await db.collection('userProfiles').doc(decoded.uid).get();
    const follows = profile.data()?.favoriteArtists || [];
    if (!follows.some((f) => artistKey(f?.name) === key)) return reply(403, { error: 'Not a band you follow' });

    const ref = db.collection('artists').doc(ledgerId(key));
    const artist = (await ref.get()).data();
    if (artist?.ticketmasterAttractionId) return reply(200, { resolved: true });

    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey) return reply(200, { resolved: false });

    const get = async (url) => {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      return { statusCode: res.status, body: await res.json() };
    };
    const { id, confidence } = await resolveAttraction(name, apiKey, get);
    const update = { name: artist?.name || name, artistKey: key, attractionCheckedAtMs: Date.now() };
    if (id) {
      update.ticketmasterAttractionId = id;
      update.attractionConfidence = confidence;
      if (confidence === 'low') console.warn('[resolve-artist] low-confidence attraction match', name, id);
    }
    await ref.set(update, { merge: true });
    return reply(200, { resolved: !!id });
  } catch (err) {
    console.warn('[resolve-artist] failed', name, err.message);
    return reply(200, { resolved: false });
  }
};
