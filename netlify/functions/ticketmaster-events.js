const { withCors } = require('./lib/cors');
const https = require('https');
const { artistSlug, readTicketCache, writeTicketCache } = require('./lib/ticketCacheStore');

const CORS = { 'Content-Type': 'application/json' };

// Promisified HTTPS GET — returns { statusCode, body } where body is parsed JSON
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { Accept: 'application/json', 'User-Agent': 'MySetlistsApp/1.0' },
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`Failed to parse Ticketmaster response: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { artistName, attractionId: passedAttractionId } = event.queryStringParameters || {};

  if (!artistName) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'artistName is required' }) };
  }

  const apiKey = process.env.TICKETMASTER_API_KEY;
  const affiliateId = process.env.TICKETMASTER_AFFILIATE_ID;

  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Ticketmaster API key not configured' }) };
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const normalizedSearch = artistName.trim().toLowerCase();

  // ── Step 1: Resolve Attraction ID ──────────────────────────────────────────
  // Use a pre-cached attraction ID if the caller supplies one (fastest path).
  // Otherwise hit the attractions endpoint and find an exact name match.
  let resolvedAttractionId = passedAttractionId || null;

  if (!resolvedAttractionId) {
    try {
      const attrParams = new URLSearchParams({
        keyword: artistName,
        apikey: apiKey,
        classificationName: 'music',
        size: '10',
      });
      const attrUrl = `https://app.ticketmaster.com/discovery/v2/attractions.json?${attrParams}`;
      const { body: attrBody } = await httpsGet(attrUrl);
      const attractions = attrBody?._embedded?.attractions || [];

      // Exact name match (case-insensitive). Try strict first, then trimmed.
      const exactMatch = attractions.find(
        (a) => a.name.trim().toLowerCase() === normalizedSearch
      );
      if (exactMatch) {
        resolvedAttractionId = exactMatch.id;
      }
    } catch (_) {
      // Attractions lookup failed — fall through to keyword search with strict client-side filter
    }
  }

  // ── Step 2: Fetch events ───────────────────────────────────────────────────
  // If we have an attraction ID, query by attractionId (guaranteed exact match).
  // Otherwise fall back to keyword search and filter client-side.
  let useAttractionId = !!resolvedAttractionId;
  const eventParams = useAttractionId
    ? new URLSearchParams({
        attractionId: resolvedAttractionId,
        apikey: apiKey,
        size: '10',
        sort: 'date,asc',
        startDateTime: `${today}T00:00:00Z`,
      })
    : new URLSearchParams({
        keyword: artistName,
        apikey: apiKey,
        classificationName: 'music',
        size: '20', // fetch more so client-side filter has enough to work with
        sort: 'date,asc',
        startDateTime: `${today}T00:00:00Z`,
      });

  try {
    const eventsUrl = `https://app.ticketmaster.com/discovery/v2/events.json?${eventParams}`;
    const { body: parsed } = await httpsGet(eventsUrl);
    let rawEvents = parsed?._embedded?.events || [];

    // Client-side safety filter when we had to fall back to keyword search.
    // Only keep events where at least one attraction name exactly matches.
    if (!useAttractionId) {
      rawEvents = rawEvents.filter((e) => {
        const eventAttractions = e?._embedded?.attractions || [];
        return eventAttractions.some(
          (a) => a.name.trim().toLowerCase() === normalizedSearch
        );
      });
    }

    // Map to our standard event shape
    const events = rawEvents.slice(0, 5).map((e) => {
      const venue = e._embedded?.venues?.[0] || {};
      const priceRange = e.priceRanges?.[0] || null;

      let url = e.url || '';
      if (url && affiliateId) {
        url += (url.includes('?') ? '&' : '?') + `camefrom=${encodeURIComponent(affiliateId)}`;
      }

      return {
        id: e.id,
        name: e.name,
        date: e.dates?.start?.localDate || null,
        time: e.dates?.start?.localTime || null,
        venue: venue.name || null,
        city: venue.city?.name || null,
        state: venue.state?.stateCode || venue.state?.name || null,
        country: venue.country?.countryCode || null,
        url,
        minPrice: priceRange?.min || null,
        maxPrice: priceRange?.max || null,
      };
    });

    // The function writes the shared cache, not the browser (5.59.7, S-02).
    // An attraction ID the caller passed is only trusted for caching when
    // it is the one already cached for this artist, so a request can't
    // file another artist's dates under this name.
    const cacheKey = `tm_${artistSlug(artistName)}`;
    const cached = passedAttractionId ? await readTicketCache(cacheKey) : null;
    if (!passedAttractionId || (cached && cached.tmAttractionId === passedAttractionId)) {
      const fields = { data: events };
      if (resolvedAttractionId) fields.tmAttractionId = resolvedAttractionId;
      await writeTicketCache(cacheKey, fields);
    }

    return {
      statusCode: 200,
      headers: CORS,
      // Return the resolvedAttractionId so the client can cache it and skip
      // the attractions lookup on the next call.
      body: JSON.stringify({ events, attractionId: resolvedAttractionId }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Request to Ticketmaster failed', details: err.message, events: [] }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
