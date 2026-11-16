// lib/stats/index.js — the numbers people see about a user's shows, in one
// place (5.59.15, B-05 and SCOPING §7.2).
//
// Pure functions: a user's show documents in, a stats object out. Used by
// the server (netlify/functions/recompute-my-stats.js, the scheduled
// stats job, scripts/backfill-user-stats.js), which writes userStats/{uid},
// publicUserStats/{uid} and leaderboard/current, and by the web app wherever
// it still computes locally (the fallback before a user's stats document
// exists, and the screens that compute per period). A Swift client reads
// the server documents rather than re-implementing any of this.
//
// CommonJS on purpose, like lib/venueCount.js and lib/showDate.js.
//
// ── Definitions ───────────────────────────────────────────────────────
//
// SHOW. One document in users/{uid}/shows. Every logged show counts,
// including festival imports. Two documents for the same night (a
// duplicate the user logged twice) count twice, as they always have; the
// duplicate check (lib/showIdentity.js) stops new ones.
//
// DATE. Read with lib/showDate.js: ISO and the legacy DD-MM-YYYY are the
// same day, so the stored format never changes a number. A show whose date
// can't be read still counts as a show; it has no year.
//
// SONGS SEEN (songCount). Every setlist entry: a song played twice at one
// show (a sandwich, a reprise) is two entries. Segues don't merge songs;
// teases aren't stored as entries; covers count like any song. Unchanged
// from the profile counter clients wrote before 5.59.15.
//
// RATED SONGS (ratedSongCount). Setlist entries with a rating.
//
// UNIQUE SONGS. Distinct song keys (keys.js songKey, the app's
// songTitleKey): "Ashes//Dust" and "Ashes // Dust" are one song.
//
// BANDS. Distinct band keys (keys.js bandKey, the app's
// artistNameKeyLoose): "Goose" and "goose (US)" are one band, as Year in
// Review has always counted. A show with no artist isn't a band.
//
// VENUES (venueCount). lib/venueCount.js: distinct name + city, trimmed,
// lowercased, whitespace collapsed; no venue name, no venue.
//
// YEARS ACTIVE. Distinct years among readable show dates.
//
// AVERAGE RATING. Mean of the shows' own ratings (1–10), as a number
// rounded to one decimal (8.3), or null with none rated. A string ("8.3")
// until 5.60.12; display it with formatAverageRating.
//
// TOP LISTS (5.60.27, Stage 2 C-2). All time, the top 10 of each, most
// first, ties by name:
//   topBands   shows per band key, named as first logged
//   topVenues  shows per venue key, "Venue, City"
//   topSongs   SHOWS a song was seen at (lib/stats/perShow.js: a sandwich
//              or a reprise is one show), per band key + song key, so two
//              bands' "Intro" stay apart: { name, artist, count }. The
//              web's "times seen". Entries with no song name are skipped.
// These three were added without a STATS_VERSION bump: new fields and
// longer lists change nothing an older build reads.

const { toIsoDate, showYear, compareShowDates } = require('../showDate');
const { venueCountKey } = require('../venueCount');
const { songKey, bandKey } = require('./keys');
const { forEachSongOncePerShow } = require('./perShow');

// 2 (5.60.12): avgShowRating became a number. The web and iOS apps use a
// stored userStats document only when its statsVersion equals their own, so
// builds from before this compare against 1 and compute locally instead.
const STATS_VERSION = 2;
const TOP_N = 10;

const clean = (v) => String(v == null ? '' : v).trim();
const validRating = (r) => typeof r === 'number' && Number.isFinite(r) && r >= 1 && r <= 10;

function top(map, n = TOP_N) {
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n)
    .map(({ name, count }) => ({ name, count }));
}

/** topSongs: songs by the number of shows they were seen at (see TOP LISTS). */
function topSongs(shows, n = TOP_N) {
  const songs = new Map();
  forEachSongOncePerShow(
    shows,
    (song, show) => {
      const s = songKey(song && song.name);
      return s ? `${bandKey(show && show.artist)}::${s}` : '';
    },
    (key, song, show) => {
      if (!songs.has(key)) songs.set(key, { name: clean(song.name), artist: clean(show.artist), count: 0 });
      songs.get(key).count += 1;
    },
  );
  return [...songs.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.artist.localeCompare(b.artist))
    .slice(0, n);
}

/**
 * computeUserStats(shows) → the full stats object for one user. Shows are
 * the documents' data; ids aren't needed.
 */
function computeUserStats(shows) {
  const list = Array.isArray(shows) ? shows.filter((s) => s && typeof s === 'object') : [];
  let songCount = 0;
  let ratedSongCount = 0;
  const songs = new Set();
  const bands = new Map();
  const venues = new Map();
  const years = new Map();
  const ratings = [];
  let firstShowDate = '';
  let lastShowDate = '';

  for (const show of list) {
    const setlist = Array.isArray(show.setlist) ? show.setlist : [];
    songCount += setlist.length;
    for (const song of setlist) {
      if (song && song.rating) ratedSongCount += 1;
      const key = songKey(song && song.name);
      if (key) songs.add(key);
    }

    const b = bandKey(show.artist);
    if (b) {
      if (!bands.has(b)) bands.set(b, { name: clean(show.artist), count: 0 });
      bands.get(b).count += 1;
    }

    const v = venueCountKey(show);
    if (v) {
      if (!venues.has(v)) venues.set(v, { name: clean(show.venue) + (clean(show.city) ? `, ${clean(show.city)}` : ''), count: 0 });
      venues.get(v).count += 1;
    }

    const iso = toIsoDate(show.date);
    if (iso) {
      const y = showYear(iso);
      years.set(y, (years.get(y) || 0) + 1);
      if (!firstShowDate || compareShowDates(iso, firstShowDate) < 0) firstShowDate = iso;
      if (!lastShowDate || compareShowDates(iso, lastShowDate) > 0) lastShowDate = iso;
    }

    if (validRating(show.rating)) ratings.push(show.rating);
  }

  const showsByYear = {};
  [...years.keys()].sort().forEach((y) => { showsByYear[y] = years.get(y); });

  return {
    statsVersion: STATS_VERSION,
    showCount: list.length,
    songCount,
    ratedSongCount,
    uniqueSongCount: songs.size,
    bandCount: bands.size,
    venueCount: venues.size,
    yearsActive: years.size,
    showsByYear,
    firstShowDate: firstShowDate || null,
    lastShowDate: lastShowDate || null,
    avgShowRating: ratings.length ? Math.round((ratings.reduce((a, r) => a + r, 0) / ratings.length) * 10) / 10 : null,
    ratedShowCount: ratings.length,
    topBands: top(bands),
    topVenues: top(venues),
    topSongs: topSongs(list),
  };
}

/** The numbers other signed-in users may see (publicUserStats/{uid}). */
function publicStats(stats, rank = null) {
  return {
    statsVersion: STATS_VERSION,
    showCount: stats.showCount,
    songCount: stats.songCount,
    ratedSongCount: stats.ratedSongCount,
    venueCount: stats.venueCount,
    rank: rank ? rank.rank : null,
    rankedOf: rank ? rank.of : null,
  };
}

/**
 * Who is on the leaderboard and in the rank: real accounts (not
 * isTestUser, not a guest), not banned, with at least one show.
 * `anonymous` comes from Firebase Auth (5.60.13: a guest on anonymous
 * auth, nothing linked), never from the profile, which the client writes.
 */
function isRanked(profile, stats, { anonymous = false } = {}) {
  if (anonymous) return false;
  return !!stats && stats.showCount > 0 && !(profile && (profile.isTestUser === true || profile.banned === true));
}

/**
 * rankUsers([{ uid, showCount }]) → Map uid → { rank, of }. By show count,
 * highest first; ties share a rank (1, 2, 2, 4). Only pass ranked users.
 */
function rankUsers(entries) {
  const sorted = [...entries].sort((a, b) => b.showCount - a.showCount || String(a.uid).localeCompare(String(b.uid)));
  const out = new Map();
  let rank = 0;
  let prev = null;
  sorted.forEach((e, i) => {
    if (e.showCount !== prev) { rank = i + 1; prev = e.showCount; }
    out.set(e.uid, { rank, of: sorted.length });
  });
  return out;
}

/**
 * formatAverageRating(8) → '8.0', (8.3) → '8.3', ('8.3') → '8.3', null → ''.
 * One decimal, always: the number avgShowRating is (and the string it was
 * before 5.60.12) both read.
 */
function formatAverageRating(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : '';
}

module.exports = { computeUserStats, publicStats, isRanked, rankUsers, formatAverageRating, STATS_VERSION, TOP_N };
