// get-artist-stats.js
// Public endpoint — no auth required.
// Returns aggregate community stats for an artist slug.
// Results are cached in publicArtistStats/{slug} for 24 hours.

const { withCors } = require('./lib/cors');
const CORS_HEADERS = {
  'Content-Type': 'application/json',
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function initFirebase() {
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  if (getApps().length > 0) return;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) throw new Error('Firebase env vars not configured');
  initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
}

function slugToArtistName(slug) {
  // Convert "the-rolling-stones" -> "the rolling stones"
  return (slug || '').replace(/-/g, ' ').trim();
}

function artistNameToSlug(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

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

  const slug = (event.queryStringParameters?.slug || '').trim().toLowerCase();
  if (!slug) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing slug parameter' }) };
  }

  try {
    initFirebase();
    const { getFirestore, FieldValue } = require('firebase-admin/firestore');
    const db = getFirestore();

    // Check cache
    const cacheRef = db.collection('publicArtistStats').doc(slug);
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const cached = cacheSnap.data();
      const cachedAt = cached.cachedAt?.toMillis ? cached.cachedAt.toMillis() : 0;
      if (Date.now() - cachedAt < CACHE_TTL_MS) {
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(cached) };
      }
    }

    // Build normalized artist name for matching
    const artistNameNorm = slugToArtistName(slug);

    // Query all shows via collectionGroup — filter by artist (case-insensitive via normalization)
    const showsSnap = await db.collectionGroup('shows').get();

    // Filter client-side since Firestore can't do case-insensitive queries
    const matchingShows = showsSnap.docs
      .map(d => d.data())
      .filter(show => {
        const norm = (show.artist || '').toLowerCase().trim();
        return norm === artistNameNorm || artistNameToSlug(show.artist) === slug;
      });

    if (matchingShows.length === 0) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No shows found for this artist' }) };
    }

    // Aggregate stats
    const userIds = new Set(showsSnap.docs
      .filter(d => {
        const show = d.data();
        const norm = (show.artist || '').toLowerCase().trim();
        return norm === artistNameNorm || artistNameToSlug(show.artist) === slug;
      })
      .map(d => d.ref.parent.parent?.id)
      .filter(Boolean)
    );

    // Song counts
    const songCounts = {};
    for (const show of matchingShows) {
      for (const song of (show.setlist || [])) {
        if (song.name) {
          songCounts[song.name] = (songCounts[song.name] || 0) + 1;
        }
      }
    }
    const topSongs = Object.entries(songCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => ({ name, count }));

    // Recent shows — unique by venue+date, sorted desc
    const seen = new Set();
    const recentShows = [];
    for (const show of [...matchingShows].sort((a, b) => (b.date || '').localeCompare(a.date || ''))) {
      const key = `${(show.venue || '').toLowerCase()}|${show.date}`;
      if (!seen.has(key) && show.venue) {
        seen.add(key);
        recentShows.push({ date: show.date, venue: show.venue, city: show.city || '' });
        if (recentShows.length >= 10) break;
      }
    }

    // Canonical artist name — use the most-common casing from the data
    const nameCounts = {};
    for (const show of matchingShows) {
      const n = (show.artist || '').trim();
      nameCounts[n] = (nameCounts[n] || 0) + 1;
    }
    const artistName = Object.entries(nameCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || slugToArtistName(slug);

    const result = {
      artistName,
      slug,
      showCount: matchingShows.length,
      userCount: userIds.size,
      topSongs,
      recentShows,
      cachedAt: FieldValue.serverTimestamp(),
    };

    // Write cache (fire-and-forget — don't block response)
    cacheRef.set(result).catch(() => {});

    // Replace FieldValue with a plain string for the JSON response
    const response = { ...result, cachedAt: new Date().toISOString() };
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(response) };
  } catch (err) {
    console.error('get-artist-stats error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
