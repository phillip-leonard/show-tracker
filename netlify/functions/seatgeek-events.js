const { withCors } = require('./lib/cors');
const { withProxyLimit } = require('./lib/proxyLimit');
const https = require('https');
const { artistSlug, writeTicketCache } = require('./lib/ticketCacheStore');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const { artistName } = event.queryStringParameters || {};

  if (!artistName) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'artistName is required' })
    };
  }

  const clientId = process.env.SEATGEEK_CLIENT_ID;
  const affiliateId = process.env.SEATGEEK_AFFILIATE_ID;

  if (!clientId) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'SeatGeek client ID not configured' })
    };
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const params = new URLSearchParams({
    q: artistName,
    type: 'concert',
    client_id: clientId,
    sort: 'datetime_local.asc',
    per_page: '20', // fetch more so client-side exact-name filter has enough to work with
    'datetime_local.gte': today
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.seatgeek.com',
      path: `/2/events?${params.toString()}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'MySetlistsApp/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => { data += chunk; });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const allEvents = Array.isArray(parsed.events) ? parsed.events : [];

          // Client-side exact-match filter: only keep events where at least one
          // performer name exactly matches the searched artist (case-insensitive).
          // This prevents loose keyword matches (e.g. "Goose" matching unrelated shows).
          const normalizedSearch = artistName.trim().toLowerCase();
          const rawEvents = allEvents.filter((e) => {
            const performers = Array.isArray(e.performers) ? e.performers : [];
            return performers.some(
              (p) => (p.name || '').trim().toLowerCase() === normalizedSearch
            );
          });

          const events = rawEvents.map((e) => {
            const venue = e.venue || {};

            // Build affiliate URL
            let url = e.url || '';
            if (url && affiliateId) {
              url += (url.includes('?') ? '&' : '?') + `aid=${encodeURIComponent(affiliateId)}`;
            }

            // datetime_local format: "2026-03-15T19:00:00"
            const dtParts = e.datetime_local ? e.datetime_local.split('T') : [];
            const date = dtParts[0] || null;
            const time = dtParts[1] || null;

            return {
              id: String(e.id),
              name: e.title || null,
              date,
              time,
              venue: venue.name || null,
              city: venue.city || null,
              state: venue.state || null,
              country: venue.country || null,
              url,
              minPrice: e.stats ? (e.stats.lowest_price || null) : null,
              maxPrice: e.stats ? (e.stats.highest_price || null) : null
            };
          });

          // The function writes the shared cache, not the browser (5.59.7, S-02).
          writeTicketCache(`sg_${artistSlug(artistName)}`, { data: events })
            .finally(() => resolve({
              statusCode: 200,
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ events })
            }));
        } catch (err) {
          resolve({
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Failed to parse SeatGeek response', events: [] })
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request to SeatGeek failed', details: err.message, events: [] })
      });
    });

    req.end();
  });
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
// Per-IP daily limit on the shared seatgeek quota (lib/proxyLimit.js, 5.59.8).
module.exports.handler = withCors(withProxyLimit('seatgeek', module.exports.handler));
