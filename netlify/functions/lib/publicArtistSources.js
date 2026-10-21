// netlify/functions/lib/publicArtistSources.js
//
// Fetches an artist's show history for the public band-page snapshot
// (publicArtistSnapshot.js) and normalizes it to one shape, whatever the
// source:
//
//   { id, date: 'YYYY-MM-DD', order, venue, city, state, country, url,
//     songs: [{ key, slug, name, original, originalArtist, sourceUrl }] }
//
// Three sources, each asked the cheapest way it allows:
//
//   songfish   elgoose.net, allthings.umphreys.com, kglw.net. One request
//              per YEAR: /api/v2/setlists/showyear/<y>.json returns every
//              setlist row for that year, every act in the archive, flat.
//              A plain artist query (/setlists/artist_id/1.json) is capped
//              at 4,000 rows with no working offset, which is a fraction of
//              Umphrey's history, so it can't be used. No year comes close
//              to 4,000 rows today; one that does is refused, not truncated.
//   phishnet   the same per-year call on api.phish.net/v5, keyed.
//   setlistfm  /artist/<mbid>/setlists?p=<n>, 20 per page, newest first.
//              Only a window of recent setlists is fetched (see
//              publicArtistSnapshot.js), because full histories run to 150+
//              pages per band and setlist.fm allows about 2 requests/second.
//
// Every call goes through `ctx.request`, which spaces requests per host and
// retries 429s, 5xxs and timeouts with backoff (createRequester below).

const https = require('https');
const { fetchSongfishJson, readEnvelope: readSongfishEnvelope } = require('./elgooseAdapter');
const { fetchPhishnetJson, readEnvelope: readPhishnetEnvelope, splitSetCode } = require('./phishnetAdapter');
const { normalizeSongTitle } = require('./bandSetlistMergeRule');
const { isoDate } = require('./publicPageHtml');
const { slugify } = require('./artistSnapshotStats');

const USER_AGENT = 'MySetlists/5.45 (+https://mysetlists.net)';
const TIMEOUT_MS = 30000;
// Songfish answers a plain artist query with at most this many rows, and a
// year query is the same endpoint, so a year at the cap may be cut short.
const SONGFISH_ROW_CAP = 4000;

// setlist.fm asks for no more than 2 requests/second. 600ms keeps a margin
// for the app's own setlist.fm traffic on the same key.
const MIN_INTERVAL_MS = { setlistfm: 600, songfish: 500, phishnet: 500 };

const sleepFor = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Polite requests ───────────────────────────────────────────────────

class SourceError extends Error {}

/**
 * Returns request(sourceKey, call): waits until at least MIN_INTERVAL_MS
 * has passed since the last call to the same source, runs `call` (which
 * resolves { statusCode, data }), and retries a 429, a 5xx or a thrown
 * error up to 3 more times, backing off 2s, 4s, 8s (or Retry-After).
 * Counts every attempt per source, for the run report.
 */
function createRequester({ sleep = sleepFor, now = Date.now } = {}) {
  const last = {};
  const calls = {};
  const retries = {};

  async function request(source, call) {
    const interval = MIN_INTERVAL_MS[source] || 500;
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = (last[source] || 0) + interval - now();
      if (wait > 0) await sleep(wait);
      last[source] = now();
      calls[source] = (calls[source] || 0) + 1;
      if (attempt > 0) retries[source] = (retries[source] || 0) + 1;

      let res;
      try {
        res = await call();
      } catch (err) {
        lastError = err;
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (res.statusCode === 429 || res.statusCode >= 500) {
        lastError = new SourceError(`${source} returned HTTP ${res.statusCode}`);
        const retryAfter = Number(res.retryAfter);
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
        continue;
      }
      return res;
    }
    throw lastError || new SourceError(`${source} request failed`);
  }

  return { request, calls, retries };
}

// Songfish and setlist.fm both hand back HTML entities in names
// ("Martyrs&#039;"). Decoded here so the page templates can escape once.
function decodeEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function groupShows(rows, toShow, toSong) {
  const shows = new Map();
  for (const row of rows) {
    const show = toShow(row);
    if (!show.id || !show.date) continue;
    if (!shows.has(show.id)) shows.set(show.id, { ...show, songs: [] });
    const song = toSong(row);
    if (song) shows.get(show.id).songs.push(song);
  }
  // A show whose every row was a soundcheck has no setlist to count.
  return [...shows.values()].filter((s) => s.songs.length > 0);
}

// ── Songfish ──────────────────────────────────────────────────────────

function songfishShowsFromRows(rows, artist) {
  const host = artist.host;
  const own = rows.filter((r) => Number(r.artist_id) === Number(artist.artistId));
  return groupShows(
    own,
    (r) => ({
      id: String(r.show_id || ''),
      date: isoDate(r.showdate),
      order: Number(r.showorder) || 0,
      venue: decodeEntities(r.venuename),
      city: decodeEntities(r.city),
      state: decodeEntities(r.state),
      country: decodeEntities(r.country),
      url: r.permalink ? `https://${host}/setlists/${String(r.permalink).replace(/^\/+/, '')}` : '',
    }),
    (r) => {
      // `soundcheck` on a Songfish row is the show's soundcheck LIST,
      // repeated on every row, not a flag on this one; only a Soundcheck
      // settype marks the row itself.
      if (/soundcheck/i.test(String(r.settype || ''))) return null;
      const name = decodeEntities(r.songname);
      if (!name || r.song_id == null) return null;
      const slug = String(r.slug || '');
      const original = r.isoriginal == null || r.isoriginal === '' ? null : Number(r.isoriginal) === 1;
      return {
        key: `sf:${r.song_id}`,
        slug,
        name,
        original,
        originalArtist: decodeEntities(r.original_artist),
        sourceUrl: slug ? `https://${host}/song/${slug}` : '',
      };
    },
  );
}

async function fetchSongfishYear(artist, year, ctx) {
  const res = await ctx.request('songfish', () =>
    fetchSongfishJson(`/api/v2/setlists/showyear/${year}.json`, { hostname: artist.host, timeoutMs: TIMEOUT_MS }));
  if (res.statusCode !== 200) throw new SourceError(`${artist.host} returned HTTP ${res.statusCode} for ${year}`);
  const env = readSongfishEnvelope(res.data);
  if (!env.ok) throw new SourceError(`${artist.host} ${year}: ${env.message}`);
  if (env.rows.length >= SONGFISH_ROW_CAP) {
    throw new SourceError(`${artist.host} ${year}: ${env.rows.length} rows, at the archive's row cap; refusing a possibly truncated year`);
  }
  return songfishShowsFromRows(env.rows, artist);
}

// ── phish.net ─────────────────────────────────────────────────────────

function phishnetShowsFromRows(rows, artist) {
  // artist_slug is on every row (checked against a live response with
  // band-setlist's debug=1); phish.net also lists side projects.
  const own = rows.filter((r) => (r.artist_slug != null
    ? String(r.artist_slug) === artist.artistSlug
    : Number(r.artistid) === 1));
  return groupShows(
    own,
    (r) => ({
      id: String(r.showid || ''),
      date: isoDate(r.showdate),
      order: 0,
      venue: decodeEntities(r.venue),
      city: decodeEntities(r.city),
      state: decodeEntities(r.state),
      country: decodeEntities(r.country),
      url: String(r.permalink || ''),
    }),
    (r) => {
      if (splitSetCode(r.set).setType === 'soundcheck') return null;
      const name = decodeEntities(r.song);
      if (!name || r.songid == null) return null;
      const slug = String(r.slug || '');
      const original = r.is_original == null || r.is_original === '' ? null : Number(r.is_original) === 1;
      return {
        key: `pn:${r.songid}`,
        slug,
        name,
        original,
        originalArtist: '',
        sourceUrl: slug ? `https://phish.net/song/${slug}` : '',
      };
    },
  );
}

async function fetchPhishnetYear(artist, year, ctx, apiKey) {
  const res = await ctx.request('phishnet', () =>
    fetchPhishnetJson(`/v5/setlists/showyear/${year}.json`, apiKey, { timeoutMs: TIMEOUT_MS }));
  if (res.statusCode !== 200) throw new SourceError(`phish.net returned HTTP ${res.statusCode} for ${year}`);
  const env = readPhishnetEnvelope(res.data);
  if (!env.ok) throw new SourceError(`phish.net ${year}: ${env.message}`);
  return phishnetShowsFromRows(env.rows, artist);
}

// ── setlist.fm ────────────────────────────────────────────────────────

function getSetlistfmJson(path, apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.setlist.fm',
      path: `/rest/1.0${path}`,
      method: 'GET',
      headers: { 'x-api-key': apiKey, Accept: 'application/json', 'User-Agent': USER_AGENT },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(body); } catch { /* non-JSON error page */ }
        resolve({ statusCode: res.statusCode, data, retryAfter: res.headers['retry-after'] });
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error('setlist.fm request timed out')); });
    req.end();
  });
}

function setlistfmShow(sl) {
  const city = sl.venue?.city || {};
  const songs = [];
  for (const set of sl.sets?.set || []) {
    for (const song of set.song || []) {
      const name = decodeEntities(song.name);
      // `tape` is a recording played over the PA, not a performance.
      if (!name || song.tape) continue;
      const normalized = normalizeSongTitle(name);
      if (!normalized) continue;
      songs.push({
        key: `fm:${normalized}`,
        slug: slugify(normalized),
        name,
        original: song.cover ? false : null,
        originalArtist: song.cover ? decodeEntities(song.cover.name) : '',
        sourceUrl: '',
      });
    }
  }
  return {
    id: String(sl.id || ''),
    date: isoDate(sl.eventDate),
    order: 0,
    venue: decodeEntities(sl.venue?.name),
    city: decodeEntities(city.name),
    state: decodeEntities(city.stateCode),
    country: decodeEntities(city.country?.code),
    url: sl.url || '',
    lastUpdated: sl.lastUpdated || '',
    songs,
  };
}

/** One page: { total, itemsPerPage, setlists: [normalized show], artistUrl } */
async function fetchSetlistfmPage(artist, page, ctx, apiKey) {
  const res = await ctx.request('setlistfm', () =>
    getSetlistfmJson(`/artist/${encodeURIComponent(artist.mbid)}/setlists?p=${page}`, apiKey));
  // setlist.fm answers a page past the end with 404.
  if (res.statusCode === 404) return { total: 0, itemsPerPage: 20, setlists: [], artistUrl: '' };
  if (res.statusCode !== 200 || !res.data) throw new SourceError(`setlist.fm returned HTTP ${res.statusCode} for ${artist.slug} page ${page}`);
  const list = Array.isArray(res.data.setlist) ? res.data.setlist : [];
  return {
    total: Number(res.data.total) || 0,
    itemsPerPage: Number(res.data.itemsPerPage) || 20,
    setlists: list.map(setlistfmShow).filter((s) => s.id && s.date),
    artistUrl: list[0]?.artist?.url || '',
  };
}

module.exports = {
  SourceError,
  createRequester,
  decodeEntities,
  fetchSongfishYear,
  fetchPhishnetYear,
  fetchSetlistfmPage,
  songfishShowsFromRows,
  phishnetShowsFromRows,
  setlistfmShow,
};
