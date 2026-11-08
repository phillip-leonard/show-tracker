// netlify/functions/lib/festivalLineup.js
//
// An upcoming festival's lineup from Ticketmaster's Discovery API: the
// attractions on the festival's own events. Used by festival-lineup.js;
// pure apart from the `get` it is handed, so
// tests/recommendations/festivalLineup.test.js runs it on fixtures.
//
// TERMS (checked for 5.54.0, Ticketmaster General Terms of Use, last
// updated June 27, 2023):
//   - Event content may be cached "for reasonable periods" only. A stored
//     lineup is refreshed at most once a day (REFRESH_MS), and only when a
//     user opens the festival, never by a background job, which also keeps
//     clear of the clause about blocking apps that call "not primarily in
//     response to direct user actions".
//   - Content must be removed within 24 hours on request. A lineup lives in
//     four fields on festivals/{id} (lineup, lineupSource, lineupUrl,
//     lineupFetchedAt). Deleting them with the Admin SDK removes it.
//   - The festival page links to the Ticketmaster event (lineupUrl) with
//     "Lineup from Ticketmaster".
// SeatGeek was not used: its API terms page could not be read (HTTP 403),
// so they are unconfirmed.
//
// MATCHING. Ticketmaster has no festival entity. A festival is sold as one
// or more events (passes, single days) named after it, each listing the
// performers as attractions. So: search events by the festival's name in
// its date window, keep the events whose names carry every distinctive
// word of the festival's name, and take the union of their attractions,
// minus the festival itself and the non-performers (passes, parking,
// camping) that get listed as attractions too.

const { normalizeFestivalName } = require('./festivalMatchRule');

const REFRESH_MS = 24 * 60 * 60 * 1000;
const MAX_LINEUP = 300;
const DAY_MS = 86400000;

// Words that don't tell one festival from another.
const GENERIC = new Set(['festival', 'fest', 'music', 'and', 'arts', 'the', 'of', 'presents', 'weekend', 'live']);
const NOT_A_PERFORMER = /\b(pass(es)?|parking|shuttle|camping|campground|package|vip|ga|general admission|admission|tickets?|upgrade|lockers?|rv|glamping|lodging|hotel|add on|addon|day \d|\d day)\b/i;

function distinctiveWords(name) {
  return normalizeFestivalName(name).split(' ').filter((w) => w && !GENERIC.has(w) && !/^\d+$/.test(w));
}

/** True when the event's name carries every distinctive word of the festival's. */
function eventIsFestival(eventName, festivalName) {
  const words = distinctiveWords(festivalName);
  if (!words.length) return false;
  const have = new Set(normalizeFestivalName(eventName).split(' '));
  return words.every((w) => have.has(w));
}

function isPerformer(attraction, festivalName) {
  const name = String(attraction && attraction.name || '').trim();
  if (!name) return false;
  if (NOT_A_PERFORMER.test(name)) return false;
  if (eventIsFestival(name, festivalName)) return false;
  const segment = attraction.classifications && attraction.classifications[0] && attraction.classifications[0].segment;
  if (segment && segment.name && segment.name !== 'Music') return false;
  return true;
}

/**
 * lineupFromEvents(events, festival) -> { lineup: [names], url } or null
 * events: Ticketmaster event objects (with _embedded.attractions).
 */
function lineupFromEvents(events, festival) {
  const matched = (events || []).filter((e) => eventIsFestival(e && e.name, festival.name));
  if (!matched.length) return null;
  const seen = new Set();
  const lineup = [];
  for (const e of matched) {
    for (const a of (e._embedded && e._embedded.attractions) || []) {
      if (!isPerformer(a, festival.name)) continue;
      const name = a.name.trim();
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lineup.push(name);
    }
  }
  if (!lineup.length) return null;
  // The event with the most performers is the best page to send people to.
  const best = matched.slice().sort((x, y) => ((y._embedded?.attractions || []).length) - ((x._embedded?.attractions || []).length))[0];
  return { lineup: lineup.slice(0, MAX_LINEUP), url: best.url || null };
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * fetchLineup(festival, { apiKey, get }) -> { lineup, url } | null (nothing found) ;
 * throws when Ticketmaster can't be asked.
 * festival: { name, startDate, endDate } (yyyy-MM-dd).
 */
async function fetchLineup(festival, { apiKey, get }) {
  const start = Date.parse(`${festival.startDate}T00:00:00Z`);
  const end = Date.parse(`${festival.endDate || festival.startDate}T00:00:00Z`);
  const keyword = normalizeFestivalName(festival.name);
  if (!keyword || Number.isNaN(start) || Number.isNaN(end)) return null;
  const params = new URLSearchParams({
    apikey: apiKey,
    keyword,
    classificationName: 'music',
    startDateTime: `${isoDay(start - DAY_MS)}T00:00:00Z`,
    endDateTime: `${isoDay(end + DAY_MS)}T23:59:59Z`,
    size: '50',
  });
  const { statusCode, body } = await get(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
  if (statusCode !== 200) throw new Error(`events ${statusCode}`);
  return lineupFromEvents((body && body._embedded && body._embedded.events) || [], festival);
}

/** Upcoming means it hasn't ended yet (today counts). */
function isUpcoming(festival, now = Date.now()) {
  const end = festival && (festival.endDate || festival.startDate);
  return !!end && end >= isoDay(now);
}

function isFresh(festival, now = Date.now()) {
  const at = festival && festival.lineupFetchedAt;
  const ms = at && (typeof at.toMillis === 'function' ? at.toMillis() : at instanceof Date ? at.getTime() : Number(at));
  return !!ms && now - ms < REFRESH_MS;
}

module.exports = { lineupFromEvents, fetchLineup, eventIsFestival, isPerformer, isUpcoming, isFresh, REFRESH_MS, MAX_LINEUP };
