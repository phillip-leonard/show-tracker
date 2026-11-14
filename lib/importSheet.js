// lib/importSheet.js
//
// Reading a spreadsheet of shows someone kept or exported themselves —
// a Concert Archives export, a Google Sheet, an old Excel file — into rows
// the import can preview. Pure: no network, no React, no Firebase, so the
// whole of it is covered by lib/__tests__/importSheet.test.js.
//
// Nothing here knows about any one app's export format. Columns are found
// by their headers (detectColumns) and the user can fix any of them, so a
// file from anywhere works as long as it has an artist and a date.
//
// The parts that need the network — which setlist a row gets — live in
// lib/importMatch.js; components/ImportView.jsx puts the two together.

// ── Columns ───────────────────────────────────────────────────────────

export const IMPORT_COLUMNS = [
  { key: 'artist', label: 'Artist', required: true },
  { key: 'date', label: 'Date', required: true },
  { key: 'venue', label: 'Venue', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'state', label: 'State', required: false },
  { key: 'country', label: 'Country', required: false },
  { key: 'rating', label: 'Rating', required: false },
  { key: 'comment', label: 'Notes', required: false },
  { key: 'tour', label: 'Tour / festival', required: false },
];

// Header spellings, compared after lowercasing and squeezing out
// punctuation ("Artist(s)" -> "artists", "Show Date" -> "show date").
const HEADER_PATTERNS = {
  artist: /^(?:artists?|bands?|performers?|acts?|headliners?|line ?up|musicians?|groups?|(?:band|artist|performer) names?|who)$/,
  date: /^(?:dates?|(?:show|event|concert|gig|performance) dates?|date (?:attended|of (?:show|concert|event))|when|day)$/,
  venue: /^(?:venues?|venue names?|place|hall|club|theat(?:er|re)|arena|location|where)$/,
  city: /^(?:city|town|venue city|location city)$/,
  state: /^(?:state|province|region|st|state province|venue state)$/,
  country: /^(?:country|nation|venue country)$/,
  rating: /^(?:rating|my rating|score|stars|rank)$/,
  comment: /^(?:notes?|comments?|my notes|review|thoughts|memo|description|memories)$/,
  tour: /^(?:tour|tour names?|festival|festival names?|event|event names?)$/,
};

function headerKey(header) {
  return String(header == null ? '' : header)
    .toLowerCase()
    .replace(/[()[\]{}]/g, '')
    .replace(/[_\-./:#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * detectColumns(headers) -> { artist: 0, date: 2, … }
 *
 * The column index for each field whose header is recognised. A header
 * is used for one field at most, and the first matching column wins.
 */
export function detectColumns(headers) {
  const mapping = {};
  const used = new Set();
  const keys = (headers || []).map(headerKey);
  for (const field of IMPORT_COLUMNS.map((c) => c.key)) {
    const index = keys.findIndex((k, i) => !used.has(i) && HEADER_PATTERNS[field].test(k));
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}

// The same file's columns are remembered for the session, keyed by its
// header row, so importing a second export of the same kind skips the fix-up.
export function headerSignature(headers) {
  return (headers || []).map(headerKey).join('|');
}

// ── Dates ─────────────────────────────────────────────────────────────
//
// The parser for dates people type or paste lives in lib/showDate.js with
// every other date rule (5.59.10); re-exported here under the names this
// module's callers and tests already use.
import { parseEnteredDate as parseShowDate, inferDateOrder } from '@/lib/showDate';

export { parseShowDate, inferDateOrder };

// ── Artists ───────────────────────────────────────────────────────────

/**
 * splitArtists(cell) -> ['Phish', 'Goose', …]
 *
 * A festival or a bill in one cell ("Phish; Goose", "Phish / Goose",
 * "Billy Strings, Greensky Bluegrass"). Commas and "&" are inside plenty of
 * band names ("Crosby, Stills, Nash & Young"), so this only ever OFFERS a
 * split: the row stays one show until the user says otherwise. "&" is
 * never split on.
 */
export function splitArtists(cell) {
  const parts = String(cell == null ? '' : cell)
    .split(/\s*(?:\n|;|\||\s\/\s|\s\+\s|,\s*|\sw\/\s)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [];
}

// One key for "the same act", for duplicate checks: case, accents, a
// leading "The", "&"/"and" and punctuation don't make a different band.
export function artistKey(name) {
  return String(name == null ? '' : name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^\s*the\s+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function showKey(artist, isoDate) {
  return `${artistKey(artist)}|${isoDate || ''}`;
}

// ── Ratings ───────────────────────────────────────────────────────────

/**
 * parseRating(value) -> 1–10, or null.
 *
 * The app rates out of 10. "8", "8/10" and "4/5" (8) are read; so are
 * star characters ("★★★★☆" is 8). Anything else is left out of the import
 * rather than blocking the row.
 */
export function parseRating(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return null;
  const stars = (s.match(/★/g) || []).length;
  if (stars && /^[★☆\s]+$/.test(s)) return Math.min(10, stars * 2);
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+)$/);
  const n = frac ? (Number(frac[1]) / Number(frac[2])) * 10 : Number(s);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return Math.round(n);
}

// ── Rows ──────────────────────────────────────────────────────────────

function cell(row, index) {
  if (index === undefined || index === '' || index === null) return '';
  const v = row[Number(index)];
  return v == null ? '' : (v instanceof Date ? v : String(v).trim());
}

/**
 * buildRows(dataRows, mapping, { order, existingShows }) -> rows
 *
 * One entry per data row of the file, in file order:
 *   { index, cells, artist, artists, date, venue, city, state, country,
 *     rating, comment, tour, problems: [string], duplicate: null |
 *     'existing' | 'file' }
 *
 * `problems` is why the row can't be imported as it stands (no artist, no
 * date it can read). `duplicate` is set when the artist and date match a
 * show already logged ('existing') or an earlier row of this file
 * ('file'); those rows are never imported. For a row that lists several
 * artists the check is per artist, at import time (see expandRow).
 */
export function buildRows(dataRows, mapping, { order = 'mdy', existingShows = [] } = {}) {
  const existing = new Set((existingShows || []).map((s) => showKey(s.artist, s.date)));
  const seen = new Set();
  return (dataRows || []).map((cells, index) => {
    const artist = String(cell(cells, mapping.artist) || '');
    const rawDate = cell(cells, mapping.date);
    const date = parseShowDate(rawDate, { order });
    const problems = [];
    if (!artist) problems.push('No artist');
    if (rawDate === '') problems.push('No date');
    else if (!date.iso) problems.push(`Can't read the date "${String(rawDate).slice(0, 30)}"`);

    let duplicate = null;
    if (!problems.length) {
      const key = showKey(artist, date.iso);
      if (existing.has(key)) duplicate = 'existing';
      else if (seen.has(key)) duplicate = 'file';
      seen.add(key);
    }

    return {
      index,
      cells,
      rawDate: rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : String(rawDate),
      artist,
      artists: splitArtists(artist),
      date,
      venue: String(cell(cells, mapping.venue)),
      city: String(cell(cells, mapping.city)),
      state: String(cell(cells, mapping.state)),
      country: String(cell(cells, mapping.country)),
      rating: parseRating(cell(cells, mapping.rating)),
      comment: String(cell(cells, mapping.comment)),
      tour: String(cell(cells, mapping.tour)),
      problems,
      duplicate,
    };
  });
}

/**
 * expandRow(row, { split }) -> one show per act
 *
 * The shows a row becomes: one, or one per artist when the user chose to
 * split it. Each gets its own key for the duplicate check.
 */
export function expandRow(row, { split = false } = {}) {
  const names = split && row.artists.length > 1 ? row.artists : [row.artist];
  return names.map((artist, part) => ({
    rowIndex: row.index,
    part,
    key: showKey(artist, row.date.iso),
    artist,
    date: row.date.iso,
    venue: row.venue,
    city: row.city,
    state: row.state,
    country: row.country,
    rating: row.rating,
    comment: row.comment,
    tour: row.tour,
  }));
}

// ── The result ────────────────────────────────────────────────────────

/**
 * summaryLine({ imported, withSetlists, toReview, duplicates, unmatched, leftOut, cancelled })
 *   -> "Imported 212 shows; 180 with setlists; 9 skipped as duplicates; 23 not matched"
 */
export function summaryLine({ imported = 0, withSetlists = 0, toReview = 0, duplicates = 0, unmatched = 0, leftOut = 0, cancelled = false } = {}) {
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts = [`Imported ${plural(imported, 'show')}`, `${withSetlists} with setlists`];
  if (toReview) parts.push(`${plural(toReview, 'tape setlist')} to review`);
  parts.push(`${duplicates} skipped as duplicates`, `${unmatched} not matched`);
  if (leftOut) parts.push(`${leftOut} left out by you`);
  return `${parts.join('; ')}${cancelled ? ' (stopped early)' : ''}`;
}

function csvCell(value) {
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value == null ? '' : value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * unmatchedCsv(headers, rows) -> CSV text: the file's own columns for
 * each row that wasn't imported, plus a "Why not imported" column, so the
 * user can fix them and import that file again.
 */
export function unmatchedCsv(headers, rows) {
  const lines = [[...(headers || []), 'Why not imported'].map(csvCell).join(',')];
  for (const { cells, reason } of rows || []) {
    const padded = (headers || []).map((_, i) => (cells || [])[i]);
    lines.push([...padded, reason].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * showDataFor(show, match) -> the showData handed to addShow, or
 *   { skip: reason } when the show can't be saved.
 *
 * The file's own venue, city and tour win; setlist.fm fills what the file
 * left empty. The artist takes setlist.fm's spelling when it found the
 * artist ("the grateful dead" -> "Grateful Dead"). A show needs a venue,
 * from the file or from setlist.fm.
 */
export function showDataFor(show, match = {}) {
  const venue = show.venue || match.venue || '';
  if (!venue) return { skip: "No venue in the file, and setlist.fm doesn't have this show to take one from" };
  const data = {
    artist: (match.status !== 'unknown-artist' && match.artist) || show.artist,
    venue,
    date: show.date,
    city: show.city || match.city || '',
    state: show.state || match.state || '',
    country: show.country || match.country || '',
    rating: show.rating || null,
    comment: show.comment || '',
    tour: show.tour || match.tour || '',
    setlist: match.setlist || [],
  };
  if (match.setlist) {
    data.setlistSource = match.setlistSource || 'setlistfm';
    if (match.setlistfmId) data.setlistfmId = match.setlistfmId;
    if (match.setlistfmUrl) data.setlistfmUrl = match.setlistfmUrl;
    if (match.sourceFields) Object.assign(data, match.sourceFields);
  }
  if (match.proposal) data.setlistProposal = match.proposal;
  return data;
}

/**
 * planShows(rows, { split, existingKeys }) -> every show the file would
 * become, in file order.
 *
 * Each is expandRow's show plus `row`, and either `problem` (the row can't
 * be imported: no artist, unreadable date) or `duplicate` (why it's
 * skipped). The duplicate check runs per act, so a split festival row's
 * bands are checked one by one, against `existingKeys` (showKey of every
 * show already logged) and against earlier rows of the file.
 */
export function planShows(rows, { split = new Set(), existingKeys = new Set() } = {}) {
  const seen = new Map();
  const out = [];
  for (const row of rows) {
    if (row.problems.length) {
      out.push({ rowIndex: row.index, part: 0, key: '', row, artist: row.artist, problem: row.problems.join('; '), duplicate: null });
      continue;
    }
    for (const s of expandRow(row, { split: split.has(row.index) })) {
      let duplicate = null;
      if (existingKeys.has(s.key)) duplicate = 'Already in your shows';
      else if (seen.has(s.key)) duplicate = `Same as row ${seen.get(s.key) + 2}`;
      else seen.set(s.key, row.index);
      out.push({ ...s, row, problem: '', duplicate });
    }
  }
  return out;
}
