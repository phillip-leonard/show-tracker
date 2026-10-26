// lib/bandScreens.js
//
// Data for the in-app band and song screens (/bands/?band=<slug> and
// /bands/?band=<slug>&song=<songSlug>, app/bands/page.jsx). They render the
// same daily snapshot as the public /artist/ pages, fetched as JSON:
//
//   /api/artists                        the bands with a snapshot right now
//   /api/artist?slug=<slug>             band stats + every song, summarized
//   /api/artist-song?slug=&song=        one song's stats
//
// (netlify/functions/artist-api.js). On iOS there is no Netlify in front of
// the bundle, so every fetch goes through apiUrl() to https://mysetlists.net;
// the JSON carries Access-Control-Allow-Origin: *.
//
// ── Caching and the Phish rule ────────────────────────────────────────
//
// Responses are kept in memory for the session, per band and per song. A
// phish.net snapshot may only be shown for 24 hours after it was fetched
// (the public pages answer 503 past that), so a cached Phish response older
// than that is dropped and fetched again rather than shown, and the server's
// 503 becomes the screen's "temporarily unavailable" state.
//
// ── The user's side ───────────────────────────────────────────────────
//
// "Heard N×", your gap and your shows all come from lib/songIndex.js's
// buildSongIndex, the same code behind Stats → Songs and the /songs/ pages,
// run over just this band's shows. A show's artist is matched to a band the
// way the Songs I've heard links do (artistNameKeyLoose: "Goose (US)" is
// Goose), and a song title to the snapshot's by normalized title, through
// the band's title aliases (config/song-title-aliases.json: El Goose's
// "Same Old Shenanigans" is setlist.fm's "SOS").

import publicArtists from '@/config/public-artists.json';
import songTitleAliases from '@/config/song-title-aliases.json';
import { apiUrl } from '@/lib/api';
import { artistNameKey, artistNameKeyLoose } from '@/lib/setlistSources';
import { buildSongIndex } from '@/lib/songIndex';
import { normalizeSongTitle } from '@/lib/utils';

const HOUR = 3600 * 1000;
export const PHISHNET_MAX_AGE_HOURS = 24;
const FETCH_TIMEOUT_MS = 15000;

/** Every configured public band: { slug, name, source, songPages, key }. */
export const PUBLIC_BANDS = publicArtists.artists.map((a) => ({
  slug: a.slug,
  name: a.name,
  source: a.source,
  songPages: !!a.songPages,
  key: artistNameKeyLoose(a.name),
}));

/** The configured band for an artist name ("Goose", "goose (US)"), or null. */
export function configBandFor(artistName) {
  const key = artistNameKeyLoose(artistName);
  return (key && PUBLIC_BANDS.find((b) => b.key === key)) || null;
}

export function configBandBySlug(slug) {
  return PUBLIC_BANDS.find((b) => b.slug === slug) || null;
}

/**
 * The public page for a band screen URL (/artist/<slug>/, or its song
 * page), for a signed-out web visitor; null for any other path or an
 * unknown band. `search` is location.search.
 */
export function publicBandUrl(pathname, search) {
  if (String(pathname || '').replace(/\/+$/, '') !== '/bands') return null;
  const params = new URLSearchParams(search || '');
  const band = configBandBySlug((params.get('band') || '').toLowerCase().trim());
  if (!band) return null;
  const song = (params.get('song') || '').toLowerCase().trim();
  return band.songPages && /^[a-z0-9-]+$/.test(song) ? `/artist/${band.slug}/song/${song}/` : `/artist/${band.slug}/`;
}

/**
 * Whether data fetched at `fetchedAt` from `source` may still be shown.
 * Only phish.net data expires (lib/publicArtistSnapshot.js availability()).
 */
export function isShowable(source, fetchedAt, now = Date.now()) {
  if (source !== 'phishnet') return true;
  const at = Date.parse(fetchedAt || '');
  return Number.isFinite(at) && now - at < PHISHNET_MAX_AGE_HOURS * HOUR;
}

// ── Fetching ──────────────────────────────────────────────────────────

/** kind: 'unavailable' (Phish past 24 hours), 'not_found', or 'network'. */
export class BandLoadError extends Error {
  constructor(kind, message) {
    super(message || kind);
    this.kind = kind;
  }
}

async function getJson(path) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  let res;
  try {
    res = await fetch(apiUrl(path), controller ? { signal: controller.signal } : undefined);
  } catch (err) {
    throw new BandLoadError('network', err?.message);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 503) throw new BandLoadError('unavailable');
  if (res.status === 404) throw new BandLoadError('not_found');
  if (!res.ok) throw new BandLoadError('network', `HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (err) {
    throw new BandLoadError('network', err?.message);
  }
}

// slug -> { source, fetchedAt } for the bands /api/artists lists; null
// until it has loaded. A failed load is not cached, so the next call tries
// again.
let indexCache = null;
let indexPromise = null;

/**
 * The bands that have a band screen, as a Map slug -> entry. If the index
 * can't be fetched (offline, or a server from before /api/artists), every
 * configured band is assumed to have one; its screen then shows the error
 * state rather than the entry point disappearing.
 */
export function loadBandIndex() {
  if (indexCache) return Promise.resolve(indexCache);
  if (!indexPromise) {
    indexPromise = getJson('/api/artists')
      .then((body) => {
        indexCache = new Map((body.artists || []).map((a) => [a.slug, a]));
        return indexCache;
      })
      .catch(() => new Map(PUBLIC_BANDS.map((b) => [b.slug, { slug: b.slug, name: b.name, source: b.source, songPages: b.songPages, fallback: true }])))
      .finally(() => { indexPromise = null; });
  }
  return indexPromise;
}

/**
 * The band screen's band for an artist name, from a loaded index, or null.
 * The PUBLIC_BANDS object itself, so it is the same object every render.
 */
export function bandForArtist(index, artistName, now = Date.now()) {
  const band = index && configBandFor(artistName);
  const entry = band && index.get(band.slug);
  if (!entry) return null;
  if (!entry.fallback && !isShowable(entry.source, entry.fetchedAt, now)) return null;
  return band;
}

const bandCache = new Map(); // slug -> /api/artist body
const songCache = new Map(); // `${slug}/${song}` -> /api/artist-song body

function fresh(cache, key, now) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (isShowable(hit.artist?.source, hit.artist?.fetchedAt, now)) return hit;
  cache.delete(key);
  return null;
}

/** A cached band response that may still be shown, else null. */
export function cachedBand(slug, now = Date.now()) {
  return fresh(bandCache, slug, now);
}

export function cachedBandSong(slug, songSlug, now = Date.now()) {
  return fresh(songCache, `${slug}/${songSlug}`, now);
}

export async function loadBand(slug) {
  const hit = cachedBand(slug);
  if (hit) return hit;
  const body = await getJson(`/api/artist?slug=${encodeURIComponent(slug)}`);
  // A response already past the limit (a stale CDN copy) is refused, not shown.
  if (!isShowable(body.artist?.source, body.artist?.fetchedAt)) throw new BandLoadError('unavailable');
  bandCache.set(slug, body);
  return body;
}

export async function loadBandSong(slug, songSlug) {
  const hit = cachedBandSong(slug, songSlug);
  if (hit) return hit;
  const body = await getJson(`/api/artist-song?slug=${encodeURIComponent(slug)}&song=${encodeURIComponent(songSlug)}`);
  if (!isShowable(body.artist?.source, body.artist?.fetchedAt)) throw new BandLoadError('unavailable');
  songCache.set(`${slug}/${songSlug}`, body);
  return body;
}

/** For the tests: forget everything fetched. */
export function resetBandCaches() {
  indexCache = null;
  indexPromise = null;
  bandCache.clear();
  songCache.clear();
}

// ── Titles ────────────────────────────────────────────────────────────

/** normalized alias -> normalized target, for one band. */
function aliasesFor(band) {
  const entry = songTitleAliases[artistNameKey(band.name)];
  const map = new Map();
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return map;
  Object.entries(entry).forEach(([from, to]) => {
    const f = normalizeSongTitle(from);
    const t = normalizeSongTitle(to);
    if (f && t && f !== t) map.set(f, { key: t, name: to });
  });
  return map;
}

function titleKeyWith(aliases, title) {
  const key = normalizeSongTitle(title);
  return aliases.get(key)?.key || key;
}

/** Title -> snapshot song slug, for a band response whose songs have pages. */
export function songSlugIndex(bandBody, band) {
  const map = new Map();
  if (!bandBody?.artist?.songPages) return map;
  const aliases = aliasesFor(band);
  (bandBody.songs || []).forEach((s) => {
    const key = titleKeyWith(aliases, s.name);
    if (key && !map.has(key)) map.set(key, s.slug);
  });
  return map;
}

export function songSlugFor(slugIndex, band, title) {
  return slugIndex.get(titleKeyWith(aliasesFor(band), title)) || null;
}

// ── The user's side ───────────────────────────────────────────────────

/** YYYY-MM-DD for a show date stored either way the app has stored them. */
export function isoDate(date) {
  const s = String(date || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : '';
}

/** The user's shows of this band, newest first. */
export function bandShowsFor(shows, band) {
  return (shows || [])
    .filter((s) => s && artistNameKeyLoose(s.artist) === band.key)
    .slice()
    .sort((a, b) => isoDate(b.date).localeCompare(isoDate(a.date)));
}

/**
 * Everything the screens show about the user and this band:
 *   shows         their shows of it, newest first
 *   showByDate    YYYY-MM-DD -> their show that night
 *   songs         their songIndex entries, most heard first
 *   songFor(name) their songIndex entry for a snapshot song title, or null
 *   artistName    the band as they log it, for the /songs/ fallback links
 */
export function buildBandPersonal(shows, band) {
  const mine = bandShowsFor(shows, band);
  const aliases = aliasesFor(band);
  // One timeline under one name, so "Goose" and "Goose (US)" shows count
  // as one band; aliased titles under the band archive's spelling.
  const renamed = mine.map((show) => ({
    ...show,
    artist: band.name,
    setlist: (show.setlist || []).map((song) => {
      const alias = aliases.get(normalizeSongTitle(song?.name));
      return alias ? { ...song, name: alias.name } : song;
    }),
  }));
  const index = buildSongIndex(renamed);
  const byTitle = new Map();
  Object.values(index).forEach((entry) => {
    byTitle.set(entry.key.slice(entry.key.indexOf(':') + 1), entry);
  });

  const showByDate = new Map();
  mine.forEach((show) => {
    const d = isoDate(show.date);
    if (d && !showByDate.has(d)) showByDate.set(d, show);
  });

  return {
    shows: mine,
    showByDate,
    songs: Object.values(index).sort((a, b) => b.timesSeen - a.timesSeen || a.title.localeCompare(b.title)),
    songFor: (title) => byTitle.get(titleKeyWith(aliases, title)) || null,
    artistName: mine[0]?.artist || band.name,
  };
}
