const { withCors } = require('./lib/cors');
const { checkProxyLimit } = require('./lib/proxyLimit');
const { cacheName, cacheable } = require('./lib/cacheGuard');
const https = require('https');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
};

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const USER_AGENT = 'MySetlistsApp/1.0 (show-tracker; contact@mysetlists.net)';

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
    console.warn('[ENRICH CACHE] Firebase init failed:', e.message);
    return null;
  }
}

// --- Promisified HTTPS GET ---

function httpsGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...extraHeaders,
      },
    };
    https.get(url, options, (res) => {
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

// --- Discogs BBCode stripping ---

function stripBBCode(text) {
  if (!text) return null;
  return text
    .replace(/\[url=([^\]]+)\]([^\[]*)\[\/url\]/gi, '$2')
    .replace(/\[a=([^\]]+)\]([^\[]*)\[\/a\]/gi, '$2')
    .replace(/\[b\]([^\[]*)\[\/b\]/gi, '$1')
    .replace(/\[i\]([^\[]*)\[\/i\]/gi, '$1')
    .replace(/\[l=([^\]]+)\]([^\[]*)\[\/l\]/gi, '$2')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- Match selection helpers ---

function pickBestMbMatch(artists, queryName) {
  const norm = queryName.toLowerCase().trim();
  const exact = artists.find(a => a.name.toLowerCase().trim() === norm);
  if (exact) return exact;
  const aliasMatch = artists.find(a =>
    (a.aliases || []).some(al => al.name.toLowerCase().trim() === norm)
  );
  if (aliasMatch) return aliasMatch;
  return artists[0] || null;
}

function pickBestDiscogsMatch(results, queryName) {
  const norm = queryName.toLowerCase().trim();
  const exact = results.find(r => r.title.toLowerCase().trim() === norm);
  return exact || results[0] || null;
}

// --- Data extraction helpers ---

function extractUrls(relations) {
  return (relations || [])
    .filter(r => r.type && r.url && r.url.resource)
    .map(r => ({ type: r.type, url: r.url.resource }))
    .filter((u, i, arr) => arr.findIndex(x => x.url === u.url) === i);
}

function mergeMembers(mbRelations, discogsMembers) {
  const map = new Map();

  for (const rel of (mbRelations || [])) {
    if (rel.type === 'member of band' && rel.artist) {
      const name = rel.artist.name;
      const active = !rel.ended;
      map.set(name.toLowerCase(), { name, active });
    }
  }

  for (const m of (discogsMembers || [])) {
    const key = m.name.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { name: m.name, active: m.active !== false });
    }
  }

  return Array.from(map.values());
}

// --- API pipelines ---

async function fetchMusicBrainz(name) {
  const searchUrl = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(name)}&limit=5&fmt=json`;
  const searchRes = await httpsGet(searchUrl);
  if (searchRes.statusCode !== 200 || !searchRes.body.artists?.length) return null;

  const match = pickBestMbMatch(searchRes.body.artists, name);
  if (!match) return null;

  const lookupUrl = `https://musicbrainz.org/ws/2/artist/${match.id}?inc=aliases+genres+url-rels+artist-rels&fmt=json`;
  const lookupRes = await httpsGet(lookupUrl);
  if (lookupRes.statusCode !== 200) return null;

  const a = lookupRes.body;
  return {
    mbid: a.id,
    name: a.name,
    country: a.country || null,
    activeYears: a['life-span'] ? {
      begin: a['life-span'].begin || null,
      end: a['life-span'].end || null,
      ended: a['life-span'].ended || false,
    } : null,
    genres: (a.genres || []).map(g => g.name),
    relations: a.relations || [],
  };
}

async function fetchDiscogs(name) {
  const token = process.env.DISCOGS_TOKEN;
  const headers = token ? { Authorization: `Discogs token=${token}` } : {};

  const searchUrl = `https://api.discogs.com/database/search?type=artist&q=${encodeURIComponent(name)}&per_page=5`;
  const searchRes = await httpsGet(searchUrl, headers);
  if (searchRes.statusCode !== 200 || !searchRes.body.results?.length) return null;

  const match = pickBestDiscogsMatch(searchRes.body.results, name);
  if (!match) return null;

  const lookupUrl = `https://api.discogs.com/artists/${match.id}`;
  const lookupRes = await httpsGet(lookupUrl, headers);
  if (lookupRes.statusCode !== 200) return null;

  const a = lookupRes.body;
  return {
    discogsId: a.id,
    name: a.name,
    profile: stripBBCode(a.profile),
    image: a.images?.[0]?.uri || a.images?.[0]?.uri150 || null,
    members: (a.members || []).map(m => ({ name: m.name, active: m.active })),
  };
}

// --- Handler ---

exports.handler = async function (event) {
  // OPTIONS preflight
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
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Validated before it becomes part of the cache key (lib/cacheGuard.js).
  const name = cacheName((event.queryStringParameters || {}).name);

  if (!name) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'bad_request' }),
    };
  }

  const cacheKey = `enrich_${name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_')}`;

  try {
    // Check Firestore cache
    const db = getDb();
    if (db) {
      try {
        const snap = await db.collection('artistEnrichCache').doc(cacheKey).get();
        if (snap.exists) {
          const cached = snap.data();
          const cachedAt = cached.cachedAt?.toMillis ? cached.cachedAt.toMillis() : 0;
          if (Date.now() - cachedAt < CACHE_TTL_MS) {
            return {
              statusCode: 200,
              headers: { ...CORS_HEADERS, 'X-Cache': 'HIT' },
              body: cached.response,
            };
          }
        }
      } catch (_) {
        // Cache read failed — continue to APIs
      }
    }

    // A miss reaches MusicBrainz and Discogs: counted against the network's
    // daily `metadata` limit (lib/proxyLimit.js, 5.59.12).
    const refused = await checkProxyLimit(event, 'metadata');
    if (refused) return { ...refused, headers: { ...CORS_HEADERS, ...refused.headers } };

    // Fetch from both sources in parallel
    const [mbResult, discogsResult] = await Promise.allSettled([
      fetchMusicBrainz(name),
      fetchDiscogs(name),
    ]);

    const mb = mbResult.status === 'fulfilled' ? mbResult.value : null;
    const discogs = discogsResult.status === 'fulfilled' ? discogsResult.value : null;

    if (!mb && !discogs) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ found: false, name }),
      };
    }

    // Merge into unified response
    const result = {
      found: true,
      name: mb?.name || discogs?.name || name,
      mbid: mb?.mbid || null,
      country: mb?.country || null,
      activeYears: mb?.activeYears || null,
      genres: mb?.genres || [],
      discogsId: discogs?.discogsId || null,
      profile: discogs?.profile || null,
      image: discogs?.image || null,
      members: mergeMembers(mb?.relations, discogs?.members),
      urls: extractUrls(mb?.relations),
      sources: {
        musicbrainz: !!mb,
        discogs: !!discogs,
      },
    };

    const responseBody = JSON.stringify(result);

    // Fire-and-forget cache write, only when at least one source answered
    // (until 5.59.12 a moment when both were down was cached as "nothing
    // known" for 7 days) and the result is a sane size.
    if (db && (mb || discogs) && cacheable(responseBody)) {
      const { Timestamp } = require('firebase-admin/firestore');
      db.collection('artistEnrichCache').doc(cacheKey).set({
        response: responseBody,
        cachedAt: Timestamp.now(),
        queryName: name,
      }).catch(() => {});
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' },
      body: responseBody,
    };
  } catch (err) {
    console.error('enrich-artist error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'server_error' }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
