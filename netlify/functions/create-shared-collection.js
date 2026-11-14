// create-shared-collection.js
//
//   POST /.netlify/functions/create-shared-collection   Auth: Bearer {idToken}
//     -> { id, url }   a public snapshot at /shared/<id> (public-shared.js)
//
// Since 5.59.12 (#398 follow-ups) the server builds the snapshot itself
// from the caller's own users/{uid}/shows. The app has always shared every
// show, so the result is the same; what changes is that a request can no
// longer put arbitrary text on a public page. The body older builds send
// (shows, stats, ownerName) is ignored.
//
//   - sign-in required (lib/requestAuth.js requireUser)
//   - 5 new collections per user per UTC day (rateLimits/shared_create_
//     {uid}_{day}) and 50 per user in total
//   - at most MAX_SHOWS shows (the most recent), MAX_SONGS songs each,
//     every string length-capped
//   - the owner's name is their Firebase display name, never anything
//     from the request and never their email address (older builds fell
//     back to the part before the @, which then appeared on a public page)

const { withCors } = require('./lib/cors');
const { getDb } = require('./lib/firebaseAdmin');
const { requireUser } = require('./lib/requestAuth');
const { takeDailyQuota } = require('./lib/rateLimit');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DAILY_LIMIT = 5;
const TOTAL_LIMIT = 50;
const MAX_SHOWS = 2000;
const MAX_SONGS = 100;
// Older builds post every show in the body; nothing is read from it.
const MAX_BODY = 4 * 1024 * 1024;

const reply = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...CORS_HEADERS, ...extra }, body: JSON.stringify(body) });
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const rating = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
};

/** The public snapshot of one show: these fields only. */
function publicShow(s) {
  return {
    artist: str(s.artist, 160),
    venue: str(s.venue, 160),
    city: str(s.city, 120),
    date: str(s.date, 10),
    rating: rating(s.rating),
    setlist: (Array.isArray(s.setlist) ? s.setlist : []).slice(0, MAX_SONGS).map((song) => ({
      name: str(song && song.name, 160),
      rating: rating(song && song.rating),
    })).filter((song) => song.name),
  };
}

function statsFor(shows) {
  const rated = shows.filter((s) => s.rating);
  const counts = {};
  shows.forEach((s) => { counts[s.artist] = (counts[s.artist] || 0) + 1; });
  return {
    totalShows: shows.length,
    totalSongs: shows.reduce((n, s) => n + s.setlist.length, 0),
    topArtist: Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
    avgRating: rated.length ? (rated.reduce((n, s) => n + s.rating, 0) / rated.length).toFixed(1) : null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const user = await requireUser(event, CORS_HEADERS);
  if (user.response) return user.response;
  if (String(event.body || '').length > MAX_BODY) return reply(413, { error: 'too_large' });

  try {
    const db = getDb();

    const existing = await db.collection('sharedCollections').where('ownerUid', '==', user.uid).get();
    if (existing.size >= TOTAL_LIMIT) {
      return reply(429, { error: `You can have up to ${TOTAL_LIMIT} shared collections.` });
    }
    const quota = await takeDailyQuota(db, `shared_create_${user.uid}`, DAILY_LIMIT, { uid: user.uid });
    if (!quota.allowed) {
      return reply(429, { error: `You can share your collection up to ${DAILY_LIMIT} times a day. Try again tomorrow.` }, { 'Retry-After': '3600' });
    }

    const snap = await db.collection('users').doc(user.uid).collection('shows').get();
    const shows = snap.docs
      .map((d) => publicShow(d.data()))
      .filter((s) => s.artist)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, MAX_SHOWS);
    if (!shows.length) return reply(400, { error: 'No shows to share yet.' });

    const { FieldValue } = require('firebase-admin/firestore');
    const docRef = await db.collection('sharedCollections').add({
      ownerUid: user.uid,
      ownerName: str(user.name, 80) || 'A Fan',
      shows,
      stats: statsFor(shows),
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: null,
    });

    return reply(200, { id: docRef.id, url: `https://mysetlists.net/shared/${docRef.id}` });
  } catch (error) {
    console.error('create-shared-collection error:', error && error.message);
    return reply(500, { error: 'server_error' });
  }
};

exports.publicShow = publicShow;
exports.LIMITS = { DAILY_LIMIT, TOTAL_LIMIT, MAX_SHOWS, MAX_SONGS };

// CORS allowlist on every response (lib/cors.js).
module.exports.handler = withCors(module.exports.handler);
