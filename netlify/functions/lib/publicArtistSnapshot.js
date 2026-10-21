// netlify/functions/lib/publicArtistSnapshot.js
//
// The public band and song pages (/artist/<slug>/, /artist/<slug>/song/<song>/),
// the /artists index, the artist sitemap and the /api/artist JSON all read
// one snapshot, written by one job. This module is both halves: the job
// (runSnapshot) and the reads (loadIndex, loadArtist, availability).
//
// ── Storage: Netlify Blobs, store "public-artists" ────────────────────
//
//   index.json          every published artist: name, source, fetchedAt,
//                       data hash, counts, last error. Small; read by every
//                       page.
//   artists/<slug>.json one artist's published snapshot: band stats and,
//                       for song-page artists, every song.
//   raw/<slug>.json     what the source last returned, so a routine run only
//                       asks for what can have changed (see below).
//   runs/latest.json    the last run's report.
//   trigger/<nonce>     one-shot run tokens (public-artist-snapshot-background.js).
//
// A site-wide store, so a manual run on a deploy preview writes the same
// data production reads. Every write goes through the same keep-last-good
// checks, so a preview can't publish an empty or partial snapshot either.
//
// ── Keep last good ────────────────────────────────────────────────────
//
// An artist's snapshot is replaced only by a complete, successful fetch
// that passes looksComplete(). Any failed request (after retries), a
// refused Songfish year, or a result with noticeably fewer shows than the
// one it would replace leaves the published snapshot exactly as it was and
// records the error on the index entry. Nothing partial or empty is ever
// published.
//
// ── What a run fetches ────────────────────────────────────────────────
//
//   Songfish, phish.net  all years on the first run and once a week after;
//                        otherwise only this year and last year, the rest
//                        coming from raw/<slug>.json.
//   setlist.fm           a window of the newest WINDOW_PAGES pages (and the
//                        last page, once, for the first show) on the first
//                        run and weekly; otherwise page 1 onward until a page
//                        holds nothing new.
//
// Phish runs every 6 hours, everyone else daily (REFRESH_HOURS): phish.net's
// terms allow showing its data for at most 24 hours, and a daily refresh
// would leave a window every day where the newest Phish data is just over
// that.

const crypto = require('crypto');
const config = require('../../../config/public-artists.json');
const { buildArtistStats } = require('./artistSnapshotStats');
const sources = require('./publicArtistSources');

const SCHEMA_VERSION = 1;
const STORE_NAME = 'public-artists';
const INDEX_KEY = 'index.json';
const artistKey = (slug) => `artists/${slug}.json`;
const rawKey = (slug) => `raw/${slug}.json`;

const HOUR = 3600 * 1000;
const REFRESH_HOURS = { phishnet: 6, songfish: 24, setlistfm: 24 };
// A run starts each artist only if its data is at least this close to due,
// so a 6-hourly schedule refreshes a 24-hour artist once a day and not
// twice when the run times drift by a few minutes.
const REFRESH_SLACK_HOURS = 1;
const FULL_REFRESH_DAYS = 7;
const PHISHNET_MAX_AGE_HOURS = 24;
const WINDOW_PAGES = 15; // 300 setlists
// The background function gets 15 minutes. Stop starting artists with a
// margin left; whoever is skipped keeps their last good snapshot and goes
// first next time, since they are the most overdue.
const RUN_BUDGET_MS = 12 * 60 * 1000;
// A new full history may lose a few shows (an archive merging duplicates),
// not a tenth of them. More than that is treated as a partial fetch.
const MIN_COMPLETE_RATIO = 0.9;

const ATTRIBUTION = {
  phishnet: { text: 'Setlist data courtesy of Phish.net', url: 'https://phish.net/' },
  setlistfm: { text: 'Setlist data from setlist.fm', url: 'https://www.setlist.fm/' },
};

function publicArtists() {
  return config.artists;
}

function findArtist(slug) {
  return config.artists.find((a) => a.slug === slug) || null;
}

function attributionFor(artist, artistUrl) {
  if (artist.source === 'songfish') {
    return { text: `Setlist data from ${artist.sourceName}`, url: `https://${artist.host}/` };
  }
  const base = ATTRIBUTION[artist.source];
  return artist.source === 'setlistfm' && artistUrl ? { ...base, url: artistUrl } : base;
}

const hashOf = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const todayUtc = (now) => new Date(now).toISOString().slice(0, 10);

// ── Store adapter ─────────────────────────────────────────────────────
//
// The job and the pages take { get(key) -> parsed JSON | null,
// set(key, value), delete(key) }. In a function that is Netlify Blobs
// (openBlobStore); in the tests and the local runner, a Map or a folder.

function openBlobStore(event, { strong = false } = {}) {
  const { connectLambda, getStore } = require('@netlify/blobs');
  // Lambda-compatibility (exports.handler) functions must hand the event
  // to Blobs first; that is where the store's credentials arrive.
  if (event) connectLambda(event);
  const store = getStore({ name: STORE_NAME, consistency: strong ? 'strong' : 'eventual' });
  return {
    get: (key) => store.get(key, { type: 'json' }),
    set: (key, value) => store.setJSON(key, value),
    delete: (key) => store.delete(key),
  };
}

// ── Raw cache (de)serialization ───────────────────────────────────────
//
// Song objects repeat on every show, so the cache stores each song once
// and shows as lists of song keys: Umphrey's ~3,000 shows come to a couple
// of MB instead of ten.

function packShows(shows, songs) {
  return shows.map(({ songs: list, ...show }) => {
    for (const s of list) if (!songs[s.key]) { const { key, ...rest } = s; songs[s.key] = rest; }
    return { ...show, songs: list.map((s) => s.key) };
  });
}

function unpackShows(shows, songs) {
  return (shows || []).map((show) => ({
    ...show,
    songs: show.songs.map((key) => ({ key, ...(songs[key] || {}) })).filter((s) => s.name),
  }));
}

// ── Fetch, per source ─────────────────────────────────────────────────

async function fetchByYears(artist, raw, { ctx, now, full, apiKey }) {
  const currentYear = new Date(now).getUTCFullYear();
  const cachedSongs = raw?.songs || {};
  const years = {};
  for (const [y, shows] of Object.entries(raw?.years || {})) years[y] = unpackShows(shows, cachedSongs);

  const wanted = [];
  for (let y = artist.firstYear; y <= currentYear; y++) {
    if (full || y >= currentYear - 1 || !years[y]) wanted.push(y);
  }

  for (const year of wanted) {
    years[year] = artist.source === 'phishnet'
      ? await sources.fetchPhishnetYear(artist, year, ctx, apiKey)
      : await sources.fetchSongfishYear(artist, year, ctx);
  }

  const songs = {};
  const packedYears = {};
  for (const [y, shows] of Object.entries(years)) packedYears[y] = packShows(shows, songs);

  return {
    shows: Object.values(years).flat(),
    raw: { kind: 'years', songs, years: packedYears, fullFetchedAt: full ? new Date(now).toISOString() : raw.fullFetchedAt },
    coverage: { kind: 'full' },
    artistUrl: '',
    yearsFetched: wanted.length,
  };
}

async function fetchSetlistfmWindow(artist, raw, { ctx, now, full, apiKey }) {
  const cachedSongs = raw?.songs || {};
  const known = new Map();
  if (!full) for (const s of unpackShows(raw?.setlists, cachedSongs)) known.set(s.id, s);

  let total = raw?.total || 0;
  let artistUrl = raw?.artistUrl || '';
  let pagesFetched = 0;
  const fresh = new Map();

  for (let page = 1; page <= WINDOW_PAGES; page++) {
    const res = await sources.fetchSetlistfmPage(artist, page, ctx, apiKey);
    pagesFetched++;
    if (page === 1) { total = res.total; artistUrl = res.artistUrl || artistUrl; }
    let anythingNew = false;
    for (const s of res.setlists) {
      const before = known.get(s.id);
      if (!before || before.lastUpdated !== s.lastUpdated) anythingNew = true;
      fresh.set(s.id, s);
    }
    const lastPage = Math.ceil(res.total / (res.itemsPerPage || 20));
    if (!res.setlists.length || page >= lastPage) break;
    if (!full && !anythingNew) break;
  }

  // The oldest setlist, for "first show". It never changes, so it is
  // fetched on a full refresh only (or if the cache never got it).
  let oldest = full ? null : raw?.oldest || null;
  const lastPage = Math.ceil(total / 20);
  if (!oldest && lastPage > WINDOW_PAGES) {
    const res = await sources.fetchSetlistfmPage(artist, lastPage, ctx, apiKey);
    pagesFetched++;
    const list = res.setlists.slice().sort((a, b) => a.date.localeCompare(b.date));
    oldest = list[0] || null;
  }

  const merged = new Map(known);
  for (const [id, s] of fresh) merged.set(id, s);
  const windowShows = [...merged.values()]
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .slice(0, WINDOW_PAGES * 20);
  if (!oldest) oldest = windowShows[windowShows.length - 1] || null;

  const songs = {};
  return {
    shows: windowShows,
    raw: {
      kind: 'window',
      songs,
      setlists: packShows(windowShows, songs),
      oldest: oldest ? { ...oldest, songs: [] } : null,
      total,
      artistUrl,
      fullFetchedAt: full ? new Date(now).toISOString() : raw.fullFetchedAt,
    },
    total,
    oldest,
    artistUrl,
    pagesFetched,
  };
}

// ── Build, check, publish one artist ──────────────────────────────────

function buildSnapshot(artist, fetched, now) {
  const today = todayUtc(now);
  // Only shows that have happened and have a setlist. setlist.fm lists
  // upcoming dates, and a show from last night whose setlist nobody has
  // entered yet would otherwise count as a show where nothing was played.
  const shows = fetched.shows.filter((s) => s.date <= today && s.songs.length > 0);
  const { band, songs } = buildArtistStats(shows);

  let coverage = { kind: 'full', shows: shows.length };
  if (artist.source === 'setlistfm') {
    const upcoming = fetched.shows.filter((s) => s.date > today).length;
    band.totalShows = Math.max(shows.length, fetched.total - upcoming);
    if (fetched.oldest) {
      band.firstShow = {
        date: fetched.oldest.date,
        venue: fetched.oldest.venue,
        city: [fetched.oldest.city, fetched.oldest.state || fetched.oldest.country].filter(Boolean).join(', '),
        url: fetched.oldest.url,
      };
    }
    coverage = {
      kind: 'window',
      shows: shows.length,
      from: shows.length ? shows.reduce((m, s) => (s.date < m ? s.date : m), shows[0].date) : null,
      to: band.lastShow ? band.lastShow.date : null,
    };
  }

  const songLinks = new Set(artist.songPages ? songs.map((s) => s.slug) : []);
  const linked = (list) => list.map((s) => ({ ...s, hasPage: songLinks.has(s.slug) }));

  return {
    schemaVersion: SCHEMA_VERSION,
    slug: artist.slug,
    name: artist.name,
    source: artist.source,
    sourceName: artist.source === 'setlistfm' ? 'setlist.fm' : artist.sourceName,
    attribution: attributionFor(artist, fetched.artistUrl),
    songPages: !!artist.songPages,
    coverage,
    band: { ...band, mostPlayed: linked(band.mostPlayed), gapLeaders: linked(band.gapLeaders) },
    songs: artist.songPages ? songs : [],
  };
}

/** Why a new snapshot can't replace the old one, or '' if it can. */
function looksComplete(next, previousEntry) {
  if (!next.band.totalShows || !next.coverage.shows) return 'no shows with setlists';
  if (!next.band.mostPlayed.length) return 'no songs';
  const before = previousEntry?.coverageShows || 0;
  if (before && next.coverage.shows < before * MIN_COMPLETE_RATIO) {
    return `${next.coverage.shows} shows with setlists, down from ${before}; treating as a partial fetch`;
  }
  return '';
}

function isDue(entry, artist, now, force) {
  if (force) return true;
  if (!entry?.fetchedAt) return true;
  const hours = (REFRESH_HOURS[artist.source] || 24) - REFRESH_SLACK_HOURS;
  return now - Date.parse(entry.fetchedAt) >= hours * HOUR;
}

async function runArtist(artist, { store, ctx, env, now, force, entry }) {
  const apiKey = artist.source === 'phishnet' ? env.PHISHNET_API_KEY
    : artist.source === 'setlistfm' ? env.SETLISTFM_API_KEY : '';
  if (artist.source !== 'songfish' && !apiKey) {
    return { status: 'skipped-no-key', entry, message: `${artist.source === 'phishnet' ? 'PHISHNET_API_KEY' : 'SETLISTFM_API_KEY'} is not set` };
  }

  const raw = await store.get(rawKey(artist.slug));
  const fullAge = raw?.fullFetchedAt ? now - Date.parse(raw.fullFetchedAt) : Infinity;
  const full = force === 'full' || !raw || fullAge >= FULL_REFRESH_DAYS * 24 * HOUR;

  const fetch = artist.source === 'setlistfm' ? fetchSetlistfmWindow : fetchByYears;
  const fetched = await fetch(artist, raw, { ctx, now, full, apiKey });

  const snapshot = buildSnapshot(artist, fetched, now);
  const problem = looksComplete(snapshot, entry);
  if (problem) throw new sources.SourceError(problem);

  const hash = hashOf(snapshot);
  const changed = hash !== entry?.hash;
  const nowIso = new Date(now).toISOString();
  let writes = 0;

  if (changed) {
    await store.set(artistKey(artist.slug), { ...snapshot, dataUpdatedAt: nowIso });
    writes++;
  }
  const rawHash = hashOf(fetched.raw);
  if (rawHash !== entry?.rawHash) {
    await store.set(rawKey(artist.slug), fetched.raw);
    writes++;
  }

  return {
    status: changed ? 'updated' : 'unchanged',
    full,
    writes,
    entry: {
      slug: artist.slug,
      name: artist.name,
      source: artist.source,
      sourceName: snapshot.sourceName,
      songPages: snapshot.songPages,
      fetchedAt: nowIso,
      dataUpdatedAt: changed ? nowIso : entry.dataUpdatedAt,
      hash,
      rawHash,
      totalShows: snapshot.band.totalShows,
      coverageShows: snapshot.coverage.shows,
      songCount: snapshot.songs.length,
      songSlugs: snapshot.songs.map((s) => s.slug),
      lastShowDate: snapshot.band.lastShow?.date || null,
      lastError: null,
      lastErrorAt: null,
    },
  };
}

/**
 * runSnapshot({ store, env, force, only, now, sleep, log })
 *   force: false (due artists only) | true (every artist, incremental) |
 *          'full' (every artist, full history)
 *   only:  optional list of slugs
 * Resolves the run report, which is also written to runs/latest.json.
 */
async function runSnapshot({ store, env = process.env, force = false, only = null, now = Date.now, sleep, log = console } = {}) {
  const startedAt = now();
  const ctx = sources.createRequester({ sleep, now });
  const index = (await store.get(INDEX_KEY)) || { schemaVersion: SCHEMA_VERSION, artists: [] };
  const entries = new Map(index.artists.map((e) => [e.slug, e]));
  const indexBefore = hashOf(index.artists);

  const artists = publicArtists().filter((a) => !only || only.includes(a.slug));
  // Most overdue first, so a run cut short by the budget doesn't starve the
  // same artists every time.
  artists.sort((a, b) => (Date.parse(entries.get(a.slug)?.fetchedAt || 0) || 0) - (Date.parse(entries.get(b.slug)?.fetchedAt || 0) || 0));

  const results = [];
  let writes = 0;

  for (const artist of artists) {
    const entry = entries.get(artist.slug);
    if (!isDue(entry, artist, now(), force)) { results.push({ slug: artist.slug, status: 'fresh' }); continue; }
    if (now() - startedAt > RUN_BUDGET_MS) { results.push({ slug: artist.slug, status: 'skipped-budget' }); continue; }

    const t0 = now();
    const callsBefore = { ...ctx.calls };
    try {
      const result = await runArtist(artist, { store, ctx, env, now: now(), force, entry });
      if (result.entry) entries.set(artist.slug, result.entry);
      writes += result.writes || 0;
      results.push({ slug: artist.slug, status: result.status, full: result.full, message: result.message, ms: now() - t0, calls: callDelta(callsBefore, ctx.calls) });
      if (result.status === 'skipped-no-key') log.warn(`[artist-snapshot] ${artist.slug}: ${result.message}`);
    } catch (err) {
      // Keep the last good snapshot; only the index entry learns about it.
      log.error(`[artist-snapshot] ${artist.slug} failed, keeping last good snapshot:`, err.message);
      if (entry) entries.set(artist.slug, { ...entry, lastError: err.message, lastErrorAt: new Date(now()).toISOString() });
      results.push({ slug: artist.slug, status: 'failed', error: err.message, ms: now() - t0, calls: callDelta(callsBefore, ctx.calls) });
    }
  }

  // Index order follows the config, so /artists and the sitemap are stable.
  const order = new Map(publicArtists().map((a, i) => [a.slug, i]));
  const nextArtists = [...entries.values()]
    .filter((e) => order.has(e.slug))
    .sort((a, b) => order.get(a.slug) - order.get(b.slug));
  if (hashOf(nextArtists) !== indexBefore) {
    await store.set(INDEX_KEY, { schemaVersion: SCHEMA_VERSION, updatedAt: new Date(now()).toISOString(), artists: nextArtists });
    writes++;
  }

  const report = {
    startedAt: new Date(startedAt).toISOString(),
    durationMs: now() - startedAt,
    force,
    writes,
    calls: { ...ctx.calls },
    retries: { ...ctx.retries },
    artists: results,
  };
  await store.set('runs/latest.json', report);
  return report;
}

function callDelta(before, after) {
  const out = {};
  for (const [k, v] of Object.entries(after)) if (v - (before[k] || 0)) out[k] = v - (before[k] || 0);
  return out;
}

// ── Reads, for the pages and the JSON API ─────────────────────────────

async function loadIndex(store) {
  const index = await store.get(INDEX_KEY);
  return index && Array.isArray(index.artists) ? index : { schemaVersion: SCHEMA_VERSION, artists: [] };
}

/** { entry, snapshot } for a configured, published artist, else null. */
async function loadArtist(store, slug) {
  if (!findArtist(slug)) return null;
  const [index, snapshot] = await Promise.all([loadIndex(store), store.get(artistKey(slug))]);
  const entry = index.artists.find((e) => e.slug === slug);
  if (!entry || !snapshot) return null;
  return { entry, snapshot };
}

/**
 * Whether a snapshot may be shown right now. Only phish.net data expires:
 * past 24 hours since its fetch the pages show "temporarily unavailable"
 * instead. `maxAgeSeconds` is how long a response rendered now may still be
 * served, so a CDN copy can't outlive the 24 hours either.
 */
function availability(entry, now = Date.now()) {
  if (entry.source !== 'phishnet') return { available: true, maxAgeSeconds: null };
  const ageMs = now - Date.parse(entry.fetchedAt);
  const leftMs = PHISHNET_MAX_AGE_HOURS * HOUR - ageMs;
  if (!(leftMs > 0)) return { available: false, maxAgeSeconds: 0 };
  return { available: true, maxAgeSeconds: Math.floor(leftMs / 1000) };
}

// The published caching rule for every public artist page and JSON
// response. For phish.net data the shared-cache lifetime (s-maxage plus
// stale-while-revalidate) is cut so no cached copy is served past the
// 24-hour limit.
function cacheHeaders(entry, now = Date.now()) {
  const { maxAgeSeconds } = entry ? availability(entry, now) : { maxAgeSeconds: null };
  if (maxAgeSeconds == null) {
    return { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' };
  }
  const sMaxAge = Math.min(3600, maxAgeSeconds);
  const swr = Math.max(0, Math.min(86400, maxAgeSeconds - sMaxAge));
  return { 'Cache-Control': `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}` };
}

const UNAVAILABLE_CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=60' };

module.exports = {
  SCHEMA_VERSION,
  STORE_NAME,
  INDEX_KEY,
  PHISHNET_MAX_AGE_HOURS,
  REFRESH_HOURS,
  artistKey,
  rawKey,
  publicArtists,
  findArtist,
  openBlobStore,
  runSnapshot,
  buildSnapshot,
  looksComplete,
  isDue,
  loadIndex,
  loadArtist,
  availability,
  cacheHeaders,
  UNAVAILABLE_CACHE_HEADERS,
};
