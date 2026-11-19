// netlify/functions/get-tour-shows.js
//
// Every show on one artist's tour, in date order — the show list behind
// step 3 of the tour browse flow (components/tours/TourBrowseModal.jsx).
//
// WHY A SECOND FUNCTION: get-artist-tours.js walks an artist's most recent
// pages to discover tour *names*, so the nights it happens to see for any
// one tour are whatever fell inside those pages. Once a name is known,
// /search/setlists?artistMbid=&tourName= returns that tour and nothing
// else, which is both complete and far cheaper than walking further back
// through the artist's whole history.
//
// Same upstream discipline as get-artist-tours.js: serial paging with a
// delay, a page cap, a time budget, distinct handling for 404 / 429 /
// timeout, and results cached in the shared `setlistCache` collection
// (`tourshows_` key prefix) so two users browsing the same tour cost one
// upstream walk.
//
// PAGED MODE (5.60.37, native 4.0.43): with `page=N` the function answers
// for one setlist.fm page only, so the app can list the first nights while
// the rest are still on their way ("Loading 20 of 149 nights…") instead of
// waiting on the whole walk. Each page is cached on its own (`tourshowsp_`)
// for the same 12 hours, and the page that completes the tour also writes
// the whole-tour entry when every earlier page is still cached, so the next
// open (web or app) is one answer. Page 1 answers with the whole tour at
// once when that entry is fresh. Without `page` nothing changes: the web's
// TourBrowseModal still gets the whole tour in one response.
//
//   ?page=N → { artistMbid, tourName, shows[], page, pages, seen,
//               upstreamTotal, truncated, complete, fetchedAt }
//   `seen` of `upstreamTotal` is setlist.fm's own count of rows walked so
//   far (its tourName match is loose, so a few may be filtered out).
//
// Response: { artistMbid, tourName, shows[], total, truncated, fetchedAt }
// where each show is { setlistfmId, date (yyyy-MM-dd), artist, venue,
// city, state, country, tour, songCount, hasSetlist, sets } — everything
// the client needs to render the picker AND to build a show document
// identical to a normal setlist.fm import, without a second round trip.

const { withCors } = require('./lib/cors');
// setlist.fm's DD-MM-YYYY -> ISO, the app's own rule (lib/showDate.js, 5.60.5).
const { fromSetlistfmDate } = require('../../lib/showDate');
const { withProxyLimit } = require('./lib/proxyLimit');
const https = require('https');
const crypto = require('crypto');
const { setlistfmKey, missingSetlistfmKey } = require('./lib/setlistfmKey');
const { readFresh, writeEntry } = require('./lib/setlistCache');
const { USER_AGENT } = require('./lib/userAgent');

const CORS_HEADERS = { 'Content-Type': 'application/json' };

// 10 x 20 = 200 nights. Longer than any real tour; a tour that hits the
// cap comes back `truncated: true` rather than silently short.
const MAX_PAGES = 10;
const PAGE_DELAY_MS = 200;
const TIME_BUDGET_MS = 8000;
const REQUEST_TIMEOUT_MS = 6000;
const CACHE_TTL_HOURS = 12;

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

function fetchJSON(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.setlist.fm',
      path,
      method: 'GET',
      headers: {
        'x-api-key': setlistfmKey(),
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
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


// setlist.fm's tourName filter is a match, not an exact equality, so a
// query for "Summer Tour" can come back carrying "Summer Tour 2025" rows
// too. Filter to the requested tour by normalized name, the same
// normalization lib/tourBrowse.js uses client-side (case, whitespace and
// edge punctuation only — never the year, which is part of a tour's
// identity).
function normalizeTourName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .trim();
}

function toShow(sl) {
  const sets = sl.sets?.set || [];
  const songCount = sets.reduce((acc, s) => acc + (s.song?.length || 0), 0);
  return {
    setlistfmId: sl.id,
    url: sl.url || '',
    date: fromSetlistfmDate(sl.eventDate),
    artist: sl.artist?.name || '',
    venue: sl.venue?.name || '',
    city: sl.venue?.city?.name || '',
    state: sl.venue?.city?.state || '',
    country: sl.venue?.city?.country?.name || '',
    tour: sl.tour?.name || null,
    songCount,
    // A night with no setlist logged yet is still a night you were at —
    // addable, flagged as pending rather than hidden.
    hasSetlist: songCount > 0,
    // Passed through so the client can build the show document with the
    // app's existing extractSongsFromSetlist, exactly as SearchView does.
    sets: { set: sets },
  };
}

function wholeTourKey(mbid, wantedTour) {
  return `tourshows_${crypto.createHash('md5').update(`${mbid}|${wantedTour}`).digest('hex')}`;
}

function pageKey(mbid, wantedTour, page) {
  return `tourshowsp_${crypto.createHash('md5').update(`${mbid}|${wantedTour}|${page}`).digest('hex')}`;
}

/** setlist.fm rows → this tour's nights, one per setlist, in date order. */
function buildShows(setlists, wantedTour) {
  const seen = new Set();
  return setlists
    .filter(sl => normalizeTourName(sl.tour?.name) === wantedTour)
    .map(toShow)
    .filter(show => {
      // The same setlist can surface twice across pages when setlist.fm
      // re-ranks mid-walk; a duplicate here would render as two rows for
      // one night.
      if (!show.setlistfmId || seen.has(show.setlistfmId)) return false;
      seen.add(show.setlistfmId);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue));
}

function fetchSetlistPage(mbid, tourName, page) {
  const params = new URLSearchParams({ artistMbid: mbid, tourName, p: String(page) });
  return fetchJSON(`/rest/1.0/search/setlists?${params.toString()}`);
}

function upstreamFailure(err) {
  console.error('get-tour-shows error:', err.message);
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

const RATE_LIMITED = {
  statusCode: 429,
  headers: CORS_HEADERS,
  body: JSON.stringify({ error: 'rate_limited', message: 'setlist.fm is rate limiting us right now. Try again in a minute.' }),
};

/**
 * Once the last page is in: the whole tour from the cached pages, written
 * as the whole-tour entry. Skipped when any earlier page has expired.
 */
async function cacheWholeTour({ db, mbid, tourName, wantedTour, page, lastBody }) {
  if (!db) return;
  const earlier = await Promise.all(
    Array.from({ length: page - 1 }, (_, i) => readFresh(db, pageKey(mbid, wantedTour, i + 1)))
  );
  if (earlier.some(entry => !entry)) return;
  const pages = [...earlier.map(entry => JSON.parse(entry.response)), lastBody];
  // Already this tour's nights (buildShows ran per page); only duplicates
  // across pages and the order are left to settle.
  const merged = [];
  const ids = new Set();
  for (const show of pages.flatMap(p => p.shows || [])) {
    if (!show.setlistfmId || ids.has(show.setlistfmId)) continue;
    ids.add(show.setlistfmId);
    merged.push(show);
  }
  merged.sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue));
  await writeEntry(db, wholeTourKey(mbid, wantedTour), {
    response: JSON.stringify({
      artistMbid: mbid,
      tourName,
      shows: merged,
      total: merged.length,
      truncated: !!lastBody.truncated,
      fetchedAt: new Date().toISOString(),
    }),
    ttlHours: CACHE_TTL_HOURS,
    queryParams: { artistMbid: mbid, tourName, kind: 'tourShows' },
  });
}

/** `?page=N`: one setlist.fm page of the tour (see PAGED MODE above). */
async function tourPage({ mbid, tourName, page, db, fetchPage = fetchSetlistPage }) {
  const wantedTour = normalizeTourName(tourName);

  if (page === 1) {
    const whole = await readFresh(db, wholeTourKey(mbid, wantedTour));
    if (whole) {
      const parsed = JSON.parse(whole.response);
      const total = parsed.total ?? (parsed.shows || []).length;
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'X-Cache': 'HIT' },
        body: JSON.stringify({ ...parsed, page: 1, pages: 1, seen: total, upstreamTotal: total, complete: true }),
      };
    }
  }

  const key = pageKey(mbid, wantedTour, page);
  const cached = await readFresh(db, key);
  if (cached) {
    return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'HIT' }, body: cached.response };
  }

  let answer;
  try {
    answer = await fetchPage(mbid, tourName, page);
  } catch (err) {
    return upstreamFailure(err);
  }
  const { status, data } = answer;
  if (status === 429) return RATE_LIMITED;
  if (status !== 200 && status !== 404) return upstreamFailure(new Error(`setlist.fm returned ${status}`));
  if (status === 200 && !data) return upstreamFailure(new Error('setlist.fm sent no data'));

  // 404 is setlist.fm's "no results": no nights logged on page 1, or the
  // walk went off the end.
  const setlists = status === 404 ? [] : (data.setlist || []);
  const upstreamTotal = status === 404 ? 0 : (data.total || 0);
  const perPage = (data && data.itemsPerPage) || 20;
  const lastPage = Math.ceil(upstreamTotal / perPage);
  const pages = Math.min(lastPage, MAX_PAGES);
  const body = {
    artistMbid: mbid,
    tourName,
    shows: buildShows(setlists, wantedTour),
    page,
    pages: Math.max(pages, status === 404 ? page - 1 : page),
    seen: Math.min(page * perPage, upstreamTotal),
    upstreamTotal,
    truncated: lastPage > MAX_PAGES,
    complete: status === 404 || setlists.length === 0 || page >= pages,
    fetchedAt: new Date().toISOString(),
  };
  const responseBody = JSON.stringify(body);

  if (status === 200) {
    writeEntry(db, key, { response: responseBody, ttlHours: CACHE_TTL_HOURS, queryParams: { artistMbid: mbid, tourName, page, kind: 'tourShowsPage' } });
  }
  if (body.complete && status === 200) {
    cacheWholeTour({ db, mbid, tourName, wantedTour, page, lastBody: body }).catch(e => console.warn('[CACHE] whole tour:', e.message));
  }

  return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' }, body: responseBody };
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

  const { mbid, tourName, page: pageParam } = event.queryStringParameters || {};
  if (!mbid || !tourName) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'mbid and tourName are both required' }),
    };
  }

  if (pageParam !== undefined) {
    const page = Number(pageParam);
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGES) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: `page must be a whole number from 1 to ${MAX_PAGES}` }),
      };
    }
    return tourPage({ mbid, tourName, page, db: getDb() });
  }

  const wantedTour = normalizeTourName(tourName);
  const cacheKey = wholeTourKey(mbid, wantedTour);
  const db = getDb();

  // An expired entry is a miss, never a fallback (lib/setlistCache.js).
  const cached = await readFresh(db, cacheKey);
  if (cached) {
    console.log(`[CACHE HIT] tour shows mbid:${mbid} "${tourName}"`);
    return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'HIT' }, body: cached.response };
  }

  const startedAt = Date.now();
  const collected = [];
  let truncated = false;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { status, data } = await fetchSetlistPage(mbid, tourName, page);

      if (status === 404) {
        // setlist.fm's "no results" for a search. On page 1 that means the
        // tour has no shows logged — a real, distinct empty state, not an
        // error. Deeper in, it just means we walked off the end.
        break;
      }

      if (status === 429) {
        if (collected.length === 0) return RATE_LIMITED;
        truncated = true;
        break;
      }

      if (status !== 200 || !data) {
        if (collected.length === 0) throw new Error(`setlist.fm returned ${status}`);
        truncated = true;
        break;
      }

      const pageSetlists = data.setlist || [];
      collected.push(...pageSetlists);

      const total = data.total || 0;
      const perPage = data.itemsPerPage || 20;
      const lastPage = Math.ceil(total / perPage);

      if (page >= lastPage || pageSetlists.length === 0) break;
      if (page === MAX_PAGES) { truncated = true; break; }
      if (Date.now() - startedAt > TIME_BUDGET_MS) { truncated = true; break; }

      await sleep(PAGE_DELAY_MS);
    }
  } catch (err) {
    return upstreamFailure(err);
  }

  const shows = buildShows(collected, wantedTour);

  const responseBody = JSON.stringify({
    artistMbid: mbid,
    tourName,
    shows,
    total: shows.length,
    truncated,
    fetchedAt: new Date().toISOString(),
  });

  writeEntry(db, cacheKey, { response: responseBody, ttlHours: CACHE_TTL_HOURS, queryParams: { artistMbid: mbid, tourName, kind: 'tourShows' } });

  return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' }, body: responseBody };
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
// Per-IP daily limit on the shared setlists quota (lib/proxyLimit.js, 5.59.8).
module.exports.handler = withCors(withProxyLimit('setlists', module.exports.handler));
module.exports.tourPage = tourPage;
module.exports.MAX_PAGES = MAX_PAGES;
