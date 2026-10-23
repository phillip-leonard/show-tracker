// netlify/functions/lib/setlistfmSetlist.js
//
// One setlist.fm setlist by its id, through the shared 24-hour cache.
//
// Phase 1 of the setlist.fm compliance work (5.47.5) uses this for one
// thing: the attribution link. setlist.fm's API terms require a link to
// the setlist on setlist.fm wherever its data is shown, using the `url`
// each API response carries, and no show document stored that url — so
// the show page's link to setlist.fm never rendered. A show does store
// its `setlistfmId`, and GET /setlist/{id} returns the url.
//
// The whole response is cached (setlistCache, key `setlist_<id>`, 24
// hours), not just the url, so the on-demand setlists planned for phase 2
// (docs/setlistfm-compliance.md) read the same entries.
//
// Upstream discipline, shared by every caller:
//   - one request at a time, REQUEST_GAP_MS apart: setlist.fm allows about
//     two requests a second per key, and the key is shared by every user;
//   - a 429 is retried with backoff (1s, then 2s), never surfaced as an
//     error; an id still rate-limited after that comes back as `pending`;
//   - a time budget, so a Netlify function (10 seconds) returns what it has
//     rather than being killed holding nothing. Unreached ids are `pending`.

const https = require('https');
const { setlistfmKey } = require('./setlistfmKey');
const { readFresh, writeEntry } = require('./setlistCache');

const REQUEST_GAP_MS = 550;
const REQUEST_TIMEOUT_MS = 5000;
const RETRY_DELAYS_MS = [1000, 2000];
const DEFAULT_BUDGET_MS = 7000;
const TTL_HOURS = 24;

// setlist.fm setlist ids are short hex strings ("63de4613", "b99ed86").
const SETLIST_ID = /^[0-9a-f]{4,12}$/i;
const SETLISTFM_HOME = 'https://www.setlist.fm/';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isSetlistId(id) {
  return typeof id === 'string' && SETLIST_ID.test(id);
}

function cacheKey(id) {
  return `setlist_${id.toLowerCase()}`;
}

/** GET /rest/1.0/setlist/{id} -> { status, data } */
function fetchSetlist(id) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.setlist.fm',
      path: `/rest/1.0/setlist/${encodeURIComponent(id)}`,
      method: 'GET',
      headers: { 'x-api-key': setlistfmKey(), Accept: 'application/json', 'User-Agent': 'MySetlists/1.0 (+https://mysetlists.net)' },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = body ? JSON.parse(body) : null; } catch { data = null; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('setlist.fm timed out'), { code: 'TIMEOUT' })));
    req.on('error', reject);
    req.end();
  });
}

/** The attribution facts from one setlist.fm setlist response. */
function linkFrom(setlist) {
  return {
    url: typeof setlist?.url === 'string' && /^https:\/\/(www\.)?setlist\.fm\//.test(setlist.url) ? setlist.url : SETLISTFM_HOME,
    artist: setlist?.artist?.name || '',
  };
}

/**
 * Setlists by id, cache first. Returns
 *   { setlists: { [id]: <setlist.fm response> }, notFound: [ids], pending: [ids] }
 * `pending` holds ids not fetched this time (time budget, rate limit,
 * upstream error); a caller retries them later and links to setlist.fm's
 * home page in the meantime.
 *
 * `deps` exists for tests: { fetch, sleep, now }.
 */
async function getSetlists(db, ids, { budgetMs = DEFAULT_BUDGET_MS } = {}, deps = {}) {
  const fetchOne = deps.fetch || fetchSetlist;
  const wait = deps.sleep || sleep;
  const now = deps.now || Date.now;
  const startedAt = now();

  const wanted = [...new Set(ids.filter(isSetlistId))];
  const setlists = {};
  const notFound = [];
  const pending = [];

  const toFetch = [];
  for (const id of wanted) {
    const cached = await readFresh(db, cacheKey(id));
    if (cached) {
      try { setlists[id] = JSON.parse(cached.response); continue; } catch { /* refetch */ }
    }
    toFetch.push(id);
  }

  let first = true;
  for (const id of toFetch) {
    if (now() - startedAt > budgetMs) { pending.push(id); continue; }
    if (!first) await wait(REQUEST_GAP_MS);
    first = false;

    let result = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        result = await fetchOne(id);
      } catch (e) {
        result = { status: 0, error: e };
      }
      if (result.status !== 429 || attempt === RETRY_DELAYS_MS.length) break;
      if (now() - startedAt + RETRY_DELAYS_MS[attempt] > budgetMs) break;
      await wait(RETRY_DELAYS_MS[attempt]);
    }

    if (result.status === 200 && result.data) {
      setlists[id] = result.data;
      await writeEntry(db, cacheKey(id), { response: JSON.stringify(result.data), ttlHours: TTL_HOURS, queryParams: { kind: 'setlist', setlistId: id } });
    } else if (result.status === 404) {
      notFound.push(id);
    } else {
      if (result.status === 429) console.warn(`[setlistfm] still rate limited for ${id} after retries`);
      else console.warn(`[setlistfm] setlist ${id}: ${result.error?.message || `HTTP ${result.status}`}`);
      pending.push(id);
    }
  }

  return { setlists, notFound, pending };
}

// ── Attribution on server-rendered pages (public-show, public-profile,
// public-shared). The browser side is lib/setlistfmAttribution.js and
// components/shows/SetlistfmAttribution.jsx; keep the wording the same.

/** True for a show whose setlist came from setlist.fm (no band source). */
function isSetlistfmShow(show) {
  if (!show?.setlistfmId) return false;
  return !show.setlistSource || show.setlistSource === 'setlistfm';
}

/**
 * The attribution url for one show: the stored `setlistfmUrl`, otherwise
 * setlist.fm's answer for its id (through the cache), otherwise the home
 * page. Never throws; a page render never waits more than `budgetMs`.
 */
async function setlistfmUrlFor(db, show, { budgetMs = 2500 } = {}, deps = {}) {
  const stored = show?.setlistfmUrl;
  if (typeof stored === 'string' && /^https:\/\/(www\.)?setlist\.fm\//.test(stored)) return stored;
  const id = String(show?.setlistfmId || '');
  if (!isSetlistId(id) || !setlistfmKey()) return SETLISTFM_HOME;
  try {
    const { setlists } = await getSetlists(db, [id], { budgetMs }, deps);
    return setlists[id] ? linkFrom(setlists[id]).url : SETLISTFM_HOME;
  } catch {
    return SETLISTFM_HOME;
  }
}

const escapeAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CREDIT_STYLE = 'font-size:12px;color:#b7b6c9;margin:16px 0 0;';
const LINK_STYLE = 'color:inherit;text-decoration:underline dotted;';

/** "Source: {Band} setlist on setlist.fm", followable (no rel="nofollow"). */
function attributionHtml(url, band) {
  const text = band ? `${band} setlist on setlist.fm` : 'setlist on setlist.fm';
  return `<p style="${CREDIT_STYLE}">Source: <a href="${escapeAttr(url || SETLISTFM_HOME)}" style="${LINK_STYLE}">${escapeAttr(text)}</a></p>`;
}

/** A general credit for a page built from many setlist.fm setlists. */
function creditHtml(label = 'Show and setlist data from setlist.fm') {
  return `<p style="${CREDIT_STYLE}"><a href="${SETLISTFM_HOME}" style="${LINK_STYLE}">${escapeAttr(label)}</a></p>`;
}

module.exports = {
  getSetlists, linkFrom, isSetlistId, isSetlistfmShow, setlistfmUrlFor, attributionHtml, creditHtml,
  SETLISTFM_HOME, REQUEST_GAP_MS, RETRY_DELAYS_MS,
};
