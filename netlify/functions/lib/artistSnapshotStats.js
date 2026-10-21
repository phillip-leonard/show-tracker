// netlify/functions/lib/artistSnapshotStats.js
//
// Band-wide song stats for the public band and song pages: times played,
// first and last played, current gap, average gap, most played, gap
// leaders. Computed once per snapshot run, from every show a source has
// for one artist.
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
// Input shows, from publicArtistSources.js, already normalized:
//   { id, date: 'YYYY-MM-DD', order, venue, city, state, country, url,
//     songs: [{ key, slug, name, original, originalArtist }] }

const RECENT_SHOWS = 10;
const MOST_PLAYED = 25;
const GAP_LEADERS = 10;
const GAP_LEADER_MIN_PLAYS = 5;
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

    let longestGap = null;
    let gapSum = 0;
    for (let i = 0; i < indices.length - 1; i++) {
      const gap = indices[i + 1] - indices[i] - 1;
      gapSum += gap;
      if (longestGap === null || gap > longestGap) longestGap = gap;
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
      recentPerformances: indices.slice(-RECENT_PERFORMANCES).reverse().map((i) => showRef(timeline[i])),
      original: agg.original,
      originalArtist: agg.original === false ? agg.originalArtist : '',
      sourceUrl: agg.sourceUrl,
    };
  });

  assignSlugs(songs);
  songs.forEach((s) => { delete s.firstIndex; delete s.sourceSlug; });

  const byPlays = (a, b) => b.timesPlayed - a.timesPlayed || a.name.localeCompare(b.name);
  const summary = (s) => ({ slug: s.slug, name: s.name, timesPlayed: s.timesPlayed, currentGap: s.currentGap, lastPlayed: s.lastPlayed.date });

  const band = {
    totalShows: total,
    firstShow: total ? showRef(timeline[0]) : null,
    lastShow: total ? showRef(timeline[total - 1]) : null,
    recentShows: timeline.slice(-RECENT_SHOWS).reverse().map(showRef),
    songCount: songs.length,
    mostPlayed: songs.slice().sort(byPlays).slice(0, MOST_PLAYED).map(summary),
    gapLeaders: songs
      .filter((s) => s.timesPlayed >= GAP_LEADER_MIN_PLAYS)
      .sort((a, b) => b.currentGap - a.currentGap || byPlays(a, b))
      .slice(0, GAP_LEADERS)
      .map(summary),
  };

  songs.sort((a, b) => a.slug.localeCompare(b.slug));
  return { band, songs };
}

module.exports = { buildArtistStats, slugify, GAP_LEADER_MIN_PLAYS };
