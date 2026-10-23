// netlify/functions/get-artist-tours.js
//
// Every tour setlist.fm knows about for one artist, most recent first.
//
// WHY THIS SHAPE: setlist.fm has no tours resource. Checked against the
// current 1.0 docs (https://api.setlist.fm/docs/1.0/resources.html):
// artist, setlist, venue, city, country, search and user — that's the
// whole surface, and `tour` is only a *filter* on /search/setlists, never
// something you can list. A tour name is a field on an individual setlist
// (`tour.name`), so tour discovery means paging an artist's setlists and
// aggregating the distinct names ourselves. If a tours endpoint ever
// appears, this whole function collapses into one call.
//
// Bounds on upstream work, because setlist.fm rate-limits aggressively:
//   - MAX_PAGES most-recent pages only (20 setlists per page). An artist
//     with a twenty-year history is not walked to the end; the response
//     says `truncated: true` so callers can say "recent tours" honestly
//     rather than implying the list is complete.
//   - Pages are fetched *serially* with PAGE_DELAY_MS between them, not
//     in parallel — the previous version fired 3 pages at once, which is
//     exactly the burst pattern that earns a 429.
//   - TIME_BUDGET_MS stops paging early rather than letting the Netlify
//     function time out with nothing to show.
//   - Results are cached in the shared `setlistCache` collection under a
//     `tours_` key prefix (same collection, TTL and
//     graceful-degradation-if-env-vars-missing behaviour as
//     search-setlists.js), so two users browsing the same artist cost one
//     upstream walk, not two.
//
// Consumers: components/tours/TourBrowseModal.jsx (step 2 of the browse
// flow) and components/TourInfoModal.jsx (tour stats). The response keeps
// TourInfoModal's original field names — `tours[]` with name/showCount/
// startDate/endDate/avgSongCount/shows, plus totalShows/artistName/mbid/
// fetchedAt — and only adds fields.

const https = require('https');
const crypto = require('crypto');
const { setlistfmKey, missingSetlistfmKey } = require('./lib/setlistfmKey');
const { readFresh, writeEntry } = require('./lib/setlistCache');

const CORS_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

const MAX_PAGES = 8;              // 8 x 20 = the 160 most recent setlists
const PAGE_DELAY_MS = 200;
const TIME_BUDGET_MS = 8000;
const REQUEST_TIMEOUT_MS = 6000;
const CACHE_TTL_HOURS = 24;

// setlist.fm's own bucket for a setlist with no tour recorded. Kept in the
// response (TourInfoModal shows it as a stats row) but flagged `untagged`,
// because it can't be browsed — there's no tour name to search by.
const UNTAGGED_TOUR_NAME = 'No Tour Listed';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

// Resolves { status, data } — never rejects on an upstream error status, so
// callers can tell 404 (no setlists) from 429 (rate limited) from a
// transport failure, which reject as an Error tagged with `.code`.
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
          // setlist.fm answers "nothing found" with a non-JSON body on some
          // endpoints — an unparseable body is an empty result, not a crash.
          resolve({ status: res.statusCode, data: null });
        }
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(Object.assign(new Error('Setlist.fm request timed out'), { code: 'TIMEOUT' }));
    });
    req.on('error', reject);
    req.end();
  });
}

// dd-MM-yyyy (setlist.fm) -> yyyy-MM-dd (everything in this app).
function toIsoDate(eventDate) {
  const parts = (eventDate || '').split('-');
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : '';
}

// Groups setlists by tour name. Names are compared case- and
// whitespace-insensitively (contributors type them freehand, so "Summer
// Tour 2025" and "summer  tour 2025" are one tour) but the *display* name
// is whichever spelling is most common, never a normalized one — the
// contributor's casing is the closest thing to an official spelling.
//
// The year is deliberately NOT stripped when normalizing: "Summer Tour
// 2024" and "Summer Tour 2025" are different tours and must stay separate
// entries. Two tours that genuinely share a name across years stay
// separate too, split on the calendar year of their first show, so the
// picker can tell them apart by date range.
function normalizeTourName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .trim();
}

function pickMostCommon(counts) {
  let best = null;
  let bestCount = -1;
  for (const [value, count] of Object.entries(counts)) {
    if (count > bestCount) { best = value; bestCount = count; }
  }
  return best;
}

function parseTours(setlists) {
  const groups = new Map();
  let totalShows = 0;

  for (const sl of (setlists || [])) {
    const rawName = sl.tour?.name || UNTAGGED_TOUR_NAME;
    const untagged = !sl.tour?.name;
    const date = toIsoDate(sl.eventDate);
    const songCount = (sl.sets?.set || []).reduce((acc, s) => acc + (s.song?.length || 0), 0);

    const show = {
      date,
      venue: sl.venue?.name || '',
      city: sl.venue?.city?.name || '',
      country: sl.venue?.city?.country?.code || '',
      songCount,
      tourName: rawName,
    };
    totalShows++;

    // A repeated tour name in a different year is a different tour, so the
    // group key carries the year of the show. Untagged setlists all share
    // one bucket regardless of year.
    const year = date.slice(0, 4);
    const key = untagged ? 'untagged' : `${normalizeTourName(rawName)}|${year}`;

    if (!groups.has(key)) {
      groups.set(key, { nameCounts: {}, shows: [], songCounts: [], untagged });
    }
    const group = groups.get(key);
    group.nameCounts[rawName] = (group.nameCounts[rawName] || 0) + 1;
    group.shows.push(show);
    group.songCounts.push(songCount);
  }

  const tours = Array.from(groups.values()).map(group => {
    const dates = group.shows.map(s => s.date).filter(Boolean).sort();
    return {
      name: pickMostCommon(group.nameCounts),
      untagged: group.untagged,
      showCount: group.shows.length,
      startDate: dates[0] || null,
      endDate: dates[dates.length - 1] || null,
      avgSongCount: group.songCounts.length
        ? Math.round(group.songCounts.reduce((a, b) => a + b, 0) / group.songCounts.length)
        : 0,
      // A preview only — the browse flow fetches a tour's full show list
      // from get-tour-shows.js, which pages /search/setlists by tour name
      // rather than relying on however many of that tour's nights happened
      // to fall inside the pages walked here.
      shows: group.shows.slice(0, 10),
    };
  });

  // Most recent first, untagged always last: it isn't a tour anyone browses.
  tours.sort((a, b) => {
    if (a.untagged !== b.untagged) return a.untagged ? 1 : -1;
    return (b.startDate || '').localeCompare(a.startDate || '');
  });

  return { tours, totalShows };
}

exports.handler = async function (event) {
  const missingKey = missingSetlistfmKey();
  if (missingKey) return missingKey;

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

  const { mbid } = event.queryStringParameters || {};
  if (!mbid) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'mbid (MusicBrainz ID) is required' }) };
  }

  const cacheKey = `tours_${crypto.createHash('md5').update(`${mbid}|v2|${MAX_PAGES}`).digest('hex')}`;
  const db = getDb();

  // An expired entry is a miss, never a fallback (lib/setlistCache.js).
  const cached = await readFresh(db, cacheKey);
  if (cached) {
    console.log(`[CACHE HIT] tours mbid:${mbid}`);
    return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'HIT' }, body: cached.response };
  }

  const startedAt = Date.now();
  const setlists = [];
  let artistName = '';
  let truncated = false;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { status, data } = await fetchJSON(`/rest/1.0/artist/${encodeURIComponent(mbid)}/setlists?p=${page}`);

      if (status === 404) {
        // Genuinely nothing logged for this artist. On page 1 that's an
        // empty artist; on a later page it just means we walked past the
        // end, which is a normal stop, not a failure.
        if (page === 1) {
          const body = JSON.stringify({
            mbid, artistName: '', tours: [], totalShows: 0,
            truncated: false, pagesWalked: 0, fetchedAt: new Date().toISOString(),
          });
          return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' }, body };
        }
        break;
      }

      if (status === 429) {
        // Never pretend a rate-limited artist has no tours: say exactly
        // what happened.
        if (setlists.length === 0) {
          return {
            statusCode: 429,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'rate_limited', message: 'setlist.fm is rate limiting us right now. Try again in a minute.' }),
          };
        }
        truncated = true;
        break;
      }

      if (status !== 200 || !data) {
        if (setlists.length === 0) throw new Error(`setlist.fm returned ${status}`);
        truncated = true;
        break;
      }

      const pageSetlists = data.setlist || [];
      setlists.push(...pageSetlists);
      if (!artistName) artistName = pageSetlists[0]?.artist?.name || '';

      const total = data.total || 0;
      const perPage = data.itemsPerPage || 20;
      const lastPage = Math.ceil(total / perPage);

      if (page >= lastPage || pageSetlists.length === 0) break;
      if (page === MAX_PAGES) { truncated = true; break; }
      if (Date.now() - startedAt > TIME_BUDGET_MS) { truncated = true; break; }

      await sleep(PAGE_DELAY_MS);
    }
  } catch (err) {
    console.error('get-artist-tours error:', err.message);
    const timedOut = err.code === 'TIMEOUT';
    return {
      statusCode: timedOut ? 504 : 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: timedOut ? 'timeout' : 'upstream_error',
        message: timedOut
          ? 'setlist.fm took too long to answer. Try again.'
          : "Couldn't reach setlist.fm. Try again in a moment.",
        details: err.message,
      }),
    };
  }

  const { tours, totalShows } = parseTours(setlists);
  const responseBody = JSON.stringify({
    mbid,
    artistName,
    tours,
    totalShows,
    truncated,
    pagesWalked: Math.ceil(setlists.length / 20),
    fetchedAt: new Date().toISOString(),
  });

  writeEntry(db, cacheKey, { response: responseBody, ttlHours: CACHE_TTL_HOURS, queryParams: { artistMbid: mbid, kind: 'tours' } });

  return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' }, body: responseBody };
};
