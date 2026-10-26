// netlify/functions/heard-import.js
//
//   GET /api/heard-import?slug=<slug>&user=<setlist.fm username>&page=<n>
//     -> { ok, page, pages, total, itemsPerPage, count, nights }
//
// The "Import from setlist.fm" button on /heard/<slug>/: reads one page of
// the user's public "I was there" list from setlist.fm (20 setlists, every
// artist mixed) and returns the band's nights on it, each matched to an
// archive show or not (lib/heardImport.js matchNights). `count` is how many
// setlists the page held, for the progress line; `pages` and `total` say
// how much there is. Nothing is stored but the short-lived cache below.
//
// One page a call, so no call comes near the 10-second limit, however many
// shows the user has been to. The browser asks for the pages one after
// another, about 2 a second, and retries (lib/heardImportPaging.js). A 429
// is passed back with setlist.fm's Retry-After, for the browser to wait on.
// A page past the end (the list got shorter between pages) is an empty
// page, not an unknown user.
//
// Each page is cached for CACHE_TTL_HOURS in setlistCache (lib/setlistCache.js
// holds every entry to 24 hours at most), keyed by username and page and
// shared by the four bands, so importing a second band, or importing again
// after Cancel, doesn't ask setlist.fm twice. Only what the matching reads
// is kept: each setlist's artist mbid, date, venue and city.

const { findArtist, hasShowList, openBlobStore, loadArtistShows, availability } = require('./lib/publicArtistSnapshot');
const { getSetlistfmJson } = require('./lib/publicArtistSources');
const { matchNights } = require('./lib/heardImport');
const { readFresh, writeEntry } = require('./lib/setlistCache');

const USER = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_PAGE = 1000;
const CACHE_TTL_HOURS = 1;

const reply = (statusCode, body, cache = 'no-store') => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, 'Netlify-Vary': 'query' },
  body: JSON.stringify(body),
});

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
    return require('firebase-admin/firestore').getFirestore();
  } catch (e) {
    console.warn('[CACHE] Firebase init failed:', e.message);
    return null;
  }
}

const cacheKey = (user, page) => `attended_${user.toLowerCase()}_${page}`;

/** What the matching needs from one attended page, and no more. */
function trimPage(data) {
  const list = Array.isArray(data.setlist) ? data.setlist : [];
  return {
    total: Number(data.total) || 0,
    itemsPerPage: Number(data.itemsPerPage) || 20,
    setlist: list.map((sl) => ({
      artist: { mbid: sl && sl.artist && sl.artist.mbid },
      eventDate: sl && sl.eventDate,
      venue: { name: sl && sl.venue && sl.venue.name, city: { name: sl && sl.venue && sl.venue.city && sl.venue.city.name } },
    })),
  };
}

/** { page } from the cache or setlist.fm, or { statusCode, retryAfter } when it can't. */
async function attendedPage(db, user, page, apiKey) {
  const key = cacheKey(user, page);
  const cached = await readFresh(db, key);
  if (cached) {
    try { return { page: JSON.parse(cached.response) }; } catch { /* a bad entry: fetch again */ }
  }
  const res = await getSetlistfmJson(`/user/${encodeURIComponent(user)}/attended?p=${page}`, apiKey);
  if (res.statusCode !== 200 || !res.data) return { statusCode: res.statusCode, retryAfter: res.retryAfter };
  const trimmed = trimPage(res.data);
  await writeEntry(db, key, { response: JSON.stringify(trimmed), ttlHours: CACHE_TTL_HOURS, queryParams: { kind: 'attended', user, page } });
  return { page: trimmed };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const slug = String(q.slug || '').toLowerCase();
  const user = String(q.user || '').trim().replace(/^@/, '');
  const page = q.page == null || q.page === '' ? 1 : Number(q.page);
  const artist = /^[a-z0-9-]+$/.test(slug) && findArtist(slug);
  if (!artist || !hasShowList(artist) || !artist.setlistfmMbid) return reply(404, { ok: false, error: 'unknown_band' });
  if (!USER.test(user)) return reply(404, { ok: false, error: 'not_found' });
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) return reply(400, { ok: false, error: 'bad_page' });
  const apiKey = process.env.SETLISTFM_API_KEY;
  if (!apiKey) return reply(503, { ok: false, error: 'unavailable' });

  try {
    const loaded = await loadArtistShows(openBlobStore(event), slug);
    if (!loaded || !availability(loaded.entry).available) return reply(503, { ok: false, error: 'unavailable' });

    const got = await attendedPage(getDb(), user, page, apiKey);
    if (got.statusCode === 404 && page === 1) return reply(404, { ok: false, error: 'not_found' }, 'public, s-maxage=300');
    if (got.statusCode === 404) return reply(200, { ok: true, page, pages: page - 1, total: 0, itemsPerPage: 20, count: 0, nights: [] });
    if (got.statusCode === 429) {
      const retryAfter = Number(got.retryAfter) || 0;
      return reply(429, { ok: false, error: 'busy', ...(retryAfter > 0 ? { retryAfter } : {}) });
    }
    if (!got.page) return reply(502, { ok: false, error: 'upstream' });

    const { total, itemsPerPage, setlist } = got.page;
    return reply(200, {
      ok: true,
      page,
      pages: Math.max(1, Math.ceil(total / itemsPerPage)),
      total,
      itemsPerPage,
      count: setlist.length,
      nights: matchNights(loaded.shows, setlist, artist.setlistfmMbid),
    }, 'public, s-maxage=900');
  } catch (err) {
    console.error('heard-import error:', err);
    return reply(502, { ok: false, error: 'upstream' });
  }
};

exports.trimPage = trimPage;
