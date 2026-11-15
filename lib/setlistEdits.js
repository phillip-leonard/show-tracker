// lib/setlistEdits.js — a user's edit to a setlist, as an operation on
// songs by id rather than a whole new array (5.60.9, R-06).
//
// Song ratings and comments live inside the show's `setlist` array, and
// Firestore can't change one element of an array: any edit rewrites the
// whole array. Until 5.60.9 the app rewrote it (with every other field)
// from the copy of the show it loaded, so a rating made on the phone was
// lost the next time the laptop saved anything about that show.
//
// Now an edit is described (rate this song, delete that one, move these)
// and applied to the setlist AS STORED, in a transaction
// (context/AppContext.jsx editSetlist): what someone else changed since
// this device loaded the show is kept. The same function runs on the
// device first, so the screen changes at once, and alone when the device
// is offline (then the device's copy is written, last write wins, as
// before). No data-shape change: the setlist is the same array.
//
// CommonJS, like lib/showDate.js, so the server and the Swift app's
// contract tests can run the same rules.
//
// Edits ({ type, … }):
//   rate         { songId, rating }      rating may be null (cleared)
//   comment      { songId, comment }
//   rate-unrated { rating }              every song with no rating yet
//   add          { song }                appended; a song already there (same id) is left alone
//   delete       { songId }
//   restore      { song, index }         the undo of delete; no-op when the song is back
//   reorder      { setlist }             the set editor's new order and set labels
//
// applySetlistEdit(setlist, edit) -> { setlist, changed, removed?, index? }

/** Removes one song by id: { setlist, removed, index }, removed null when it isn't there. */
function removeSongFromSetlist(setlist = [], songId) {
  const list = Array.isArray(setlist) ? setlist : [];
  const index = list.findIndex((song) => song && song.id === songId);
  if (index === -1) return { setlist, removed: null, index: -1 };
  return {
    setlist: [...list.slice(0, index), ...list.slice(index + 1)],
    removed: list[index],
    index,
  };
}

// The other half of the undo: puts a song back at a given position, with
// everything it was carrying — its id, its set, its rating, its comment.
// An index past the end (or a negative one) appends rather than throwing,
// so an undo still works if the setlist shrank in the meantime.
function insertSongAt(setlist = [], song, index) {
  const list = Array.isArray(setlist) ? setlist : [];
  if (!song) return list;
  const at = Number.isInteger(index) && index >= 0 ? Math.min(index, list.length) : list.length;
  return [...list.slice(0, at), song, ...list.slice(at)];
}

function patchSong(list, songId, patch) {
  let changed = false;
  const setlist = list.map((song) => {
    if (!song || song.id !== songId) return song;
    const next = { ...song, ...patch };
    if (Object.keys(patch).some((k) => song[k] !== next[k])) changed = true;
    return next;
  });
  return { setlist: changed ? setlist : list, changed };
}

/**
 * The set editor's new order, applied to the stored setlist: the order and
 * `set` labels come from the editor; everything else about each song (its
 * rating, its comment, what the source says) comes from the stored copy,
 * which may be newer. A song stored but not in the editor's list was added
 * elsewhere meanwhile and is kept, after the others; a song in the
 * editor's list that is no longer stored is kept too. Nothing is dropped.
 */
function reorder(list, edited) {
  const byId = new Map(list.filter(Boolean).map((song) => [song.id, song]));
  const seen = new Set();
  const out = [];
  for (const song of Array.isArray(edited) ? edited : []) {
    if (!song) continue;
    const stored = byId.get(song.id);
    out.push(stored ? { ...stored, set: song.set } : song);
    seen.add(song.id);
  }
  for (const song of list) if (song && !seen.has(song.id)) out.push(song);
  const changed = out.length !== list.length || out.some((song, i) => song !== list[i] && (song.id !== list[i].id || song.set !== list[i].set));
  return { setlist: changed ? out : list, changed };
}

function applySetlistEdit(setlist, edit) {
  const list = Array.isArray(setlist) ? setlist : [];
  switch (edit && edit.type) {
    case 'rate':
      return patchSong(list, edit.songId, { rating: edit.rating == null ? null : edit.rating });
    case 'comment':
      return patchSong(list, edit.songId, { comment: edit.comment });
    case 'rate-unrated': {
      let changed = false;
      const out = list.map((song) => {
        if (!song || song.rating) return song;
        changed = true;
        return { ...song, rating: edit.rating };
      });
      return { setlist: changed ? out : list, changed };
    }
    case 'add':
      if (!edit.song || list.some((song) => song && song.id === edit.song.id)) return { setlist: list, changed: false };
      return { setlist: [...list, edit.song], changed: true };
    case 'delete': {
      const { setlist: out, removed, index } = removeSongFromSetlist(list, edit.songId);
      return removed ? { setlist: out, changed: true, removed, index } : { setlist: list, changed: false, removed: null, index: -1 };
    }
    case 'restore':
      if (!edit.song || list.some((song) => song && song.id === edit.song.id)) return { setlist: list, changed: false };
      return { setlist: insertSongAt(list, edit.song, edit.index), changed: true };
    case 'reorder':
      return reorder(list, edit.setlist);
    default:
      return { setlist: list, changed: false };
  }
}

module.exports = { applySetlistEdit, removeSongFromSetlist, insertSongAt };
