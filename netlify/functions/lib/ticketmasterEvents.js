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

/**
 * The attraction whose name is exactly this band's. Several can share a name;
 * the one with the most upcoming events wins, and is flagged 'low' for the
 * admin, since it may be the wrong band.
 */
async function resolveAttraction(name, apiKey, get) {
  const params = new URLSearchParams({ keyword: name, apikey: apiKey, classificationName: 'music', size: '10' });
  const { statusCode, body } = await get(`https://app.ticketmaster.com/discovery/v2/attractions.json?${params}`);
  if (statusCode !== 200) throw new Error(`attractions ${statusCode}`);
  const wanted = name.trim().toLowerCase();
  const matches = (body?._embedded?.attractions || [])
    .filter((a) => (a.name || '').trim().toLowerCase() === wanted)
    .sort((a, b) => (b.upcomingEvents?._total || 0) - (a.upcomingEvents?._total || 0));
  if (!matches.length) return { id: null, confidence: null };
  return { id: matches[0].id, confidence: matches.length > 1 ? 'low' : 'high' };
}

function coordinate(v) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function mapEvent(e, affiliateId) {
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
    // The on-sale job's fields (lib/onsaleAlerts.js).
    status: e.dates?.status?.code || null,
    timezone: e.dates?.timezone || venue.timezone || null,
    lat: coordinate(venue.location?.latitude),
    lng: coordinate(venue.location?.longitude),
    publicOnsaleAt: e.sales?.public?.startDateTime || null,
    publicOnsaleTBD: e.sales?.public?.startTBD === true,
    presales: (e.sales?.presales || []).map((p) => ({
      name: p.name || null,
      startsAt: p.startDateTime || null,
      endsAt: p.endDateTime || null,
      url: p.url || null,
    })),
  };
}

// Ticketmaster refuses to page past the 1000th item.
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

async function fetchArtistEvents(name, { apiKey, affiliateId, attractionId = null, get = httpsGetJson } = {}) {
  if (!apiKey) return null;
  try {
    const attraction = attractionId
      ? { id: attractionId, confidence: null }
      : await resolveAttraction(name, apiKey, get);
    // Not on Ticketmaster at all: a real answer (no dates), not a failure.
    if (!attraction.id) return { events: [], attractionId: null };
    const events = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        attractionId: attraction.id,
        apikey: apiKey,
        size: String(PAGE_SIZE),
        page: String(page),
        sort: 'date,asc',
        startDateTime: `${new Date().toISOString().split('T')[0]}T00:00:00Z`,
      });
      const { statusCode, body } = await get(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
      if (statusCode !== 200) throw new Error(`events ${statusCode}`);
      (body?._embedded?.events || []).forEach((e) => { if (e.id) events.push(mapEvent(e, affiliateId)); });
      if (page + 1 >= (body?.page?.totalPages || 1)) break;
    }
    return { events, attractionId: attraction.id, attractionConfidence: attraction.confidence };
  } catch (err) {
    console.warn('[ticketmaster] lookup failed for', name, err.message);
    return null;
  }
}

/** Where a venue is, for a show Ticketmaster doesn't list. { lat, lng } or null. */
async function findVenueLocation({ venue, city, state }, { apiKey, get = httpsGetJson } = {}) {
  if (!apiKey || !venue) return null;
  try {
    const params = new URLSearchParams({ keyword: venue, apikey: apiKey, size: '5' });
    if (state) params.set('stateCode', state);
    const { statusCode, body } = await get(`https://app.ticketmaster.com/discovery/v2/venues.json?${params}`);
    if (statusCode !== 200) return null;
    const wanted = String(city || '').trim().toLowerCase();
    const match = (body?._embedded?.venues || []).find((v) => !wanted || (v.city?.name || '').trim().toLowerCase() === wanted);
    const lat = coordinate(match?.location?.latitude);
    const lng = coordinate(match?.location?.longitude);
    return lat == null || lng == null ? null : { lat, lng };
  } catch (err) {
    console.warn('[ticketmaster] venue lookup failed for', venue, err.message);
    return null;
  }
}

module.exports = { fetchArtistEvents, resolveAttraction, findVenueLocation };
