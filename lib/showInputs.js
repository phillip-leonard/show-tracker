// lib/showInputs.js — what each way of adding a show starts from, turned
// into show data, and the canonical shape every new show document has
// (5.60.5, pre-native server moves Part 1a).
//
// The server's normalize-show (lib/normalizeShow.js) builds every new show
// from one of these inputs; the web app (Part 1b) and the Swift app send
// the inputs instead of building documents themselves, so a show is the
// same document whichever app added it. CommonJS, like lib/showDate.js.
//
// ── The canonical shape of a new show document ────────────────────────
//
//   artist, venue, city   string, trimmed ('' when unknown; never absent)
//   date                  ISO 'YYYY-MM-DD' (lib/showDate.js), or the text as
//                         given when it can't be read
//   country, state        string, trimmed; absent when empty
//   tour                  string, trimmed, or null
//   setlist               array of songs (sanitizeSong); [] when none
//   setlistfmId           string; absent when the show isn't from setlist.fm
//   setlistfmUrl          string; absent with no setlistfmId or no URL
//   artistMbid            string; absent when unknown
//   rating                integer 1–10; absent when unrated
//   comment               string, trimmed; absent when empty
//   setlistSource, isManual, createdAt, band-source fields, tags: as
//                         lib/showDoc.js and lib/bandSetlistRules.js write them
//
// Documents written before 5.60.5 may carry '' or null where this shape
// has the field absent; every reader treats the three the same, and the
// sweep (normalize-shows-sweep.js) leaves them alone.

const { fromSetlistfmDate } = require('./showDate');
const { extractSongsFromSetlist, randomSongId } = require('./setlistParser');

const validRating = (r) => Number.isInteger(r) && r >= 1 && r <= 10;
const clean = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

// ── Songs ─────────────────────────────────────────────────────────────

/**
 * One song with its name trimmed and an id, every other field kept as it
 * came (the source's and the user's: lib/bandSetlistMerge.js lists them,
 * and a merge adds notInSource), minus undefined values and an invalid
 * rating. null for an entry with no title, which is not a song.
 */
function sanitizeSong(song, index, { idFor = randomSongId } = {}) {
  if (!song || typeof song !== 'object') return null;
  const name = clean(song.name);
  if (!name) return null;
  const out = {};
  for (const [k, v] of Object.entries(song)) if (v !== undefined) out[k] = v;
  out.name = name;
  out.id = typeof song.id === 'string' && song.id ? song.id : idFor(index);
  if (out.rating != null && !validRating(out.rating)) delete out.rating;
  return out;
}

function sanitizeSetlist(setlist, opts) {
  return (Array.isArray(setlist) ? setlist : [])
    .map((song, i) => sanitizeSong(song, i, opts))
    .filter(Boolean);
}

// ── Show-level fields ─────────────────────────────────────────────────

/**
 * canonicalShowData(data) -> show data in the shape above. Unknown
 * top-level fields are kept (band-source fields, tags, festivalId…); the
 * named ones are normalized.
 */
function canonicalShowData(data, opts = {}) {
  const out = { ...data };
  for (const k of ['artist', 'venue', 'city']) out[k] = clean(data[k]);
  for (const k of ['country', 'state', 'comment', 'setlistfmId', 'setlistfmUrl', 'artistMbid']) {
    const v = clean(data[k]);
    if (v) out[k] = v; else delete out[k];
  }
  if (!out.setlistfmId) delete out.setlistfmUrl;
  out.tour = clean(data.tour) || null;
  if (validRating(data.rating)) out.rating = data.rating; else delete out.rating;
  out.setlist = sanitizeSetlist(data.setlist, opts);
  for (const [k, v] of Object.entries(out)) if (v === undefined) delete out[k];
  return out;
}

// ── The inputs ────────────────────────────────────────────────────────

/** A setlist.fm setlist (search, "Add all", ticket scan, festival lineup). */
function showDataFromSetlistfm(setlist, { idFor } = {}) {
  return {
    artist: setlist?.artist?.name || '',
    venue: setlist?.venue?.name || '',
    city: setlist?.venue?.city?.name || '',
    country: setlist?.venue?.city?.country?.name || '',
    // setlist.fm sends DD-MM-YYYY.
    date: fromSetlistfmDate(setlist?.eventDate) || setlist?.eventDate || '',
    setlist: extractSongsFromSetlist(setlist, idFor ? { idFor } : {}),
    setlistfmId: setlist?.id || '',
    // The attribution link setlist.fm's terms ask for.
    setlistfmUrl: setlist?.url || '',
    // So lib/setlistSources.js can tell same-named bands apart by mbid
    // (the Dutch Goose); not stored before 5.60.5.
    artistMbid: setlist?.artist?.mbid || '',
    tour: setlist?.tour ? setlist.tour.name : null,
  };
}

// The fields a person types or a scan reads (manual form, ticket scan
// rows, a band-source lookup by artist and date).
const TYPED_FIELDS = ['artist', 'venue', 'city', 'country', 'state', 'date', 'tour', 'setlist', 'rating', 'comment'];

function pick(data, fields) {
  const out = {};
  for (const f of fields) if (data && data[f] !== undefined) out[f] = data[f];
  return out;
}

function showDataFromFields(fields) {
  return pick(fields, TYPED_FIELDS);
}

// A spreadsheet row after the importer matched it (lib/importSheet.js
// showDataFor): typed fields plus where its setlist came from.
const CSV_FIELDS = [
  ...TYPED_FIELDS, 'setlistSource', 'setlistfmId', 'setlistfmUrl', 'setlistProposal',
  'sourceShowId', 'sourcePermalink', 'setlistNotes', 'setlistFetchedAt', 'sourceLicenseUrl', 'needsReview', 'needsReviewReason',
];

function showDataFromCsvRow(row) {
  return pick(row, CSV_FIELDS);
}

// What a friend's tag carries (AppContext sanitizeShowForTag): event facts
// and the songs' names and sets, never the tagger's notes.
const TAG_FIELDS = ['artist', 'venue', 'date', 'city', 'tour', 'setlistfmId', 'setlistfmUrl', 'setlist'];

function showDataFromTag(showData, { fromName, fromUid } = {}) {
  const data = pick(showData || {}, TAG_FIELDS);
  data.setlist = (Array.isArray(data.setlist) ? data.setlist : []).map((song) => {
    const out = {};
    for (const k of ['id', 'name', 'set', 'cover', 'tape']) if (song && song[k] !== undefined) out[k] = song[k];
    return out;
  });
  if (fromName) data.taggedBy = fromName;
  if (fromUid) data.taggedByUid = fromUid;
  return data;
}

/**
 * An upcoming show the user went to (lib/upcomingShows.js), with the
 * setlist.fm show data for that night when there is one. Moved here from
 * lib/upcomingShows.js, which re-exports it.
 */
function upcomingToShowData(show, setlistShowData = null) {
  const base = {
    artist: show.artist,
    venue: show.venue,
    city: show.city || '',
    date: show.date,
    setlist: [],
  };
  const merged = setlistShowData
    ? { ...base, ...setlistShowData, date: show.date }
    : base;
  if (show.taggedFriendUids?.length) merged.taggedFriendUids = [...show.taggedFriendUids];
  if (show.taggedBy) merged.taggedBy = show.taggedBy;
  if (show.taggedByUid) merged.taggedByUid = show.taggedByUid;
  if (show.notes) merged.comment = show.notes;
  return merged;
}

module.exports = {
  sanitizeSong,
  sanitizeSetlist,
  canonicalShowData,
  showDataFromSetlistfm,
  showDataFromFields,
  showDataFromCsvRow,
  showDataFromTag,
  upcomingToShowData,
  TYPED_FIELDS,
  CSV_FIELDS,
};
