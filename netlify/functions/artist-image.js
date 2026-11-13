// netlify/functions/artist-image.js
//
// Fetches an artist photo via MusicBrainz + Wikipedia (no API key needed).
// Flow: MusicBrainz artist search → MBID → Wikipedia URL relation → Wikipedia thumbnail.

const { withCors } = require('./lib/cors');
const https = require('https');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
};

// MusicBrainz requires a descriptive User-Agent per their API policy
const MB_USER_AGENT = 'ShowTracker/1.0 (https://github.com/tiberius33/show-tracker)';
const MB_RATE_LIMIT_MS = 1200; // stay comfortably under 1 req/sec

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': MB_USER_AGENT,
          Accept: 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ statusCode: res.statusCode, body: null });
          }
        });
      }
    );
    req.on('error', reject);
    // 8 second per-request timeout
    req.setTimeout(8000, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.end();
  });
}

async function getArtistImage(artistName) {
  // Step 1: Search for artist
  const searchUrl =
    `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(artistName)}&fmt=json&limit=3`;
  const searchRes = await httpsGet(searchUrl);
  if (searchRes.statusCode !== 200 || !searchRes.body?.artists?.length) return null;

  // Prefer an exact name match if available
  const artists = searchRes.body.artists;
  const exact = artists.find(a => a.name.toLowerCase() === artistName.toLowerCase());
  const mbid = (exact || artists[0]).id;

  // Respect MusicBrainz rate limit between the two calls
  await sleep(MB_RATE_LIMIT_MS);

  // Step 2: Fetch artist with URL relations
  const artistUrl =
    `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`;
  const artistRes = await httpsGet(artistUrl);
  if (artistRes.statusCode !== 200 || !artistRes.body) return null;

  const relations = artistRes.body.relations || [];

  // Find an English Wikipedia URL
  const wikiRel = relations.find(
    r => r.type === 'wikipedia' && r.url?.resource?.includes('en.wikipedia.org')
  );
  if (!wikiRel) return null;

  const pageTitle = wikiRel.url.resource.split('/wiki/')[1];
  if (!pageTitle) return null;

  // Step 3: Fetch Wikipedia page summary (includes thumbnail)
  const summaryUrl =
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
  const summaryRes = await httpsGet(summaryUrl);
  if (summaryRes.statusCode !== 200 || !summaryRes.body) return null;

  // Prefer a wider thumbnail (640px) by rewriting the URL width segment
  const raw = summaryRes.body.thumbnail?.source || null;
  if (!raw) return null;

  // Wikipedia thumbnail URLs contain a width segment like "/320px-" — bump to 640 for quality
  return raw.replace(/\/\d+px-/, '/640px-');
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

  const artist = event.queryStringParameters?.artist?.trim();
  if (!artist) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing artist parameter' }) };
  }

  try {
    const imageUrl = await getArtistImage(artist);
    // CDN-cache the answer (a day when found, an hour when not) so repeat
    // lookups don't reach MusicBrainz, whose policy is ~1 request/second.
    // iOS calls this too since B-01 (5.59.8). withCors adds Netlify-Vary
    // on Origin so the web and app copies are cached apart.
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': imageUrl ? 'public, max-age=86400, s-maxage=86400' : 'public, max-age=3600, s-maxage=3600',
      },
      body: JSON.stringify({ imageUrl }),
    };
  } catch (err) {
    console.error('artist-image error:', err.message);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ imageUrl: null }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
