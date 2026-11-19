/**
 * find-bucket-venue — the venue of a bucket-list show that was saved
 * without one, from Ticketmaster (5.60.35).
 *
 *   POST /.netlify/functions/find-bucket-venue   Auth: Bearer {idToken}
 *   { artist, date: 'YYYY-MM-DD', city?, state? }
 *   -> { ok: true, found: true, venue, city, state, lat, lng, url }
 *    | { ok: true, found: false, reason: 'not_found' | 'ambiguous' | 'unavailable' }
 *
 * Bucket-list shows are added by hand (lib/bucketList.js), often with only
 * a band, a date and a city. The native app asks this when "Add to
 * Calendar" finds no venue, saves the answer to the show, and uses the
 * coordinates for the event's map location.
 *
 * The band is matched by Ticketmaster attraction id
 * (lib/ticketmasterEvents.js fetchArtistEvents), as the followed-band job
 * matches it, so "Goose" never finds a Mother Goose matinee. A night is
 * the band's event on that day: in that city when one was given; with no
 * city, only when every event that day is at one venue. Anything else is
 * not an answer, rather than a guess.
 *
 * It spends the Ticketmaster key, so (CLAUDE.md): an account (guests are
 * refused by requireAccount) and a per-user daily limit.
 */

const { withCors } = require('./lib/cors');
const { getDb } = require('./lib/firebaseAdmin');
const { requireAccount } = require('./lib/requestAuth');
const { takeDailyQuota } = require('./lib/rateLimit');
const { isoDay } = require('./lib/cacheGuard');
const { fetchArtistEvents } = require('./lib/ticketmasterEvents');

const DAILY_LIMIT = 20;
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(body) });

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * pickEvent(events, { date, city, state }) → { event } or { reason }.
 * `events` are fetchArtistEvents' (each { date, venue, city, state, ... }).
 */
function pickEvent(events, { date, city, state }) {
  const onDay = (events || []).filter((e) => e && e.date === date && e.venue);
  if (!onDay.length) return { reason: 'not_found' };
  if (norm(city)) {
    const inCity = onDay.filter((e) => norm(e.city) === norm(city) && (!norm(state) || !norm(e.state) || norm(e.state) === norm(state)));
    return inCity.length ? { event: inCity[0] } : { reason: 'not_found' };
  }
  const venues = new Set(onDay.map((e) => `${norm(e.venue)}|${norm(e.city)}`));
  return venues.size === 1 ? { event: onDay[0] } : { reason: 'ambiguous' };
}

async function handle(event, { db = null, apiKey = process.env.TICKETMASTER_API_KEY, fetchEvents = fetchArtistEvents } = {}) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const user = await requireAccount(event, HEADERS);
  if (user.response) return user.response;

  let body;
  try { body = JSON.parse(event.body || '{}') || {}; } catch { return reply(400, { error: 'Invalid JSON body.' }); }
  const artist = text(body.artist, 200);
  const date = isoDay(body.date);
  if (!artist || !date) return reply(400, { error: 'artist and an ISO date are required.' });
  const city = text(body.city, 120);
  const state = text(body.state, 40);

  try {
    const store = db || getDb();
    const quota = await takeDailyQuota(store, `bucket_venue_${user.uid}`, DAILY_LIMIT, { uid: user.uid });
    if (!quota.allowed) return reply(429, { error: 'Too many venue lookups today. Try again tomorrow.' }, { 'Retry-After': '3600' });

    if (!apiKey) return reply(200, { ok: true, found: false, reason: 'unavailable' });
    const result = await fetchEvents(artist, { apiKey });
    if (!result) return reply(200, { ok: true, found: false, reason: 'unavailable' });

    const picked = pickEvent(result.events, { date, city, state });
    if (!picked.event) return reply(200, { ok: true, found: false, reason: picked.reason });
    const e = picked.event;
    return reply(200, {
      ok: true,
      found: true,
      venue: e.venue,
      city: e.city || null,
      state: e.state || null,
      lat: typeof e.lat === 'number' ? e.lat : null,
      lng: typeof e.lng === 'number' ? e.lng : null,
      url: e.url || null,
    });
  } catch (err) {
    console.error('[find-bucket-venue] failed:', err && err.message);
    return reply(500, { error: 'server_error' });
  }
}

exports.handler = withCors((event) => handle(event));
exports.handle = handle;
exports.pickEvent = pickEvent;
