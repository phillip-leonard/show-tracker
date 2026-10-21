// netlify/functions/search-festival-lineup.js
//
// "Who played this festival?" — returns every distinct artist/date setlist
// logged at a festival, so the app can offer them as a bulk-selectable
// lineup.
//
// WHY THIS SHAPE: setlist.fm has no festival entity, and its
// /search/setlists endpoint has no date-*range* parameter — only an exact
// `date` (dd-MM-yyyy) plus `year`. What it does have is `cityName`,
// `venueId`/`venueName`, `tourName` and `artistName`. A festival is
// therefore reconstructed as "everything logged in this city on these
// days":
//
//   for each day in the festival's window:
//     /search/setlists?cityName=<city>&date=<dd-MM-yyyy>
//
// Querying day-by-day rather than by year is what makes this work at all.
// A year-scoped city query returns that city's whole year newest-first, so
// for anywhere busier than a small town the festival's own dates fall off
// the end long before the page cap — the exact-date query returns the
// festival and nothing else, in two pages instead of fifty.
//
// City is the primary key because a festival's setlist.fm venue is its
// grounds, not its name: BottleRock is logged at "Napa Valley Expo",
// Bonnaroo at "Great Stage Park". Searching the city on the right days
// finds those without having to know either. When no city is known the
// festival name is resolved through /search/venues first, and a
// year-scoped venue/tour-name search is the last resort.
//
// `artist` switches to a single-artist lookup within the same window —
// the reliable fallback for a festival setlist.fm covers thinly, where
// the user knows exactly who they saw.
//
// Caching reuses the existing `setlistCache` collection under a
// `festival_` key prefix, with the same graceful-degradation-if-env-vars-
// missing behaviour as search-setlists.js.

const https = require('https');
const crypto = require('crypto');
const { setlistfmKey, missingSetlistfmKey } = require('./lib/setlistfmKey');

const CORS_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

// Bounds on upstream work. A festival is a handful of days; anything
// claiming more than MAX_DAYS is truncated rather than fanned out.
const MAX_DAYS = 10;
const MAX_PAGES_PER_DAY = 2;
const MAX_SETLIST_PAGES = 5;
const MAX_VENUE_CANDIDATES = 3;
const CACHE_TTL_HOURS = 24;

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

function fetchJSON(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.setlist.fm',
      path,
      method: 'GET',
      headers: {
        'x-api-key': setlistfmKey(),
        Accept: 'application/json',
        'User-Agent': 'ShowTrackerApp/1.0',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          // setlist.fm answers "nothing found" with a non-JSON 404 body on
          // some endpoints — treat that as an empty result, not a crash.
          resolve({ status: res.statusCode, data: null });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// setlist.fm returns dd-MM-yyyy; everything in this app stores yyyy-MM-dd.
function toIsoDate(eventDate) {
  const parts = (eventDate || '').split('-');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

// yyyy-MM-dd -> dd-MM-yyyy, the only date format /search/setlists accepts.
function toSetlistFmDate(isoDate) {
  const parts = (isoDate || '').split('-');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

// Every calendar day in [from, to] inclusive, as yyyy-MM-dd. Built with
// UTC arithmetic so a festival spanning a month or year boundary
// enumerates correctly and no local timezone can shift a day.
function daysInWindow(from, to, max = MAX_DAYS) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '')) return [];
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : from;
  if (end < from) return [];

  const days = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return [];

  while (cursor <= last && days.length < max) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

// A festival's `location` is free text ("Napa, CA", "Manchester, TN").
// setlist.fm's cityName wants the city alone.
function cityFromLocation(location) {
  return (location || '').split(',')[0].trim();
}

async function searchVenues(name) {
  const params = new URLSearchParams({ name, p: '1' });
  const { status, data } = await fetchJSON(`/rest/1.0/search/venues?${params}`);
  if (status !== 200 || !data?.venue?.length) return [];
  return data.venue.map(v => ({
    id: v.id,
    name: v.name || '',
    city: v.city?.name || '',
    state: v.city?.stateCode || v.city?.state || '',
    country: v.city?.country?.name || '',
  }));
}

// Pages one /search/setlists query. `extra` carries whichever of
// cityName / venueId / venueName / tourName / artistName / date / year
// this strategy is keyed on.
async function fetchSetlists(extra, maxPages) {
  const collected = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({ ...extra, p: String(page) });
    const { status, data } = await fetchJSON(`/rest/1.0/search/setlists?${params}`);
    if (status !== 200 || !data?.setlist?.length) break;
    collected.push(...data.setlist);

    const total = data.total || 0;
    const perPage = data.itemsPerPage || 20;
    if (page * perPage >= total) break;
  }
  return collected;
}

// Runs one keyed query per day of the festival. Days are independent, so
// they go out together rather than in series — a 4-day festival is 4
// round trips of latency, not 4x.
async function fetchByDays(key, days) {
  const perDay = await Promise.all(
    days.map(day => fetchSetlists({ ...key, date: toSetlistFmDate(day) }, MAX_PAGES_PER_DAY)
      .catch(() => []))
  );
  return perDay.flat();
}

// One entry per artist+date. Prefers the richest setlist when an artist has
// two logged sets on the same day (a main-stage set and a late-night one
// both count as "they played" — the fuller one is the better import).
function toLineup(setlists, { from, to }) {
  const byKey = new Map();

  setlists.forEach(sl => {
    const artist = sl.artist?.name || '';
    const date = toIsoDate(sl.eventDate);
    if (!artist || !date) return;
    if (from && date < from) return;
    if (to && date > to) return;

    const key = `${artist.toLowerCase()}|${date}`;
    const songCount = countSongs(sl);
    const existing = byKey.get(key);
    if (existing && existing.songCount >= songCount) return;

    byKey.set(key, {
      setlistfmId: sl.id,
      artist,
      artistMbid: sl.artist?.mbid || null,
      date,
      venue: sl.venue?.name || '',
      city: sl.venue?.city?.name || '',
      country: sl.venue?.city?.country?.name || '',
      tour: sl.tour?.name || null,
      songCount,
      sets: sl.sets || null,
    });
  });

  return Array.from(byKey.values()).sort(
    (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.artist.localeCompare(b.artist))
  );
}

function countSongs(setlist) {
  return (setlist?.sets?.set || []).reduce((acc, s) => acc + (s.song?.length || 0), 0);
}

// Exported for lib/__tests__/festivalLineup.test.js — these are the parts
// with real logic in them, and they're pure.
exports._toLineup = toLineup;
exports._toIsoDate = toIsoDate;
exports._toSetlistFmDate = toSetlistFmDate;
exports._daysInWindow = daysInWindow;
exports._cityFromLocation = cityFromLocation;

exports.handler = async function handler(event) {
  const missingKey = missingSetlistfmKey();
  if (missingKey) return missingKey;

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const {
    name = '', venueId = '', city = '', artist = '', year = '', from = '', to = '',
  } = event.queryStringParameters || {};

  if (!name.trim() && !venueId && !city.trim() && !artist.trim()) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'A festival name, city, artist or venueId is required' }),
    };
  }

  const effectiveYear = year || (from || to).slice(0, 4) || '';
  const days = daysInWindow(from, to);
  const cityName = cityFromLocation(city);

  const cacheKey = crypto
    .createHash('md5')
    .update(JSON.stringify({
      n: name.toLowerCase().trim(),
      v: venueId,
      c: cityName.toLowerCase(),
      a: artist.toLowerCase().trim(),
      y: effectiveYear,
      f: from,
      t: to,
    }))
    .digest('hex');
  const db = getDb();

  if (db) {
    try {
      const snap = await db.collection('setlistCache').doc(`festival_${cacheKey}`).get();
      if (snap.exists) {
        const cached = snap.data();
        if ((cached.expiresAt?.toMillis?.() || 0) > Date.now()) {
          return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'HIT' }, body: cached.response };
        }
      }
    } catch (e) {
      console.warn('[CACHE] Read error:', e.message);
    }
  }

  try {
    let venues = [];
    let setlists = [];
    let strategy = '';

    if (artist.trim()) {
      // Single-artist lookup: precise, and the fallback that works even
      // when a festival is barely covered. Day-scoped when we have the
      // window, year-scoped otherwise.
      strategy = 'artist';
      setlists = days.length
        ? await fetchByDays({ artistName: artist.trim() }, days)
        : await fetchSetlists({ artistName: artist.trim(), ...(effectiveYear && { year: effectiveYear }) }, MAX_SETLIST_PAGES);
    } else {
      if (cityName && days.length) {
        strategy = 'city+date';
        setlists = await fetchByDays({ cityName }, days);
      }

      // No city on the festival (or the city found nothing): resolve the
      // festival's name to a venue and try that instead.
      if (setlists.length === 0 && (venueId || name.trim())) {
        venues = venueId
          ? [{ id: venueId, name: name || '', city: '', state: '', country: '' }]
          : (await searchVenues(name.trim())).slice(0, MAX_VENUE_CANDIDATES);

        if (venues.length && days.length) {
          strategy = 'venue+date';
          const perVenue = await Promise.all(venues.map(v => fetchByDays({ venueId: v.id }, days)));
          setlists = perVenue.flat();
        }
        if (setlists.length === 0 && venues.length) {
          strategy = 'venue+year';
          const perVenue = await Promise.all(
            venues.map(v => fetchSetlists({ venueId: v.id, ...(effectiveYear && { year: effectiveYear }) }, MAX_SETLIST_PAGES).catch(() => []))
          );
          setlists = perVenue.flat();
        }
      }

      // Last resort: some festival sets carry the festival's own name in
      // setlist.fm's tour field, and venueName matches more loosely than
      // an id.
      if (setlists.length === 0 && name.trim()) {
        strategy = 'tour/venue-name';
        const [byTour, byVenueName] = await Promise.all([
          fetchSetlists({ tourName: name.trim(), ...(effectiveYear && { year: effectiveYear }) }, MAX_SETLIST_PAGES).catch(() => []),
          fetchSetlists({ venueName: name.trim(), ...(effectiveYear && { year: effectiveYear }) }, MAX_SETLIST_PAGES).catch(() => []),
        ]);
        setlists = [...byTour, ...byVenueName];
      }
    }

    const results = toLineup(setlists, { from, to });
    const responseBody = JSON.stringify({ venues, results, total: results.length, strategy });

    if (db) {
      const { Timestamp } = require('firebase-admin/firestore');
      db.collection('setlistCache').doc(`festival_${cacheKey}`).set({
        response: responseBody,
        fetchedAt: Timestamp.now(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + CACHE_TTL_HOURS * 3600 * 1000)),
        ttlHours: CACHE_TTL_HOURS,
        queryParams: { name: name.toLowerCase().trim(), venueId, city: cityName, artist: artist.trim(), year: effectiveYear, from, to },
        hitCount: 0,
      }).catch(e => console.warn('[CACHE] Write error:', e.message));
    }

    return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' }, body: responseBody };
  } catch (e) {
    console.error('[search-festival-lineup] failed:', e.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Request failed', details: e.message }) };
  }
};
