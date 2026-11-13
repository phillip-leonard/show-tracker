// netlify/functions/archival-audio-lookup.js
//
// Looks up archival recordings of a logged show on Relisten
// (https://api.relisten.net), which aggregates the Internet Archive's Live
// Music Archive and phish.in (and others) behind one API and one artist
// list — verified directly against the live API and against
// RelistenNet/RelistenApi's ShowsController.cs source, not assumed from
// memory:
//   - GET /api/v3/artists                          -> full artist list (slug, name, uuid)
//   - GET /api/v2/artists/{slug}/shows/{YYYY-MM-DD} -> { sources: [...] } or a 404-shaped
//                                                       { success: false, error_code: 404 }
//
// Join key is artist + exact date, per the source data's own identity —
// venue is deliberately not part of the lookup key (venue names differ
// wildly between the app's data and Relisten's, and would just produce
// false negatives).
//
// Mirrors netlify/functions/enrich-artist.js's structure: lazy Firebase
// Admin init (graceful no-op if env vars are missing), a promisified
// httpsGet with a descriptive User-Agent, and a Firestore cache read/write
// around the actual API call — never called from the client directly.
//
// Two separate caches, per the different things being cached:
//   - archivalAudioArtistMap/{artistKey}  — app artist name -> Relisten slug
//     (or null if not carried at all), resolved once and cached long-term
//     since Relisten's artist roster changes rarely.
//   - archivalAudioShowCache/{slug}_{date} — recordings for one show, short
//     TTL for a negative result (an artist could be added/backfilled later)
//     and a much longer TTL for a positive one (a 1977 show's recordings
//     aren't going to change).
//
// Neither collection holds personal data — no userId, no show data beyond
// public artist/date — and both are written only by this function via
// firebase-admin (which bypasses Firestore security rules entirely), so no
// rules change is needed, same as artistEnrichCache.

const { withCors } = require('./lib/cors');
const https = require('https');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
};

const ARTIST_MAP_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — the roster rarely changes
const NEGATIVE_SHOW_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — could get backfilled
const POSITIVE_SHOW_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days — a past show's recordings don't change
const USER_AGENT = 'MySetlistsApp/1.0 (https://mysetlists.net; contact@mysetlists.net)';

// --- Firebase Admin (lazy init, graceful degradation if env vars missing) ---

function getDb() {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) return null;
  try {
    const { getApps, initializeApp, cert } = require('firebase-admin/app');
    if (!getApps().length) {
      initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
    }
    const { getFirestore } = require('firebase-admin/firestore');
    return getFirestore();
  } catch (e) {
    console.warn('[ARCHIVAL AUDIO] Firebase init failed:', e.message);
    return null;
  }
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function artistKeyFor(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
}

// --- Artist slug resolution (cached separately, longer) ────────────────

async function resolveArtistSlug(db, artistName) {
  const key = artistKeyFor(artistName);

  if (db) {
    try {
      const snap = await db.collection('archivalAudioArtistMap').doc(key).get();
      if (snap.exists) {
        const cached = snap.data();
        const cachedAt = cached.resolvedAt?.toMillis ? cached.resolvedAt.toMillis() : 0;
        if (Date.now() - cachedAt < ARTIST_MAP_TTL_MS) {
          return cached.relistenSlug || null;
        }
      }
    } catch (_) {
      // Cache read failed — fall through to a live lookup
    }
  }

  let relistenSlug = null;
  try {
    const res = await httpsGetJson('https://api.relisten.net/api/v3/artists');
    if (res.statusCode === 200 && Array.isArray(res.body)) {
      const target = artistName.toLowerCase().trim();
      const match = res.body.find(a => (a.name || '').toLowerCase().trim() === target)
        || res.body.find(a => (a.slug || '').toLowerCase() === target.replace(/\s+/g, '-'));
      relistenSlug = match?.slug || null;
    }
  } catch (_) {
    // Network/API failure — treat as "not resolvable right now", not cached
    // as a negative, so a transient outage doesn't get baked in for 90 days.
    return null;
  }

  if (db) {
    const { Timestamp } = require('firebase-admin/firestore');
    db.collection('archivalAudioArtistMap').doc(key).set({
      artistName,
      relistenSlug,
      resolvedAt: Timestamp.now(),
    }).catch(() => {});
  }

  return relistenSlug;
}

// --- Recording normalization ────────────────────────────────────────────

function normalizeSource(source) {
  const primaryLink = (source.links || []).find(l => l.for_source) || (source.links || [])[0] || null;
  return {
    id: source.uuid,
    label: source.source || (source.is_soundboard ? 'Soundboard' : null) || 'Recording',
    isSoundboard: !!source.is_soundboard,
    taper: source.taper || null,
    transferrer: source.transferrer || null,
    lineage: source.lineage || null,
    avgRating: typeof source.avg_rating === 'number' ? Math.round(source.avg_rating * 10) / 10 : null,
    numReviews: source.num_reviews || 0,
    url: primaryLink?.url || null,
    linkLabel: primaryLink?.label || 'Listen',
  };
}

// --- Show lookup (cached) ────────────────────────────────────────────────

async function lookupShow(db, relistenSlug, date) {
  const cacheKey = `${relistenSlug}_${date}`;

  if (db) {
    try {
      const snap = await db.collection('archivalAudioShowCache').doc(cacheKey).get();
      if (snap.exists) {
        const cached = snap.data();
        const cachedAt = cached.cachedAt?.toMillis ? cached.cachedAt.toMillis() : 0;
        const ttl = cached.found ? POSITIVE_SHOW_TTL_MS : NEGATIVE_SHOW_TTL_MS;
        if (Date.now() - cachedAt < ttl) {
          return { found: cached.found, recordings: cached.recordings || [] };
        }
      }
    } catch (_) {
      // Cache read failed — fall through to a live lookup
    }
  }

  let result;
  try {
    const res = await httpsGetJson(`https://api.relisten.net/api/v2/artists/${relistenSlug}/shows/${date}`);
    if (res.statusCode === 200 && Array.isArray(res.body?.sources) && res.body.sources.length > 0) {
      result = { found: true, recordings: res.body.sources.map(normalizeSource) };
    } else {
      result = { found: false, recordings: [] };
    }
  } catch (_) {
    // API unreachable — degrade to "not found" rather than surfacing an
    // error, and don't cache it (a transient outage shouldn't look like a
    // 7-day negative result).
    return { found: false, recordings: [] };
  }

  if (db) {
    const { Timestamp } = require('firebase-admin/firestore');
    db.collection('archivalAudioShowCache').doc(cacheKey).set({
      ...result,
      cachedAt: Timestamp.now(),
    }).catch(() => {});
  }

  return result;
}

// --- Handler ─────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...CORS_HEADERS,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { artist, date } = event.queryStringParameters || {};
  if (!artist || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing or invalid artist/date parameter' }) };
  }

  try {
    const db = getDb();
    const relistenSlug = await resolveArtistSlug(db, artist);

    if (!relistenSlug) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ found: false, reason: 'artist_not_carried' }),
      };
    }

    const result = await lookupShow(db, relistenSlug, date);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('archival-audio-lookup error:', err);
    // Degrade to the no-audio state rather than surfacing an error — a
    // source being down shouldn't read as a broken feature.
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ found: false }) };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
