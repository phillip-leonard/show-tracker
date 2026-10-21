/**
 * ticketmasterEvents — every upcoming Ticketmaster date for one artist,
 * matched by Ticketmaster attraction id rather than by keyword, so
 * "Goose" never picks up a Mother Goose matinee. Server only; used by the
 * followed-band job (lib/followedBandAlerts.js). ticketmaster-events.js,
 * the endpoint behind the per-artist Upcoming panel, resolves the
 * attraction the same way.
 *
 * Resolves { events, attractionId } or null when Ticketmaster could not
 * be asked (no key, network error, non-200). null is "try again tomorrow",
 * never "this band has no dates": the job leaves the ledger alone.
 */

const https = require('https');

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'MySetlistsApp/1.0' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error(`Ticketmaster returned non-JSON (${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Ticketmaster request timed out')));
  });
}

async function resolveAttractionId(name, apiKey, get) {
  const params = new URLSearchParams({ keyword: name, apikey: apiKey, classificationName: 'music', size: '10' });
  const { statusCode, body } = await get(`https://app.ticketmaster.com/discovery/v2/attractions.json?${params}`);
  if (statusCode !== 200) throw new Error(`attractions ${statusCode}`);
  const wanted = name.trim().toLowerCase();
  const match = (body?._embedded?.attractions || []).find((a) => (a.name || '').trim().toLowerCase() === wanted);
  return match ? match.id : null;
}

async function fetchArtistEvents(name, { apiKey, affiliateId, attractionId = null, get = httpsGetJson } = {}) {
  if (!apiKey) return null;
  try {
    const id = attractionId || await resolveAttractionId(name, apiKey, get);
    // Not on Ticketmaster at all: a real answer (no dates), not a failure.
    if (!id) return { events: [], attractionId: null };
    const params = new URLSearchParams({
      attractionId: id,
      apikey: apiKey,
      size: '200',
      sort: 'date,asc',
      startDateTime: `${new Date().toISOString().split('T')[0]}T00:00:00Z`,
    });
    const { statusCode, body } = await get(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
    if (statusCode !== 200) throw new Error(`events ${statusCode}`);
    const events = (body?._embedded?.events || []).map((e) => {
      const venue = e._embedded?.venues?.[0] || {};
      let url = e.url || '';
      if (url && affiliateId) url += (url.includes('?') ? '&' : '?') + `camefrom=${encodeURIComponent(affiliateId)}`;
      return {
        id: e.id,
        name: e.name || null,
        date: e.dates?.start?.localDate || null,
        venue: venue.name || null,
        city: venue.city?.name || null,
        state: venue.state?.stateCode || null,
        url: url || null,
      };
    }).filter((e) => e.id);
    return { events, attractionId: id };
  } catch (err) {
    console.warn('[ticketmaster] lookup failed for', name, err.message);
    return null;
  }
}

module.exports = { fetchArtistEvents };
