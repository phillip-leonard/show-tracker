/**
 * showDoc — the one place a show document's shape and id are made.
 *
 * Moved out of context/AppContext.jsx in 5.59.10 (B-13): the festival
 * import built its own documents (ids from String(idSeed++), its own
 * isManual rule, no band-source setlist), and the guest merge wrote raw
 * guest documents. Both now come through here, like addShow.
 */

import { toIsoDate } from '@/lib/showDate';

// Show ids have always been millisecond timestamps as strings, and every
// existing document in Firestore is keyed that way, so the format is fixed.
// The counter is what makes it safe to mint several in a row: `Date.now()`
// alone returns the same value for every call inside the same millisecond,
// which is exactly what a bulk add does. Monotonic, so ids still sort by
// creation order.
let lastMintedShowId = 0;

export function mintShowId() {
  const now = Date.now();
  lastMintedShowId = now > lastMintedShowId ? now : lastMintedShowId + 1;
  return String(lastMintedShowId);
}

// ── Helper: the one place a show document's shape is defined ────────────
// Every add path builds its documents here (addShow, addShowsFromTour,
// importShowsToFestival and the guest merge since 5.59.10), so a bulk-added show is byte-for-byte the
// same shape as a hand-added one — setlist, venue, artist, tour name, all
// of it. Change the shape here or not at all.
export function buildShowDoc(showData, id) {
  return {
    ...showData,
    id,
    // Stored as ISO 'YYYY-MM-DD' only (lib/showDate.js); a date that can't
    // be read is kept as given rather than dropped.
    date: toIsoDate(showData.date) || showData.date || '',
    setlist: showData.setlist || [],
    createdAt: new Date().toISOString(),
    // `isManual` means "nobody but the user wrote this setlist", and it is
    // what admin-populate-setlist.js checks before it refuses to overwrite.
    // It used to be derived from setlistfmId alone, which was the same
    // question back when setlist.fm was the only source. A band-sourced
    // show (El Goose, Phish.net — see lib/setlistSources.js) has no
    // setlistfmId and is emphatically not manual, so the source id counts
    // too.
    isManual: !showData.setlistfmId && !isBandSourced(showData),
  };
}

// True when this show's setlist came from a band source rather than from
// setlist.fm or the user. Reads the stored `setlistSource` field rather than
// sniffing for the presence of `footnote`/`transitionMark`: a Goose show
// where nobody wrote any footnotes is still a Goose show from El Goose.
export function isBandSourced(showData) {
  const id = showData?.setlistSource;
  return !!id && id !== 'setlistfm';
}
