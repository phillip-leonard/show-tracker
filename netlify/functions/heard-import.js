// netlify/functions/heard-import.js
//
//   GET /api/heard-import?slug=<slug>&user=<setlist.fm username>
//     -> { ok, ids, unmatched, attended, scanned, truncated }
//
// The "Import from setlist.fm" button on /heard/<slug>/: reads the user's
// public "I was there" list from setlist.fm and returns the band's shows it
// matches (lib/heardImport.js). Nothing is stored.
//
// setlist.fm allows about 2 requests a second on our key, shared with the
// app and the snapshot job, and a function has 10 seconds. So page 1 comes
// first (it says how many pages there are), then the rest are started
// SPACING_MS apart without waiting for each other, up to MAX_PAGES (the
// newest 240 attended shows, every artist mixed) or the deadline, and the
// reply says when it stopped short. A 429 is reported as 'busy' rather
// than retried: the person can press the button again.

const { findArtist, hasShowList, openBlobStore, loadArtistShows, availability } = require('./lib/publicArtistSnapshot');
const { getSetlistfmJson } = require('./lib/publicArtistSources');
const { matchAttended } = require('./lib/heardImport');

const MAX_PAGES = 12;
const SPACING_MS = 550;
const DEADLINE_MS = 8000;
const USER = /^[A-Za-z0-9_.-]{1,64}$/;

const reply = (statusCode, body, cache = 'no-store') => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, 'Netlify-Vary': 'query' },
  body: JSON.stringify(body),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const slug = String(q.slug || '').toLowerCase();
  const user = String(q.user || '').trim().replace(/^@/, '');
  const artist = /^[a-z0-9-]+$/.test(slug) && findArtist(slug);
  if (!artist || !hasShowList(artist) || !artist.setlistfmMbid) return reply(404, { ok: false, error: 'unknown_band' });
  if (!USER.test(user)) return reply(404, { ok: false, error: 'not_found' });
  const apiKey = process.env.SETLISTFM_API_KEY;
  if (!apiKey) return reply(503, { ok: false, error: 'unavailable' });

  try {
    const loaded = await loadArtistShows(openBlobStore(event), slug);
    if (!loaded || !availability(loaded.entry).available) return reply(503, { ok: false, error: 'unavailable' });

    const started = Date.now();
    const fetchPage = (page) => getSetlistfmJson(`/user/${encodeURIComponent(user)}/attended?p=${page}`, apiKey);
    const first = await fetchPage(1);
    if (first.statusCode === 404) return reply(404, { ok: false, error: 'not_found' }, 'public, s-maxage=300');
    if (first.statusCode === 429) return reply(429, { ok: false, error: 'busy' });
    if (first.statusCode !== 200 || !first.data) return reply(502, { ok: false, error: 'upstream' });

    const perPage = Number(first.data.itemsPerPage) || 20;
    const pages = Math.ceil((Number(first.data.total) || 0) / perPage);
    let truncated = pages > MAX_PAGES;
    const wanted = Math.min(pages, MAX_PAGES);
    const later = [];
    for (let page = 2; page <= wanted; page++) {
      await sleep(SPACING_MS);
      if (Date.now() - started > DEADLINE_MS - 1500) { truncated = true; break; }
      later.push(fetchPage(page).catch(() => ({ statusCode: 0 })));
    }
    const setlists = [...(first.data.setlist || [])];
    for (const res of await Promise.all(later)) {
      // A page that failed or hit the rate limit is reported as a short read.
      if (res.statusCode !== 200 || !res.data) { truncated = true; continue; }
      setlists.push(...(Array.isArray(res.data.setlist) ? res.data.setlist : []));
    }
    const scanned = setlists.length;

    const matched = matchAttended(loaded.shows, setlists, artist.setlistfmMbid);
    return reply(200, { ok: true, ...matched, scanned, truncated }, 'public, s-maxage=900');
  } catch (err) {
    console.error('heard-import error:', err);
    return reply(502, { ok: false, error: 'upstream' });
  }
};
