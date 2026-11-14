// lib/yearRecap.js
//
// The 2026 recap (components/yearInReview/YearRecapView.jsx), computed
// purely from the user's own shows. No Firebase, so it's unit tested
// (lib/__tests__/yearRecap.test.js). The band-history parts (rarest catch,
// bust-outs) are lib/yearRecapRarity.js; the friend tags behind the show
// buddy are read by lib/yearRecapData.js and passed in here.
//
// ── Counting rules ────────────────────────────────────────────────────
//
// The same as Stats, so a number here means what it means there:
//   - a show's year comes from parseDate (lib/utils.js), never new Date():
//     dates are stored YYYY-MM-DD or DD-MM-YYYY (see lib/yearInReviewStats.js)
//   - one band is one artistNameKeyLoose ("Goose" / "goose (US)")
//   - one song is one songTitleKey, and a song played twice at one show is
//     heard once there (lib/songCounts.js)
//   - one venue is name + city, lowercased
//   - shows with no setlist count toward shows, bands, venues and cities,
//     never toward songs; they're listed so they can be filled in
//
// "New" bands and venues are new to the user: never seen in any earlier
// year. Undated shows can't be placed in a year and are ignored.

import { parseDate, toIsoDate } from '@/lib/utils';
import { songTitleKey, forEachSongOncePerShow } from '@/lib/songCounts';
import { artistNameKeyLoose } from '@/lib/setlistSources';
import { buildRunIndex } from '@/lib/runIndex';
import { venueCountKey } from '@/lib/venueCount';

export const TOP_BANDS = 5;
export const TOP_SONGS = 10;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function showDate(show) {
  if (!show?.date) return null;
  const d = parseDate(show.date);
  return Number.isNaN(d.getTime()) || d.getTime() === 0 ? null : d;
}

export function recapShowYear(show) {
  return showDate(show)?.getFullYear() ?? null;
}

const clean = (v) => String(v || '').trim();
const venueKey = (show) => venueCountKey(show);
const cityKey = (show) => clean(show.city).toLowerCase() || null;
const hasSetlist = (show) => (show?.setlist || []).some((song) => songTitleKey(song?.name));

/** The parts of a show the recap shows and links to. */
function showRef(show) {
  return {
    id: show.id,
    artist: clean(show.artist),
    venue: clean(show.venue),
    city: clean(show.city),
    date: toIsoDate(show.date) || clean(show.date),
  };
}

// The most-used spelling in a { spelling: count } map.
function bestSpelling(spellings) {
  return Object.entries(spellings).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
}

/** The user's shows in `year`, oldest first. */
export function showsInYear(allShows, year) {
  return (allShows || [])
    .filter((s) => recapShowYear(s) === Number(year))
    .sort((a, b) => parseDate(a.date) - parseDate(b.date));
}

/**
 * The longest run in the year: 2+ consecutive nights, same band and venue,
 * by lib/runIndex.js's own definition. Only the year's nights count, so a
 * Dec 30 – Jan 1 run is two nights in this recap. null with no run.
 */
function longestRun(yearShows) {
  const runs = Object.values(buildRunIndex(yearShows));
  if (!runs.length) return null;
  runs.sort((a, b) => b.nightCount - a.nightCount
    || parseDate(b.dateRange.start) - parseDate(a.dateRange.start));
  const r = runs[0];
  return {
    key: r.key,
    artist: r.artistName,
    venue: r.venueName,
    city: r.city || '',
    nights: r.nightCount,
    start: toIsoDate(r.dateRange.start) || r.dateRange.start,
    end: toIsoDate(r.dateRange.end) || r.dateRange.end,
  };
}

/**
 * Everything the recap page shows except the band-history sections and
 * the show buddy. null when the year has no shows.
 */
export function computeYearRecap(allShows = [], year) {
  const yearShows = showsInYear(allShows, year);
  if (!yearShows.length) return null;

  const priorBands = new Set();
  const priorVenues = new Set();
  (allShows || []).forEach((s) => {
    const y = recapShowYear(s);
    if (y === null || y >= Number(year)) return;
    const b = artistNameKeyLoose(s.artist);
    if (b) priorBands.add(b);
    const v = venueKey(s);
    if (v) priorVenues.add(v);
  });

  const bands = new Map(); // key -> { spellings, shows }
  const venues = new Set();
  const cities = new Set();
  const newBands = new Map(); // key -> display name
  const newVenues = new Set();
  const songs = new Map(); // songTitleKey -> { count, spellings, artists }
  const months = Array(12).fill(0);
  const noSetlist = [];

  yearShows.forEach((show) => {
    const bKey = artistNameKeyLoose(show.artist);
    if (bKey) {
      const entry = bands.get(bKey) || { spellings: {}, shows: 0 };
      entry.shows++;
      entry.spellings[clean(show.artist)] = (entry.spellings[clean(show.artist)] || 0) + 1;
      bands.set(bKey, entry);
      if (!priorBands.has(bKey)) newBands.set(bKey, true);
    }
    const vKey = venueKey(show);
    if (vKey) {
      venues.add(vKey);
      if (!priorVenues.has(vKey)) newVenues.add(vKey);
    }
    const cKey = cityKey(show);
    if (cKey) cities.add(cKey);
    months[showDate(show).getMonth()]++;

    if (!hasSetlist(show)) { noSetlist.push(showRef(show)); return; }
    forEachSongOncePerShow([show], (song) => songTitleKey(song?.name), (key, song) => {
      const entry = songs.get(key) || { count: 0, spellings: {}, artists: {} };
      entry.count++;
      const name = clean(song.name);
      entry.spellings[name] = (entry.spellings[name] || 0) + 1;
      const artist = clean(show.artist);
      if (artist) entry.artists[artist] = (entry.artists[artist] || 0) + 1;
      songs.set(key, entry);
    });
  });

  const bandName = (key) => bestSpelling(bands.get(key).spellings);
  const topBands = [...bands.entries()]
    .map(([key, b]) => ({ name: bandName(key), shows: b.shows }))
    .sort((a, b) => b.shows - a.shows || a.name.localeCompare(b.name))
    .slice(0, TOP_BANDS);

  const topSongs = [...songs.values()]
    .map((s) => ({ name: bestSpelling(s.spellings), artist: bestSpelling(s.artists), count: s.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_SONGS);

  const busiest = months.reduce((best, n, i) => (n > months[best] ? i : best), 0);
  const first = yearShows[0];
  const latest = yearShows[yearShows.length - 1];

  return {
    year: Number(year),
    totalShows: yearShows.length,
    totalBands: bands.size,
    totalVenues: venues.size,
    totalCities: cities.size,
    songsHeard: songs.size,
    newBands: newBands.size,
    newBandNames: [...newBands.keys()].map(bandName).sort((a, b) => a.localeCompare(b)),
    newVenues: newVenues.size,
    topBands,
    topSongs,
    noSetlist,
    showsWithSetlist: yearShows.length - noSetlist.length,
    highlights: {
      firstShow: showRef(first),
      latestShow: showRef(latest),
      busiestMonth: { month: busiest, name: MONTHS[busiest], shows: months[busiest] },
      longestRun: longestRun(yearShows),
    },
    // "Updated through": the latest logged show, so a NYE show added on
    // Jan 1 visibly moves it.
    updatedThrough: showRef(latest).date,
  };
}

// ── Show buddy ────────────────────────────────────────────────────────
//
// The friend on the most of the year's shows, counting only tags that were
// accepted:
//   - a tag the user sent: show.taggedFriendUids is written the moment the
//     user tags someone, while the tag is still pending, so it isn't proof.
//     The accepted showTags the user sent (lib/yearRecapData.js) are, each
//     matched to the show by setlist.fm id, else band + venue + date, the
//     same key Shows Together uses (AppContext's getShowsTogether).
//   - a tag the user received: show.taggedByUid. The show is in the user's
//     list only because they accepted it.
// Only current friends count. Ties go to the friend whose name sorts
// first, so the answer doesn't change between reloads.

const norm = (v) => clean(v).toLowerCase();
export const tagShowKey = (s) => s?.setlistfmId || `${norm(s?.artist)}|${norm(s?.venue)}|${norm(s?.date)}`;

/**
 * @param yearShows      the year's shows (showsInYear)
 * @param acceptedSent   [{ toUid, showData }] — accepted showTags the user sent
 * @param friends        [{ friendUid, friendName }]
 * @returns { uid, name, firstName, shows } | null
 */
export function computeShowBuddy(yearShows = [], acceptedSent = [], friends = []) {
  const friendByUid = new Map((friends || []).map((f) => [f.friendUid, f]));
  const acceptedByShow = new Map(); // show key -> Set(uid)
  (acceptedSent || []).forEach((t) => {
    if (!t?.toUid || !t.showData || t.showData.upcoming) return;
    const key = tagShowKey(t.showData);
    if (!acceptedByShow.has(key)) acceptedByShow.set(key, new Set());
    acceptedByShow.get(key).add(t.toUid);
  });

  const counts = new Map();
  yearShows.forEach((show) => {
    const here = new Set();
    const accepted = acceptedByShow.get(tagShowKey(show));
    if (accepted) {
      (show.taggedFriendUids || []).forEach((uid) => { if (accepted.has(uid)) here.add(uid); });
    }
    if (show.taggedByUid) here.add(show.taggedByUid);
    here.forEach((uid) => {
      if (friendByUid.has(uid)) counts.set(uid, (counts.get(uid) || 0) + 1);
    });
  });

  const nameOf = (uid) => clean(friendByUid.get(uid)?.friendName) || 'Friend';
  const best = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || nameOf(a[0]).localeCompare(nameOf(b[0])))[0];
  if (!best) return null;
  const name = nameOf(best[0]);
  return { uid: best[0], name, firstName: name.split(/\s+/)[0], shows: best[1] };
}
