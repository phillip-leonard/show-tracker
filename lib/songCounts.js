// lib/songCounts.js
//
// "Times seen" for a song is the number of distinct shows the user attended
// where it was played — not the number of times it appears in setlists. A
// song played twice in one show (a sandwich: started, interrupted by another
// song, then resumed; or a reprise) was seen at one show, so it counts once.
//
// Every place that counts songs across shows goes through here, so that rule
// lives in one spot. Only the counting changes: stored setlists are never
// touched, and both occurrences still render in the setlist itself.

import { normalizeSongTitle } from '@/lib/utils';

// The song-identity key most counters use: two spellings of one song
// ("Ashes//Dust" vs "Ashes // Dust") collapse together.
export function songTitleKey(name) {
  const raw = (name || '').trim();
  return normalizeSongTitle(raw) || raw;
}

// Calls fn(key, song, show) for the first occurrence of each song key in
// each show's setlist, skipping any later occurrence in the same show.
// `keyForSong(song, show)` returns the identity key, or a falsy value to
// skip the song entirely.
export function forEachSongOncePerShow(shows, keyForSong, fn) {
  (shows || []).forEach(show => {
    const seen = new Set();
    (show?.setlist || []).forEach(song => {
      const key = keyForSong(song, show);
      if (!key || seen.has(key)) return;
      seen.add(key);
      fn(key, song, show);
    });
  });
}

// key -> number of distinct shows the song was played at.
export function countSongsByShow(shows, keyForSong = song => songTitleKey(song?.name)) {
  const counts = {};
  forEachSongOncePerShow(shows, keyForSong, key => {
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

// The Stats → Songs table: one row per song with its show count, average
// rating, and every performance. `count` is distinct shows; `shows` keeps
// one entry per performance, so both halves of a sandwich stay listed (and
// separately rateable, since each is its own song in the setlist).
export function buildSongStats(shows) {
  const songMap = {};
  (shows || []).forEach(show => {
    const countedHere = new Set();
    (show.setlist || []).forEach(song => {
      const key = songTitleKey(song.name);
      if (!key) return;
      if (!songMap[key]) {
        songMap[key] = { count: 0, ratings: [], shows: [], spellings: {} };
      }
      const entry = songMap[key];
      if (!countedHere.has(key)) {
        countedHere.add(key);
        entry.count++;
      }
      entry.spellings[song.name] = (entry.spellings[song.name] || 0) + 1;
      if (song.rating) entry.ratings.push(song.rating);
      entry.shows.push({
        showId: show.id,
        songId: song.id,
        date: show.date,
        artist: show.artist,
        venue: show.venue,
        city: show.city,
        rating: song.rating,
        comment: song.comment,
      });
    });
  });
  return Object.values(songMap)
    .map(data => ({
      name: Object.entries(data.spellings).sort((a, b) => b[1] - a[1])[0][0],
      count: data.count,
      avgRating: data.ratings.length
        ? (data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length).toFixed(1)
        : null,
      shows: data.shows,
    }))
    .sort((a, b) => b.count - a.count);
}
