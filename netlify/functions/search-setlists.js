const https = require('https');
const crypto = require('crypto');
const { setlistfmKey, missingSetlistfmKey } = require('./lib/setlistfmKey');
const { readFresh, writeEntry } = require('./lib/setlistCache');

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

// `date` is added to the key only when given, so every key written before
// it existed still names the same query.
function buildCacheKey(artistName, artistMbid, year, venueName, cityName, page, date) {
  const normalized = JSON.stringify({
    a: artistMbid ? `mbid:${artistMbid}` : (artistName || '').toLowerCase().trim(),
    y: (year || '').trim(),
    v: (venueName || '').toLowerCase().trim(),
    c: (cityName || '').toLowerCase().trim(),
    p: String(page || '1'),
    ...(date ? { d: date } : {}),
  });
  return crypto.createHash('md5').update(normalized).digest('hex');
}

// Returns TTL in hours based on the dates of shows in the result set.
// lib/setlistCache.js holds every entry to 24 hours at most (setlist.fm's
// terms allow caching "for short periods"); results with an upcoming or
// recent show expire sooner, since those are the setlists still changing.
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
  return 24;
}

// --- Setlist.fm API call (promisified) ---

function fetchFromSetlistFm(params) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.setlist.fm',
      path: `/rest/1.0/search/setlists?${params.toString()}`,
      method: 'GET',
      headers: {
        'x-api-key': setlistfmKey(),
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
  const missingKey = missingSetlistfmKey();
  if (missingKey) return missingKey;

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { artistName, artistMbid, year, venueName, cityName, p } = event.queryStringParameters || {};
  // One day, YYYY-MM-DD (the spreadsheet import matches a row with it).
  // setlist.fm takes dd-MM-yyyy.
  const rawDate = (event.queryStringParameters || {}).date;
  const dateMatch = rawDate ? String(rawDate).match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (rawDate && !dateMatch) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'date must be YYYY-MM-DD' }) };
  }
  const date = dateMatch ? rawDate : '';

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
  if (dateMatch) params.set('date', `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`);

  const artistLabel = artistMbid
    ? `mbid:${artistMbid}`
    : (artistName || `venue:${venueName || ''} city:${cityName || ''}`);
  const cacheKey = buildCacheKey(artistName, artistMbid, year, venueName, cityName, p, date);
  const db = getDb();

  // 1. Check cache. An expired entry is a miss, never a fallback: see
  // lib/setlistCache.js.
  const cached = await readFresh(db, cacheKey);
  if (cached) {
    console.log(`[CACHE HIT]  ${artistLabel} p${p || 1} — ttl: ${cached.ttlHours}h`);
    return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'HIT' }, body: cached.response };
  }

  // 2. Fetch from Setlist.fm
  try {
    const { statusCode, data } = await fetchFromSetlistFm(params);
    const responseBody = JSON.stringify(data);

    // 3. Write to cache on success
    if (statusCode === 200 && data.setlist) {
      const ttlHours = determineTtlHours(data.setlist);
      writeEntry(db, cacheKey, {
        response: responseBody,
        ttlHours,
        queryParams: {
          artistName: artistMbid ? '' : (artistName || '').toLowerCase().trim(),
          artistMbid: artistMbid || '',
          year: year || '',
          venueName: venueName || '',
          cityName: cityName || '',
          page: p || '1',
          date,
        },
      }).then(() => console.log(`[CACHE WRITE] ${artistLabel} p${p || 1} → TTL: ${ttlHours}h`));
    }

    return { statusCode, headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' }, body: responseBody };
  } catch (e) {
    return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'upstream_error', message: "Couldn't reach setlist.fm. Try again in a moment.", details: e.message }) };
  }
};
