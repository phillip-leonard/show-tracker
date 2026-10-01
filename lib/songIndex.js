// lib/songIndex.js
//
// Builds a personal, per-user song index from the shows already loaded in
// AppContext — one pass over all shows and their setlists, keyed by
// `${artistSlug}:${normalizedTitle}` so the same song under two spellings
// merges on one page, while the same title under two different artists
// stays on two. No Firestore reads of its own — see hooks/useSongIndex.js
// for the memoized consumer.
//
// "Personal gap" here means shows/days since *this user's* own last
// performance of the song, counted across *this user's* own logged shows
// for that artist — not a global/tour-wide gap (that needs setlist.fm
// backfill of shows the user didn't attend, and isn't built here). The
// aggregate shape below only tracks per-performance data, so a future pass
// can add a separate global-gap field without reshaping this one.

import { parseDate, normalizeSongTitle } from '@/lib/utils';
import { groupSongsBySet } from '@/lib/setlistGrouping';
import { artistKeyFor } from '@/lib/wishlist';

const MS_PER_DAY = 86400000;

// Slug for an artist name alone, ignoring any mbid. Show docs only ever
// store a plain artist string (no mbid), so every song-index key must be
// derived the same mbid-less way or a link built from an mbid-bearing
// artist object (e.g. the Wishlist's selected artist) would point at a
// slug this index never produces.
export function artistSlugFromName(name) {
  return artistKeyFor({ name });
}

export function songSlugFromTitle(title) {
  return normalizeSongTitle(title).replace(/\s+/g, '-');
}

export function songKeyFor(artistName, title) {
  const artistSlug = artistSlugFromName(artistName);
  const normalized = normalizeSongTitle(title);
  if (!artistSlug || !normalized) return null;
  return `${artistSlug}:${normalized}`;
}

export function songKeyFromParams(artistId, songSlug) {
  if (!artistId || !songSlug) return null;
  return `${artistId}:${songSlug.replace(/-/g, ' ')}`;
}

function daysBetween(fromDateStr, toDateStr) {
  return Math.round((parseDate(toDateStr).getTime() - parseDate(fromDateStr).getTime()) / MS_PER_DAY);
}

function bumpCount(map, key, value) {
  if (!value) return;
  if (!map.has(key)) map.set(key, new Map());
  const inner = map.get(key);
  inner.set(value, (inner.get(value) || 0) + 1);
}

// Picks the most-seen exact-cased spelling for a key, so a song with
// inconsistent casing/punctuation in the source data displays the way the
// user actually typed it most often, rather than the normalized form.
function pickMostCommon(countsMap) {
  let best = null;
  let bestCount = -1;
  for (const [value, count] of countsMap || []) {
    if (count > bestCount) { best = value; bestCount = count; }
  }
  return best;
}

export function buildSongIndex(shows = []) {
  // ── Pass 1: group shows by artist, sorted chronologically ──────────────
  // This gives every show a stable 0-based index within its artist's own
  // timeline, which is what "shows since" gap counts are measured against.
  const artistShowLists = new Map(); // artistSlug -> [{ id, date }]
  shows.forEach(show => {
    if (!show?.artist) return;
    const artistSlug = artistSlugFromName(show.artist);
    if (!artistSlug) return;
    if (!artistShowLists.has(artistSlug)) artistShowLists.set(artistSlug, []);
    artistShowLists.get(artistSlug).push({ id: show.id, date: show.date });
  });

  const artistShowIndex = new Map(); // artistSlug -> Map(showId -> index)
  const artistShowCount = new Map(); // artistSlug -> total shows for that artist
  artistShowLists.forEach((list, artistSlug) => {
    list.sort((a, b) => parseDate(a.date) - parseDate(b.date));
    const idxMap = new Map();
    list.forEach((s, i) => idxMap.set(s.id, i));
    artistShowIndex.set(artistSlug, idxMap);
    artistShowCount.set(artistSlug, list.length);
  });

  // ── Pass 2: walk every show's setlist once, bucketing by song key ──────
  const songs = new Map(); // key -> { artistSlug, performances[] }
  const titleSpellings = new Map(); // key -> Map(spelling -> count)
  const artistSpellings = new Map(); // artistSlug -> Map(spelling -> count)

  shows.forEach(show => {
    const setlist = show?.setlist || [];
    if (!show?.artist || setlist.length === 0) return;
    const artistSlug = artistSlugFromName(show.artist);
    if (!artistSlug) return;
    bumpCount(artistSpellings, artistSlug, show.artist.trim());

    // Only trust set/encore structure when at least one song on this show
    // actually carries it — otherwise every song would silently inherit
    // groupSongsBySet's "Set I" fallback, which is the right call for the
    // show detail page but would misrepresent "no set data" as "Set I" here.
    const hasAnySetInfo = setlist.some(s => s.set || s.setBreak);
    const setInfoBySongId = new Map();
    if (hasAnySetInfo) {
      groupSongsBySet(setlist).forEach(group => {
        const isEncore = /^Encore/.test(group.label);
        group.songs.forEach((song, i) => {
          setInfoBySongId.set(song.id, {
            setLabel: group.label,
            position: i + 1,
            isSetCloser: i === group.songs.length - 1,
            isEncore,
          });
        });
      });
    }

    const idxMap = artistShowIndex.get(artistSlug);
    const artistShowIdx = idxMap.get(show.id);

    setlist.forEach((song, i) => {
      const title = (song?.name || '').trim();
      const key = songKeyFor(show.artist, title);
      if (!key) return;

      bumpCount(titleSpellings, key, title);

      if (!songs.has(key)) {
        songs.set(key, { artistSlug, performances: [] });
      }

      const setInfo = setInfoBySongId.get(song.id) || null;

      songs.get(key).performances.push({
        showId: show.id,
        date: show.date,
        venue: show.venue || '',
        city: show.city || '',
        setLabel: setInfo?.setLabel || null,
        position: setInfo?.position ?? null,
        isShowOpener: i === 0,
        isSetCloser: !!setInfo?.isSetCloser,
        isEncore: !!setInfo?.isEncore,
        // Segues are stored one-directionally: `tape` on a song means it
        // ran into the *next* one, which is exactly what the show detail
        // setlist renders as a "> segue" line beneath it. A song's
        // segue-in is therefore the previous song's flag.
        segueIn: i > 0 && !!setlist[i - 1]?.tape,
        segueOut: !!song.tape,
        rating: song.rating ?? null,
        manuallyAdded: !!song.manuallyAdded,
        _artistShowIndex: artistShowIdx,
      });
    });
  });

  // ── Pass 3: finalize each song — sort, compute gaps, pick display names ─
  const index = {};
  songs.forEach((agg, key) => {
    const chrono = agg.performances.slice().sort((a, b) => a._artistShowIndex - b._artistShowIndex);
    const totalArtistShows = artistShowCount.get(agg.artistSlug) || chrono.length;

    // A song played twice in one show (a sandwich or a reprise) is two
    // performances but one show seen — see lib/songCounts.js. Times seen and
    // gaps are measured over distinct shows; `performances` below still
    // lists both occurrences.
    const showsSeen = chrono.filter((p, i) => i === 0 || p.showId !== chrono[i - 1].showId);

    const first = showsSeen[0];
    const last = showsSeen[showsSeen.length - 1];

    const currentGap = {
      shows: (totalArtistShows - 1) - last._artistShowIndex,
      days: daysBetween(last.date, new Date().toISOString().slice(0, 10)),
    };

    // Longest gap only exists between two actual shows — with a single
    // show ever, there's no bracketed historical gap to report (the
    // open-ended current gap is already surfaced separately).
    let longestGap = null;
    for (let i = 0; i < showsSeen.length - 1; i++) {
      const a = showsSeen[i], b = showsSeen[i + 1];
      const gapShows = b._artistShowIndex - a._artistShowIndex - 1;
      if (!longestGap || gapShows > longestGap.shows) {
        longestGap = { shows: gapShows, days: daysBetween(a.date, b.date), fromDate: a.date, toDate: b.date };
      }
    }

    index[key] = {
      key,
      artistSlug: agg.artistSlug,
      artistName: pickMostCommon(artistSpellings.get(agg.artistSlug)),
      title: pickMostCommon(titleSpellings.get(key)),
      // Reverse-chronological for display — the internal-only sort index
      // is dropped here so callers never see it.
      performances: chrono
        .slice()
        .sort((a, b) => b._artistShowIndex - a._artistShowIndex)
        .map(({ _artistShowIndex, ...rest }) => rest),
      timesSeen: showsSeen.length,
      firstSeen: { date: first.date, venue: first.venue, city: first.city, showId: first.showId },
      lastSeen: { date: last.date, venue: last.venue, city: last.city, showId: last.showId },
      currentGap,
      longestGap,
    };
  });

  return index;
}
