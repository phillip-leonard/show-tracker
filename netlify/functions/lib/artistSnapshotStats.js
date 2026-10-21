// netlify/functions/lib/artistSnapshotStats.js
//
// Band-wide song stats for the public band and song pages: times played,
// first and last played, current gap, average gap, longest gap ever (and
// the two shows either side of it), most played, current gap leaders split
// into originals and covers, and the biggest bust-outs. Computed once per
// snapshot run, from every show a source has for one artist.
//
// ── The gap math is lib/songIndex.js's, ported ────────────────────────
//
// buildSongIndex (5.3.0's song pages) already defines how this app counts
// a song: a song played twice in one show (a sandwich, a reprise) is one
// show played, gaps are measured in shows over the artist's own
// chronological timeline, the current gap is (total shows - 1) - the index
// of the last show it was played at, and a gap between two performances is
// the number of shows strictly between them. This module uses exactly those
// rules so a "current gap" means the same thing on a public band page as
// on a signed-in user's own song page.
//
// It cannot import lib/songIndex.js: that is an ES module with `@/`
// imports, and one of them (lib/wishlist.js) pulls in the Firebase client
// SDK. So the arithmetic exists twice, the same way bandSetlistMergeRule.js
// mirrors lib/bandSetlistMerge.js, and lib/__tests__/artistSnapshotStatsParity.test.js
// runs both over the same shows and fails on any disagreement.
//
// Gaps are therefore "shows since": 0 means it was played at the most
// recent show. phish.net counts a song played at the last show as a gap of
// 1; the pages label the number "shows since last played" so the two
// conventions can't be confused.
//
// ── One deliberate difference: gaps between two performances ──────────
//
// songIndex's longest gap is the shows strictly between two performances.
// Here it counts the show the song came back at too, which is how
// phish.net and the Songfish sites print a bust-out ("the first Fuck Your
// Face since April 29, 1987 (1,426 shows)"), and those are the numbers a
// fan checks a public page against. So longestGap and averageGap here are
// songIndex's plus one, and the parity test pins exactly that. It is also
// the current gap a song had going into its bust-out show, plus that show.
//
// Input shows, from publicArtistSources.js, already normalized:
//   { id, date: 'YYYY-MM-DD', order, venue, city, state, country, url,
//     songs: [{ key, slug, name, original, originalArtist }] }
//
// `original` is true, false or null (the source doesn't say). It comes out
// as `isOriginal`, and a null song is left out of both gap lists and the
// bust-outs rather than guessed into one.

const RECENT_SHOWS = 10;
const MOST_PLAYED = 25;
const GAP_LEADERS = 10;
const GAP_LEADER_MIN_PLAYS = 5;
const BUST_OUTS = 10;
// A song back after fewer shows than this is a rotation gap, not a
// bust-out. Below every native-source band's top ten by far; it keeps a
// band whose own songs barely exist on setlist.fm (Dead & Company: one
// eight-show jam) from listing those.
const BUST_OUT_MIN_GAP = 50;
const RECENT_PERFORMANCES = 10;

function chronological(shows) {
  return shows.slice().sort((a, b) =>
    a.date.localeCompare(b.date)
    || (a.order || 0) - (b.order || 0)
    || String(a.id).localeCompare(String(b.id)));
}

function showRef(show) {
  return {
    date: show.date,
    venue: show.venue || '',
    city: [show.city, show.state || show.country].filter(Boolean).join(', '),
    url: show.url || '',
  };
}

// Lowercase, hyphenated, [a-z0-9-] only. Source slugs (Songfish, phish.net)
// already look like this; the pass is for the odd one that doesn't and for
// titles with no source slug at all.
function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// One slug per song, unique within the artist. Assigned in a fixed order
// (first played, then source key) so a collision always resolves the same
// way on every run: the older song keeps the plain slug.
function assignSlugs(songs) {
  const taken = new Set();
  const ordered = songs.slice().sort((a, b) =>
    a.firstIndex - b.firstIndex || String(a.key).localeCompare(String(b.key)));
  for (const song of ordered) {
    const base = slugify(song.sourceSlug) || slugify(song.name) || slugify(song.key) || 'song';
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    song.slug = slug;
  }
}

/**
 * @param {object[]} shows  normalized shows (any order)
 * @returns {{ band: object, songs: object[] }}
 */
function buildArtistStats(shows) {
  const timeline = chronological(shows.filter((s) => s && s.date));
  const total = timeline.length;

  // ── Every song, the distinct shows it was played at, in order ─────────
  const byKey = new Map();
  timeline.forEach((show, index) => {
    const seenThisShow = new Set();
    for (const song of show.songs || []) {
      if (!song || !song.key || !song.name) continue;
      if (seenThisShow.has(song.key)) continue; // a sandwich is one show played
      seenThisShow.add(song.key);
      if (!byKey.has(song.key)) {
        byKey.set(song.key, {
          key: song.key,
          name: song.name,
          sourceSlug: song.slug || '',
          original: typeof song.original === 'boolean' ? song.original : null,
          originalArtist: song.originalArtist || '',
          sourceUrl: song.sourceUrl || '',
          indices: [],
        });
      }
      byKey.get(song.key).indices.push(index);
    }
  });

  const songs = [...byKey.values()].map((agg) => {
    const { indices } = agg;
    const first = indices[0];
    const last = indices[indices.length - 1];

    // The first of equal longest gaps wins, as in songIndex. A gap counts
    // the show the song came back at (see the header).
    let longestGap = null;
    let longestAt = -1;
    let gapSum = 0;
    for (let i = 0; i < indices.length - 1; i++) {
      const gap = indices[i + 1] - indices[i];
      gapSum += gap;
      if (longestGap === null || gap > longestGap) { longestGap = gap; longestAt = i; }
    }

    return {
      key: agg.key,
      name: agg.name,
      sourceSlug: agg.sourceSlug,
      firstIndex: first,
      timesPlayed: indices.length,
      firstPlayed: showRef(timeline[first]),
      lastPlayed: showRef(timeline[last]),
      currentGap: (total - 1) - last,
      // Only defined between two performances, like longestGap in songIndex.
      averageGap: indices.length > 1 ? Math.round((gapSum / (indices.length - 1)) * 10) / 10 : null,
      longestGap,
      // The last show before the longest gap, and the show it came back at.
      gapStart: longestAt < 0 ? null : showRef(timeline[indices[longestAt]]),
      gapEnd: longestAt < 0 ? null : showRef(timeline[indices[longestAt + 1]]),
      recentPerformances: indices.slice(-RECENT_PERFORMANCES).reverse().map((i) => showRef(timeline[i])),
      isOriginal: agg.original,
      originalArtist: agg.original === false ? agg.originalArtist : '',
      sourceUrl: agg.sourceUrl,
    };
  });

  assignSlugs(songs);
  songs.forEach((s) => { delete s.firstIndex; delete s.sourceSlug; });

  const byPlays = (a, b) => b.timesPlayed - a.timesPlayed || a.name.localeCompare(b.name);
  const summary = (s) => ({ slug: s.slug, name: s.name, isOriginal: s.isOriginal, timesPlayed: s.timesPlayed, currentGap: s.currentGap, lastPlayed: s.lastPlayed.date });
  const gapLeaders = (list) => list
    .filter((s) => s.timesPlayed >= GAP_LEADER_MIN_PLAYS)
    .sort((a, b) => b.currentGap - a.currentGap || byPlays(a, b))
    .slice(0, GAP_LEADERS)
    .map(summary);

  const band = {
    totalShows: total,
    firstShow: total ? showRef(timeline[0]) : null,
    lastShow: total ? showRef(timeline[total - 1]) : null,
    recentShows: timeline.slice(-RECENT_SHOWS).reverse().map(showRef),
    songCount: songs.length,
    mostPlayed: songs.slice().sort(byPlays).slice(0, MOST_PLAYED).map(summary),
    // Originals and covers together. The pages no longer show it; it stays
    // for anything still reading the version 1 snapshot.
    gapLeaders: gapLeaders(songs),
    originalGapLeaders: gapLeaders(songs.filter((s) => s.isOriginal === true)),
    coverGapLeaders: gapLeaders(songs.filter((s) => s.isOriginal === false)),
    // The longest gaps ever between two performances of an original: the
    // biggest bust-outs. Only meaningful over a band's whole history;
    // publicArtistSnapshot.js drops it for a partial one.
    bustOuts: songs
      .filter((s) => s.isOriginal === true && s.longestGap >= BUST_OUT_MIN_GAP)
      .sort((a, b) => b.longestGap - a.longestGap
        || b.gapEnd.date.localeCompare(a.gapEnd.date)
        || a.name.localeCompare(b.name))
      .slice(0, BUST_OUTS)
      .map((s) => ({ slug: s.slug, name: s.name, timesPlayed: s.timesPlayed, longestGap: s.longestGap, gapStart: s.gapStart, gapEnd: s.gapEnd })),
  };

  songs.sort((a, b) => a.slug.localeCompare(b.slug));
  return { band, songs };
}

module.exports = { buildArtistStats, slugify, GAP_LEADER_MIN_PLAYS };
