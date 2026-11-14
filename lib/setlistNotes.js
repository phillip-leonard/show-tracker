// lib/setlistNotes.js — what the user has said about a show's songs, and
// the "never lose ratings" check every setlist write runs (5.60.3).
//
// A show's setlist is not only source data: each song can carry the user's
// `rating` and `comment`. Any write that replaces a setlist must leave at
// least as many rated and as many commented songs as it found. This was
// written out three times (AppContext.applySetlistProposal via
// lib/bandSetlist.js, admin-resync-setlists.js, and nowhere at all in
// admin-populate-setlist.js); it now lives here.
//
// CommonJS on purpose, like lib/showDate.js and lib/stats, so the app and
// the Netlify functions share one definition.

/** A song comment counts when it is a non-blank string (or any other non-null value). */
function hasComment(song) {
  if (!song) return false;
  return typeof song.comment === 'string' ? song.comment.trim() !== '' : song.comment != null;
}

/** { rated, commented }: how many songs in `setlist` carry a rating or a comment. */
function userNoteCounts(setlist) {
  const songs = Array.isArray(setlist) ? setlist : [];
  return {
    rated: songs.filter((x) => x && x.rating != null).length,
    commented: songs.filter(hasComment).length,
  };
}

/** True when writing `after` over `before` would leave fewer rated or commented songs. */
function lostNotes(before, after) {
  const a = userNoteCounts(before);
  const b = userNoteCounts(after);
  return b.rated < a.rated || b.commented < a.commented;
}

/**
 * One song with nothing a user wrote about it: no rating, no comment. For a
 * setlist copied from someone else's show, whose notes are theirs.
 */
function withoutUserNotes(song) {
  if (!song || typeof song !== 'object') return song;
  const { rating: _rating, comment: _comment, ...rest } = song;
  return rest;
}

module.exports = { userNoteCounts, lostNotes, withoutUserNotes };
