// lib/festivalGrouping.js
//
// Pure stats/grouping for a single festival's attached shows (wrapped by
// hooks/useFestivalShows.js, the way lib/runIndex.js is by useRunIndex).
//
// Takes the *already-filtered* list of shows attached to one festival
// (shows.filter(s => s.festivalId === festival.id)), so this stays a plain
// array -> stats function with no Firestore or festival lookups.
//
// THE SHARED KEYS (5.60.36, Stage 5 call C), so a festival's tiles count
// the way Stats counts:
//   artists   by bandKey (lib/stats/keys.js): "Goose" and "goose" are one
//             artist, shown with the first spelling in date order
//   average   over ratings from 1 to 10 only (lib/stats validRating)
//   days      by the show's ISO day (lib/showDate.js toIsoDate), so a
//             legacy dd-MM-yyyy date lands on the same day; a show whose
//             date can't be read is grouped last, under '', and isn't a day
//
// CommonJS: the native app's copy is checked against
// fixtures/festivals/stats.json.

const { bandKey } = require('./stats/keys');
const { toIsoDate } = require('./showDate');

// Canonical in-app link to one festival's detail view. Query-param form,
// not `/festivals/<id>` — a dynamic segment can't be served under
// `output: 'export'` for ids that only exist at runtime (CLAUDE.md,
// "Routing"). Every festival link in the app goes through here.
function festivalHref(festivalId) {
  return `/festivals/?festival=${encodeURIComponent(festivalId)}`;
}

const validRating = (r) => typeof r === 'number' && Number.isFinite(r) && r >= 1 && r <= 10;

// Readable days first, oldest first; unreadable last.
function compareDays(a, b) {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}

function buildFestivalStats(festivalShows = []) {
  const withDay = (festivalShows || []).map((show, i) => ({ show, day: toIsoDate(show && show.date), i }));
  // Stable: same-day shows keep the order they came in.
  withDay.sort((a, b) => compareDays(a.day, b.day) || a.i - b.i);
  const sorted = withDay.map((x) => x.show);

  const artists = new Map(); // bandKey -> first spelling
  sorted.forEach((s) => {
    const name = String((s && s.artist) || '').trim();
    const key = bandKey(name);
    if (key && !artists.has(key)) artists.set(key, name);
  });

  const ratings = sorted.map((s) => s && s.rating).filter(validRating);
  const avgRating = ratings.length ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null;

  const byDay = new Map(); // ISO day ('' when unreadable) -> shows[]
  withDay.forEach(({ show, day }) => {
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(show);
  });
  const groupedByDay = Array.from(byDay.entries()).map(([date, shows]) => ({ date, shows }));

  return {
    showCount: sorted.length,
    artists: Array.from(artists.values()).sort((a, b) => a.localeCompare(b)),
    artistCount: artists.size,
    avgRating,
    dayCount: groupedByDay.filter((d) => d.date).length,
    groupedByDay,
    shows: sorted,
  };
}

module.exports = { festivalHref, buildFestivalStats };
