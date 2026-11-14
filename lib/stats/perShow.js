// lib/stats/perShow.js — a song played twice at one show was seen at one
// show (5.60.4).
//
// forEachSongOncePerShow(shows, keyForSong, fn) calls fn(key, song, show)
// for the first occurrence of each song key in each show's setlist and
// skips any later occurrence in the same show (a sandwich, a reprise).
// `keyForSong(song, show)` returns the identity key, or a falsy value to
// skip the song entirely.
//
// CommonJS, like the rest of lib/stats, so the server's Year in Review
// numbers and the app count songs with the same code. lib/songCounts.js
// re-exports it for the app.

function forEachSongOncePerShow(shows, keyForSong, fn) {
  (shows || []).forEach((show) => {
    const seen = new Set();
    ((show && show.setlist) || []).forEach((song) => {
      const key = keyForSong(song, show);
      if (!key || seen.has(key)) return;
      seen.add(key);
      fn(key, song, show);
    });
  });
}

module.exports = { forEachSongOncePerShow };
