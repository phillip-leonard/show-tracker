/**
 * netlify/functions/lib/bandSetlistShape.js
 *
 * The normalized song shape every band-source adapter produces, and the
 * canonical-label / transition logic they all share. The adapters
 * (songfishAdapter.js, phishnetAdapter.js) are then nothing but "fetch this
 * URL and tell me which upstream key means what" — which is the only part
 * that differs between sources, and the only part that needs re-checking
 * against a live response.
 *
 * ── The contract with the rest of the app ─────────────────────────────
 *
 * A song object here must be readable by everything that already consumes
 * a stored setlist: lib/songIndex.js, lib/setlistGrouping.js,
 * lib/playlistCreator.js, components/shows/SetlistView.jsx,
 * components/shows/ShowDetailView.jsx and components/runs/RunDetailView.jsx.
 * So every field those already read keeps its exact current meaning:
 *
 *   id      – the same "timestamp base36 + random" id extractSongsFromSetlist
 *             mints. groupSongsBySet and songIndex key off it.
 *   name    – song title, trimmed.
 *   set     – one of the canonical labels ('Set I', 'Set II', 'Encore',
 *             'Encore II', …) that groupSongsBySet's CANONICAL_ORDER sorts.
 *   cover   – the covered artist's name, or null.
 *   tape    – "this song ran into the next one". See the long note below.
 *
 * Everything past that is new, optional, and absent on setlist.fm-sourced
 * shows — so a consumer that doesn't know about it is unaffected.
 *
 * ── On `tape`, which does not mean what setlist.fm means by it ────────
 *
 * setlist.fm's `tape` flag means "this was a recording played over the PA,
 * not performed". This codebase has never used it that way. Since the
 * transitions work it has meant "this song segues into the next one":
 * lib/songIndex.js derives `segueOut: !!song.tape` and a song's `segueIn`
 * from the previous song's flag, SetlistView.jsx renders a "> segue" line
 * off `t.tape`, and lib/__tests__/songIndex.test.js asserts exactly that
 * ("a song's segue-out is its own `tape` flag and its segue-in is the
 * previous song's").
 *
 * So `tape` keeps that meaning here — a band source sets it for a real
 * segue and leaves it false for a plain comma. What a band source *adds*
 * is `transitionMark`, the literal mark the archive recorded, so the UI can
 * render the actual '>' or '->' instead of a generic indicator while `tape`
 * goes on carrying the boolean every existing consumer reads.
 *
 * Renaming `tape` to `segue` is the right end state. It is not this change:
 * it touches seven files and every stored show document, and it deserves
 * its own PR rather than riding along inside a data-source migration.
 */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const toRoman = (n) => ROMAN[n - 1] || String(n);

// The label soundcheck rows would get if they were kept. They are not —
// pickSetLabel returns null for them and the adapters drop the row — but
// the constant is exported so the decision is visible in one place and a
// future change of mind has somewhere to land. See SOUNDCHECK_POLICY.
const SOUNDCHECK_LABEL = 'Soundcheck';

/**
 * Soundcheck rows are DROPPED, not stored.
 *
 * Both sources flag soundcheck performances, and they are genuinely
 * interesting data — but they are not part of the show the user attended,
 * and every existing consumer would treat them as if they were. They would
 * inflate a show's song count, add phantom plays to the personal song
 * index, and land in generated playlists. 'Soundcheck' is also not in
 * groupSongsBySet's CANONICAL_ORDER, so it would render as an ordinary
 * trailing section with no indication it wasn't part of the set.
 *
 * Dropping them is the choice that leaves every existing field meaning
 * exactly what it means today. The count is reported on the response as
 * `droppedSoundcheckCount` so the rows are visibly discarded rather than
 * silently lost, and adding them back later is a deliberate act: give
 * SOUNDCHECK_LABEL a place in CANONICAL_ORDER after the encores and teach
 * songIndex/playlistCreator to skip it.
 */
const SOUNDCHECK_POLICY = 'drop';

// Mints the same id shape extractSongsFromSetlist does, for the same
// reason: the stored id is what groupSongsBySet, the setlist editor's
// reorder controls and songIndex's per-song set lookup all key off.
function mintSongId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Maps a source's set type + number onto the app's canonical labels —
 * exactly the labels lib/setlistParser.js's extractSongsFromSetlist
 * produces today, so groupSongsBySet's CANONICAL_ORDER keeps working
 * unchanged.
 *
 * Both sources express structure as a type plus a number rather than as a
 * nested set array, and both count encores separately from regular sets,
 * which is what makes a show with two encores come out as 'Encore' then
 * 'Encore II' rather than 'Encore' then 'Encore 2'.
 *
 * Returns null for a soundcheck row, which the caller drops.
 */
function pickSetLabel(setType, setNumber) {
  const type = String(setType == null ? '' : setType).trim().toLowerCase();
  const n = Number.parseInt(setNumber, 10);
  const num = Number.isFinite(n) && n > 0 ? n : 1;

  if (type.startsWith('soundcheck')) return null;

  if (type.startsWith('encore') || type === 'e') {
    return num === 1 ? 'Encore' : `Encore ${toRoman(num)}`;
  }

  // Anything else is a regular set. Sources spell this 'Set', 'set', '1',
  // or leave it empty; in every one of those cases the set number is what
  // carries the meaning.
  return `Set ${toRoman(num)}`;
}

/**
 * Parses a source's transition mark into the two things the app needs: the
 * literal mark to render, and the boolean every existing consumer reads.
 *
 * A segue is '>' or '->' (and the '->' spelling is preserved rather than
 * collapsed, because the two mean different things to the people who
 * maintain these archives — '>' is a segue, '->' a seamless one). A comma,
 * an empty string, or no mark at all is not a segue.
 */
function parseTransition(raw) {
  const mark = String(raw == null ? '' : raw).trim();
  if (!mark || mark === ',') return { transitionMark: '', tape: false };
  const isSegue = mark.includes('>');
  return { transitionMark: mark, tape: isSegue };
}

// Coerces the 0/1, "0"/"1", true/false and null that these APIs use
// interchangeably for a flag into a real boolean.
function toBool(v) {
  if (v === true) return true;
  if (v === false || v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 't';
}

// Integer-or-null, for gap counts. A gap of 0 is meaningful ("played at the
// previous show"), so it must survive rather than being swallowed by a
// falsy check.
function toIntOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function cleanStr(v) {
  return String(v == null ? '' : v).trim();
}

// Both archives write HTML in their show-level notes — links to other
// shows, <br> between paragraphs. The UI renders those notes as text, so
// React escapes them and the reader sees literal `<a href="...">` markup.
// Stripped to plain text here, at the edge, with block-level tags becoming
// newlines so paragraph breaks survive into the `whitespace-pre-line` block
// that renders them.
function stripHtml(v) {
  return String(v == null ? '' : v)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Builds one normalized song object.
 *
 * `fields` is what the adapter extracted from the upstream row, already
 * named in app terms rather than in the source's terms. Optional fields are
 * omitted entirely when the source has nothing for them, rather than stored
 * as null — a setlist.fm-sourced show has no `footnote` key at all, and a
 * band-sourced song with no footnote should look the same.
 */
function buildSong(fields) {
  const { transitionMark, tape } = parseTransition(fields.transition);

  const song = {
    id: mintSongId(),
    name: cleanStr(fields.name),
    set: fields.set,
    cover: fields.cover ? cleanStr(fields.cover) : null,
    tape,
  };

  if (transitionMark) song.transitionMark = transitionMark;

  const footnote = cleanStr(fields.footnote);
  if (footnote) song.footnote = footnote;

  if (toBool(fields.jamchart)) {
    song.jamchart = true;
    const note = cleanStr(fields.jamchartNote);
    if (note) song.jamchartNote = note;
  }

  const gap = toIntOrNull(fields.gap);
  if (gap != null) song.sourceGap = gap;

  // `debut` is a real number from a real source here, not a regex over
  // setlist.fm's free-text `info` field the way
  // admin-populate-setlist.js's extractSongs has to infer it. A gap of 0 on
  // a song the archive has never seen before is what a debut looks like,
  // and both sources say so explicitly where they know.
  if (fields.debut === true) song.debut = true;

  // NOTE: on elgoose.net this is a per-performance id, not a stable song
  // id — the same song played twice in one show comes back with two
  // different values. `songSlug` is the one that addresses a song page.
  const songId = cleanStr(fields.songId);
  if (songId) song.songId = songId;

  const songSlug = cleanStr(fields.songSlug);
  if (songSlug) song.songSlug = songSlug;

  if (toBool(fields.opener)) song.sourceOpener = true;

  return song;
}

/**
 * Shared tail end of both adapters: take upstream rows already mapped into
 * app-named fields, sort them into performance order, drop soundchecks, and
 * emit the normalized setlist.
 *
 * `rows` is an array of { set, position, name, transition, ... } as
 * buildSong expects, plus a `setSortKey` the adapter supplies so sets order
 * correctly regardless of the order the API returned them in.
 */
function buildSetlist(rows) {
  const kept = [];
  let droppedSoundcheckCount = 0;
  let droppedUntitledCount = 0;

  for (const row of rows) {
    if (row.set == null) {
      droppedSoundcheckCount++;
      continue;
    }
    // ── A song with no title is not a song ─────────────────────────────
    // It is either corrupt upstream data or, far more likely, a
    // mis-transcribed key in the adapter's FIELDS map: get `songName`
    // wrong and every row still carries a valid set, position and gap,
    // so the setlist comes out structurally perfect and entirely
    // nameless.
    //
    // That case has to be caught HERE, because it slips past every guard
    // downstream. The merge rule's "empty incoming writes nothing" rule
    // keys off the array being empty, and this array is full; the titles
    // normalize to '' so nothing matches the existing songs; and the
    // result is a real setlist of blank rows written over a good one,
    // taking the user's ratings and comments with it. Precisely the data
    // loss the merge rules exist to prevent, arriving through the one
    // door they don't watch.
    //
    // Dropping untitled rows closes it by turning a mapping error back
    // into the empty result the merge already refuses to write. Verified
    // against a simulated mis-transcription of `songname`.
    if (!String(row.name == null ? '' : row.name).trim()) {
      droppedUntitledCount++;
      continue;
    }
    kept.push(row);
  }

  kept.sort((a, b) => {
    if (a.setSortKey !== b.setSortKey) return a.setSortKey - b.setSortKey;
    return (a.position || 0) - (b.position || 0);
  });

  return { songs: kept.map(buildSong), droppedSoundcheckCount, droppedUntitledCount };
}

/**
 * Sort key for a set, so 'Set I' < 'Set II' < 'Encore' < 'Encore II'
 * regardless of the numbering scheme the source used. Encores always follow
 * every regular set, which is why they sit in a separate thousand-block
 * rather than continuing the set numbering.
 */
function setSortKey(setType, setNumber) {
  const type = String(setType == null ? '' : setType).trim().toLowerCase();
  const n = Number.parseInt(setNumber, 10);
  const num = Number.isFinite(n) && n > 0 ? n : 1;
  if (type.startsWith('soundcheck')) return -1000;
  if (type.startsWith('encore') || type === 'e') return 1000 + num;
  return num;
}

module.exports = {
  SOUNDCHECK_LABEL,
  cleanStr,
  stripHtml,
  SOUNDCHECK_POLICY,
  buildSetlist,
  buildSong,
  mintSongId,
  parseTransition,
  pickSetLabel,
  setSortKey,
  toBool,
  toIntOrNull,
  toRoman,
};
