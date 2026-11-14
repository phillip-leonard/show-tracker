const { withCors } = require('./lib/cors');
const { checkProxyLimit } = require('./lib/proxyLimit');
const { cacheName, cacheable } = require('./lib/cacheGuard');
const https = require('https');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
};

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Known cases where a direct title match resolves to something else entirely
// (not even a disambiguation page — Wikipedia just has an unrelated primary
// topic at that title) and the general search-based fallback below, while it
// should catch these too, is worth pinning down explicitly. Keys are
// lowercased artist names.
const ARTIST_TITLE_OVERRIDES = {
  goose: 'Goose (American band)', // direct title match otherwise lands on the bird
};

// Wikipedia's short description (Wikidata-derived) is a reliable, cheap
// signal for "is this actually a musical act" — real band/artist pages
// consistently say things like "American rock band" or "British singer",
// while a same-titled non-band page won't mention any of this vocabulary.
const MUSICAL_ACT_DESCRIPTION_RE = /\b(band|musician|singer|rapper|songwriter|duo|trio|quartet|group|orchestra|ensemble|composer|dj|producer|rock|pop|jazz|folk|metal|hip.?hop)\b/i;

function looksLikeMusicalAct(description) {
  return !!description && MUSICAL_ACT_DESCRIPTION_RE.test(description);
}

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
    console.warn('[WIKI CACHE] Firebase init failed:', e.message);
    return null;
  }
}

// --- Promisified HTTPS GET ---

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'MySetlistsApp/1.0 (show-tracker; contact@mysetlists.net)',
      },
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`Failed to parse Wikipedia response: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// --- Wikipedia lookups ---

async function fetchSummary(title) {
  const encodedTitle = encodeURIComponent(title.trim().replace(/\s+/g, '_'));
  const { statusCode, body } = await httpsGet(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`);
  return { statusCode, body, title };
}

// Full-text search, used only as a fallback when the direct title match is
// wrong or ambiguous — returns candidate page titles ranked by relevance.
async function searchWikipedia(term) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(term)}`;
  try {
    const { statusCode, body } = await httpsGet(url);
    if (statusCode !== 200) return [];
    return (body?.query?.search || []).map((r) => r.title);
  } catch {
    return [];
  }
}

// Resolves an artist name to the summary of its actual musical-act page.
// Direct title matches work for the vast majority of artists, but a name
// that collides with a more common word or topic (Goose the jam band vs.
// Goose the bird; Kiss the band vs. the act of kissing; Rush's disambiguation
// page) needs a second pass: search Wikipedia and pick the first result
// whose short description actually reads like a musical act.
async function resolveArtistSummary(name) {
  const overrideTitle = ARTIST_TITLE_OVERRIDES[name.trim().toLowerCase()];
  const direct = await fetchSummary(overrideTitle || name);

  if (overrideTitle) return direct;

  const isDisambiguation = direct.statusCode === 200 && direct.body?.type === 'disambiguation';
  const isMissing = direct.statusCode === 404;
  const isWrongTopic = direct.statusCode === 200 && !isDisambiguation && !looksLikeMusicalAct(direct.body?.description);

  if (!isDisambiguation && !isMissing && !isWrongTopic) return direct;

  const candidates = await searchWikipedia(`${name} band`);
  for (const candidateTitle of candidates) {
    if (candidateTitle.toLowerCase() === name.trim().toLowerCase()) continue; // already tried above
    const candidate = await fetchSummary(candidateTitle);
    if (candidate.statusCode === 200 && candidate.body?.type !== 'disambiguation' && looksLikeMusicalAct(candidate.body?.description)) {
      return candidate;
    }
  }

  // No better candidate found — fall back to the original direct match
  // (still surfaces *something*, e.g. for genuinely obscure/unmatched artists).
  return direct;
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

  // Method validation
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Parameter extraction. The name is validated before it becomes part of
  // the cache key (lib/cacheGuard.js, 5.59.12).
  const { type } = event.queryStringParameters || {};
  const name = cacheName((event.queryStringParameters || {}).name);

  if (!name || (type && type !== 'artist' && type !== 'venue')) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'bad_request' }),
    };
  }

  // Build cache key
  const cacheKey = `wiki_${(type || 'entity')}_${name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_')}`;

  try {
    // Check Firestore cache
    const db = getDb();
    if (db) {
      try {
        const snap = await db.collection('wikiCache').doc(cacheKey).get();
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
        // Cache read failed — continue to Wikipedia
      }
    }

    // A miss reaches Wikipedia: counted against the network's daily
    // `metadata` limit (lib/proxyLimit.js).
    const refused = await checkProxyLimit(event, 'metadata');
    if (refused) return { ...refused, headers: { ...CORS_HEADERS, ...refused.headers } };

    // Artists get the collision-aware resolver (a same-titled non-band page
    // or disambiguation page triggers a search-based second pass); venues
    // keep the plain direct title match.
    const { statusCode, body, title: resolvedTitle } = type === 'artist'
      ? await resolveArtistSummary(name)
      : await fetchSummary(name);
    const wikiTitle = encodeURIComponent(resolvedTitle.trim().replace(/\s+/g, '_'));

    // No Wikipedia article found
    if (statusCode === 404) {
      const notFound = { found: false, name, type: type || 'entity' };
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(notFound),
      };
    }

    if (statusCode !== 200) {
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'upstream_error' }),
      };
    }

    // Handle disambiguation pages (still possible if the artist fallback
    // above found nothing better than the original ambiguous match)
    if (body.type === 'disambiguation') {
      const disambiguation = { found: false, disambiguation: true, name, type: type || 'entity' };
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(disambiguation),
      };
    }

    // Shape the response to only what the frontend needs
    const result = {
      found: true,
      name: body.title || name,
      type: type || 'entity',
      summary: body.extract || '',
      description: body.description || '',
      image: body.thumbnail?.source || null,
      imageWidth: body.thumbnail?.width || null,
      imageHeight: body.thumbnail?.height || null,
      url: body.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${wikiTitle}`,
    };

    const responseBody = JSON.stringify(result);

    // Write to Firestore cache (fire-and-forget)
    // Only a successful answer, and only when it is a sane size.
    if (db && cacheable(responseBody)) {
      const { Timestamp } = require('firebase-admin/firestore');
      db.collection('wikiCache').doc(cacheKey).set({
        response: responseBody,
        cachedAt: Timestamp.now(),
        queryName: name,
        queryType: type || 'entity',
      }).catch(() => {});
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' },
      body: responseBody,
    };
  } catch (err) {
    console.error('get-entity-info error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'server_error' }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
