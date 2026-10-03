const https = require('https');
const crypto = require('crypto');

const SETLISTFM_API_KEY = process.env.SETLISTFM_API_KEY || 'VmDr8STg4UbyNE7Jgiubx2D_ojbliDuoYMgQ';
const CORS_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

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
    console.warn('[CACHE] Firebase init failed:', e.message);
    return null;
  }
}

// --- Cache helpers ---

function buildCacheKey(artistName, artistMbid, year, venueName, cityName, page) {
  const normalized = JSON.stringify({
    a: artistMbid ? `mbid:${artistMbid}` : (artistName || '').toLowerCase().trim(),
    y: (year || '').trim(),
    v: (venueName || '').toLowerCase().trim(),
    c: (cityName || '').toLowerCase().trim(),
    p: String(page || '1'),
  });
  return crypto.createHash('md5').update(normalized).digest('hex');
}

// Returns TTL in hours based on the dates of shows in the result set.
function determineTtlHours(setlists) {
  if (!setlists || setlists.length === 0) return 1;
  const now = new Date();
  const dates = setlists
    .map(s => {
      if (!s.eventDate) return null;
      const [dd, mm, yyyy] = s.eventDate.split('-');
      const d = new Date(`${yyyy}-${mm}-${dd}`);
      return isNaN(d.getTime()) ? null : d;
    })
    .filter(Boolean);
  if (dates.length === 0) return 1;
  if (dates.some(d => d > now)) return 1;                              // has upcoming show
  const newest = new Date(Math.max(...dates.map(d => d.getTime())));
  const monthsAgo = (now - newest) / (1000 * 60 * 60 * 24 * 30);
  if (monthsAgo < 6) return 6;
  if (monthsAgo < 24) return 24;
  return 168; // 7 days for older shows
}

// --- Setlist.fm API call (promisified) ---

function fetchFromSetlistFm(params) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.setlist.fm',
      path: `/rest/1.0/search/setlists?${params.toString()}`,
      method: 'GET',
      headers: {
        'x-api-key': SETLISTFM_API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'ShowTrackerApp/1.0',
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`Failed to parse Setlist.fm response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// --- Handler ---

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { artistName, artistMbid, year, venueName, cityName, p } = event.queryStringParameters || {};

  // An artist is optional: a venue or a city on its own is a real search
  // ("every show at Red Rocks in 2024"). A year on its own is not — that
  // is every show on setlist.fm for twelve months.
  if (!artistName && !artistMbid && !venueName && !cityName) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'An artist, venue or city is required' }) };
  }

  const params = new URLSearchParams({ p: p || '1' });
  // Use artistMbid for exact artist match if available, otherwise fall back to artistName
  if (artistMbid) {
    params.set('artistMbid', artistMbid);
  } else if (artistName) {
    params.set('artistName', artistName);
  }
  if (year) params.set('year', year);
  if (venueName) params.set('venueName', venueName);
  if (cityName) params.set('cityName', cityName);

  const artistLabel = artistMbid
    ? `mbid:${artistMbid}`
    : (artistName || `venue:${venueName || ''} city:${cityName || ''}`);
  const cacheKey = buildCacheKey(artistName, artistMbid, year, venueName, cityName, p);
  const db = getDb();
  let staleDoc = null;

  // 1. Check cache
  if (db) {
    try {
      const snap = await db.collection('setlistCache').doc(cacheKey).get();
      if (snap.exists) {
        const cached = snap.data();
        const expired = (cached.expiresAt?.toMillis?.() || 0) < Date.now();
        if (!expired) {
          const newHits = (cached.hitCount || 0) + 1;
          console.log(`[CACHE HIT]  ${artistLabel} p${p || 1} — hits: ${newHits}, ttl: ${cached.ttlHours}h`);
          snap.ref.update({ hitCount: newHits }).catch(() => {});
          return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'HIT' }, body: cached.response };
        }
        console.log(`[CACHE EXPIRED] ${artistLabel} p${p || 1}`);
        staleDoc = cached; // hold onto stale data for API failure fallback
      } else {
        console.log(`[CACHE MISS] ${artistLabel} p${p || 1}`);
      }
    } catch (e) {
      console.warn('[CACHE] Read error:', e.message);
    }
  }

  // 2. Fetch from Setlist.fm
  try {
    const { statusCode, data } = await fetchFromSetlistFm(params);
    const responseBody = JSON.stringify(data);

    // 3. Write to cache on success
    if (db && statusCode === 200 && data.setlist) {
      const ttlHours = determineTtlHours(data.setlist);
      const { Timestamp } = require('firebase-admin/firestore');
      db.collection('setlistCache').doc(cacheKey).set({
        response: responseBody,
        fetchedAt: Timestamp.now(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + ttlHours * 3600 * 1000)),
        ttlHours,
        queryParams: {
          artistName: artistMbid ? '' : (artistName || '').toLowerCase().trim(),
          artistMbid: artistMbid || '',
          year: year || '',
          venueName: venueName || '',
          cityName: cityName || '',
          page: p || '1',
        },
        hitCount: 0,
      }).then(() => {
        console.log(`[CACHE WRITE] ${artistLabel} p${p || 1} → TTL: ${ttlHours}h`);
      }).catch(e => {
        console.warn('[CACHE] Write error:', e.message);
      });
    }

    return { statusCode, headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' }, body: responseBody };
  } catch (e) {
    // 4. API failure — serve stale cache if available
    if (staleDoc) {
      const ageHours = Math.round((Date.now() - (staleDoc.fetchedAt?.toMillis?.() || 0)) / 3600000);
      console.log(`[CACHE STALE] ${artistLabel} p${p || 1} — API down, serving stale (age: ${ageHours}h)`);
      return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'STALE' }, body: staleDoc.response };
    }
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Request failed', details: e.message }) };
  }
};
