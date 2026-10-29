// lib/runIndex.js
//
// Builds "runs" (2+ consecutive nights, same artist, same venue) and "tours"
// (same artist + same setlist.fm tour name) from the shows already loaded in
// AppContext — one pass, no Firestore reads, mirroring lib/songIndex.js's
// pure-function + memoized-hook pattern (see hooks/useRunIndex.js).
//
// Run definition (v1): same artist (exact string match, matching the rest of
// the app's artist-identity convention) + same venue (fuzzy-matched via
// lib/utils.js's venuesFuzzyMatch, so a sponsor-name change like "XYZ
// Amphitheatre" -> "ABC Amphitheatre at XYZ Park" doesn't split a run) +
// consecutive dates, where "consecutive" allows a gap of at most
// MAX_NIGHT_GAP_DAYS (0 or 1 day) between one night and the next. A cluster
// of exactly one show is never a run.
//
// Examples of what this does and doesn't group:
//   - Fri/Sat/Sun at Dick's, same artist -> one 3-night run.
//   - Fri and the following Fri at the same venue -> NOT a run (6-day gap).
//   - Dec 30, Dec 31, Jan 1 at the same venue -> one 3-night run (year
//     boundary doesn't matter; only the calendar-day gap does).
//   - Two shows same calendar date (an early show and a late show) -> two
//     separate nights of the same run, not deduped into one.
//
// Known v1 limitations (not attempted here, see Part 2 prompt): multi-venue
// tour legs (three cities in four nights) and festival grouping (multiple
// artists, one venue, consecutive days) are NOT runs by this definition.
// A venue renamed entirely between nights (not just a partial/sponsor
// rename) won't be caught by fuzzy substring matching and will split the
// run — full venue-identity resolution is out of scope for v1.

import { parseDate, normalizeSongTitle, venuesFuzzyMatch } from '@/lib/utils';
import { artistSlugFromName } from '@/lib/songIndex';

export const MAX_NIGHT_GAP_DAYS = 1;

const MS_PER_DAY = 86400000;

function daysBetween(fromDateStr, toDateStr) {
  return Math.round((parseDate(toDateStr).getTime() - parseDate(fromDateStr).getTime()) / MS_PER_DAY);
}

function venueSlug(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

export function runKeyFor(artistName, venueName, firstDate) {
  const artistSlug = artistSlugFromName(artistName);
  const vSlug = venueSlug(venueName);
  if (!artistSlug || !vSlug || !firstDate) return null;
  return `${artistSlug}:${vSlug}:${firstDate}`;
}

function pickMostCommon(counts) {
  let best = null;
  let bestCount = -1;
  for (const [value, count] of Object.entries(counts)) {
    if (count > bestCount) { best = value; bestCount = count; }
  }
  return best;
}

// Groups one artist's chronologically-sorted shows into clusters of
// consecutive-night, same-venue shows. Returns an array of arrays (each
// inner array has length >= 1 — callers filter out length-1 clusters,
// since a single show is never a run).
function clusterConsecutiveNights(sortedShows) {
  const clusters = [];
  let current = [];

  sortedShows.forEach(show => {
    if (current.length === 0) {
      current = [show];
      return;
    }
    const prev = current[current.length - 1];
    const gap = daysBetween(prev.date, show.date);
    const sameVenue = venuesFuzzyMatch(prev.venue, show.venue);
    if (gap <= MAX_NIGHT_GAP_DAYS && sameVenue) {
      current.push(show);
    } else {
      clusters.push(current);
      current = [show];
    }
  });
  if (current.length) clusters.push(current);

  return clusters;
}

function buildRun(clusterShows) {
  const nights = clusterShows.map(show => ({
    showId: show.id,
    date: show.date,
    venue: show.venue || '',
    city: show.city || '',
    rating: typeof show.rating === 'number' ? show.rating : null,
    setlist: show.setlist || [],
    hasSetlist: Array.isArray(show.setlist) && show.setlist.length > 0,
    // Where the setlist came from, for its attribution line
    // (components/shows/SetlistfmAttribution.jsx, BandSourceAttribution.jsx).
    artist: show.artist,
    setlistfmId: show.setlistfmId || null,
    setlistfmUrl: show.setlistfmUrl || null,
    setlistSource: show.setlistSource || null,
    sourceShowId: show.sourceShowId || null,
    sourcePermalink: show.sourcePermalink || null,
  }));

  const artistName = clusterShows[0].artist;
  const venueCounts = {};
  clusterShows.forEach(s => { venueCounts[s.venue] = (venueCounts[s.venue] || 0) + 1; });
  const venueName = pickMostCommon(venueCounts);

  const hasIncompleteData = nights.some(n => !n.hasSetlist);

  // songKey -> { title, nightNumbers: Set<number> (1-based) }
  const songMap = new Map();
  let totalSongs = 0;
  nights.forEach((night, i) => {
    night.setlist.forEach(song => {
      const title = (song?.name || '').trim();
      const key = normalizeSongTitle(title);
      if (!key) return;
      totalSongs++;
      if (!songMap.has(key)) songMap.set(key, { title, nightNumbers: new Set() });
      songMap.get(key).nightNumbers.add(i + 1);
      // Keep the most-recently-seen raw spelling as good enough for display;
      // a full pickMostCommon pass isn't worth it for a single run's songs.
      songMap.get(key).title = title;
    });
  });

  const combinedSetlist = Array.from(songMap.entries())
    .map(([key, data]) => ({
      key,
      title: data.title,
      nightNumbers: Array.from(data.nightNumbers).sort((a, b) => a - b),
    }))
    .sort((a, b) => a.nightNumbers[0] - b.nightNumbers[0] || a.title.localeCompare(b.title));

  // A song can repeat within one night too (e.g. a reprise) — count actual
  // performances per key, not just distinct nights, so a repeat is still
  // flagged even if it happens twice on one night.
  const performanceCounts = new Map();
  nights.forEach(night => {
    night.setlist.forEach(song => {
      const key = normalizeSongTitle((song?.name || '').trim());
      if (!key) return;
      performanceCounts.set(key, (performanceCounts.get(key) || 0) + 1);
    });
  });
  const uniqueSongs = performanceCounts.size;
  const repeats = combinedSetlist.filter(s => performanceCounts.get(s.key) > 1);

  // No-repeat is only a meaningful claim when every night's setlist is
  // actually known — a missing setlist could easily be hiding the repeat
  // that would break the claim. Report null (undetermined) instead of a
  // false positive.
  const noRepeat = hasIncompleteData ? null : (uniqueSongs > 0 && repeats.length === 0);

  const ratedNights = nights.filter(n => n.rating != null);
  const avgRating = ratedNights.length
    ? ratedNights.reduce((sum, n) => sum + n.rating, 0) / ratedNights.length
    : null;

  // Only meaningful when exactly one night holds the top rating — omitted
  // if nothing is rated, or every rated night is tied.
  let bestNightIndex = null;
  if (ratedNights.length >= 1) {
    const maxRating = Math.max(...ratedNights.map(n => n.rating));
    const topNights = ratedNights.filter(n => n.rating === maxRating);
    if (topNights.length === 1) {
      bestNightIndex = nights.indexOf(topNights[0]);
    }
  }

  const firstDate = nights[0].date;
  const lastDate = nights[nights.length - 1].date;

  return {
    key: runKeyFor(artistName, venueName, firstDate) || `${artistSlugFromName(artistName)}:${venueSlug(venueName)}:${firstDate}:${clusterShows[0].id}`,
    artistName,
    artistSlug: artistSlugFromName(artistName),
    venueName,
    city: nights[0].city,
    nights,
    nightCount: nights.length,
    dateRange: { start: firstDate, end: lastDate },
    totalSongs,
    uniqueSongs,
    hasIncompleteData,
    noRepeat,
    repeats,
    combinedSetlist,
    avgRating,
    bestNightIndex,
  };
}

export function buildRunIndex(shows = []) {
  const byArtist = new Map();
  shows.forEach(show => {
    if (!show?.artist || !show?.venue || !show?.date) return;
    if (!byArtist.has(show.artist)) byArtist.set(show.artist, []);
    byArtist.get(show.artist).push(show);
  });

  const runs = [];
  byArtist.forEach(artistShows => {
    const sorted = artistShows.slice().sort((a, b) => parseDate(a.date) - parseDate(b.date));
    clusterConsecutiveNights(sorted)
      .filter(cluster => cluster.length >= 2)
      .forEach(cluster => runs.push(buildRun(cluster)));
  });

  runs.sort((a, b) => parseDate(b.dateRange.start) - parseDate(a.dateRange.start));

  const index = {};
  runs.forEach(run => { index[run.key] = run; });
  return index;
}

// ── Tours ─────────────────────────────────────────────────────────────
// Grouped purely by artist + exact tour name (from setlist.fm import, see
// show.tour). Shows with no tour name don't belong to any tour — there is
// deliberately no "No Tour" bucket.

// Canonical in-app link to one tour's detail view. Query-param form (the
// same reason /songs, /runs and /festivals use one): a dynamic segment
// can't be served under `output: 'export'` for keys that only exist at
// runtime.
export function tourHref(tourKey) {
  return `/tours/?tour=${encodeURIComponent(tourKey)}`;
}

export function tourKeyFor(artistName, tourName) {
  const artistSlug = artistSlugFromName(artistName);
  const tSlug = venueSlug(tourName);
  if (!artistSlug || !tSlug) return null;
  return `${artistSlug}:${tSlug}`;
}

export function buildTourIndex(shows = []) {
  const byKey = new Map(); // key -> shows[]

  shows.forEach(show => {
    if (!show?.artist || !show?.tour || !show.tour.trim()) return;
    const key = tourKeyFor(show.artist, show.tour);
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(show);
  });

  const index = {};
  byKey.forEach((tourShows, key) => {
    const sorted = tourShows.slice().sort((a, b) => parseDate(a.date) - parseDate(b.date));
    const tourNameCounts = {};
    sorted.forEach(s => { tourNameCounts[s.tour] = (tourNameCounts[s.tour] || 0) + 1; });

    const songKeys = new Set();
    sorted.forEach(s => (s.setlist || []).forEach(song => {
      const k = normalizeSongTitle((song?.name || '').trim());
      if (k) songKeys.add(k);
    }));

    const ratedShows = sorted.filter(s => typeof s.rating === 'number');
    const avgRating = ratedShows.length
      ? ratedShows.reduce((sum, s) => sum + s.rating, 0) / ratedShows.length
      : null;

    const venueSlugs = new Set(sorted.map(s => venueSlug(s.venue)).filter(Boolean));
    const countries = new Set(sorted.map(s => (s.country || '').trim().toLowerCase()).filter(Boolean));

    // Every calendar year the tour touched, ascending — a tour that runs
    // across a New Year (or a multi-leg tour spanning two years) belongs to
    // both, so the Tours page's year filter matches on membership rather
    // than on the start date alone.
    const years = Array.from(
      new Set(sorted.map(s => (s.date || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y)))
    ).sort();

    index[key] = {
      key,
      artistName: sorted[0].artist,
      artistSlug: artistSlugFromName(sorted[0].artist),
      tourName: pickMostCommon(tourNameCounts),
      stops: sorted.map(s => ({
        showId: s.id,
        date: s.date,
        venue: s.venue || '',
        city: s.city || '',
        country: s.country || '',
        rating: typeof s.rating === 'number' ? s.rating : null,
      })),
      stopCount: sorted.length,
      dateRange: { start: sorted[0].date, end: sorted[sorted.length - 1].date },
      uniqueSongs: songKeys.size,
      avgRating,
      venuesCount: venueSlugs.size,
      countriesVisited: countries.size,
      years,
    };
  });

  return index;
}

// Songs the user heard for the first time ever on this tour — i.e. songs
// whose first-ever performance across their own logged history happens to
// be one of this tour's stops.
//
// Reads lib/songIndex.js's already-built `firstSeen` rather than
// re-aggregating performances here: that index is the single source of
// truth for "when did I first hear this", so a tour can never disagree
// with the song's own page. Only songs by this tour's artist are
// considered (the index is keyed by artist slug), so a support act's song
// logged under a different artist never counts as a debut on this tour.
//
// Returns [] for a tour made entirely of previously-heard songs — callers
// render an empty state rather than an empty heading.
export function newSongsOnTour(tour, songIndex = {}) {
  if (!tour?.stops?.length) return [];
  const tourShowIds = new Set(tour.stops.map(s => s.showId));

  return Object.values(songIndex)
    .filter(song => song.artistSlug === tour.artistSlug && tourShowIds.has(song.firstSeen?.showId))
    .map(song => ({
      key: song.key,
      title: song.title,
      timesSeen: song.timesSeen,
      firstSeen: song.firstSeen,
    }))
    .sort((a, b) => (a.firstSeen.date < b.firstSeen.date ? -1 : a.firstSeen.date > b.firstSeen.date ? 1 : a.title.localeCompare(b.title)));
}
