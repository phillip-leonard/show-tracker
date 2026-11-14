/**
 * showDate — every rule about a show's date, in one place (5.59.10).
 *
 * THE CANONICAL STORED FORMAT IS ISO "YYYY-MM-DD", a calendar day with no
 * time and no time zone. setlist.fm returns "DD-MM-YYYY" (converted where
 * its results come in, lib/setlistSearch.js); the band-native sources
 * (Songfish sites, phish.net) and the Internet Archive already use ISO.
 *
 * READERS ACCEPT EVERY LEGACY FORMAT. Older iOS builds and older documents
 * stay readable:
 *   - "YYYY-MM-DD" (and unpadded "YYYY-M-D", or with a time after it,
 *     whose date part is taken literally, never shifted by a time zone)
 *   - "DD-MM-YYYY": the ticket scanner stored setlist.fm's eventDate
 *     verbatim until it began normalizing. A two-two-four date is always
 *     read day-first, as parseDate always has: no stored show uses
 *     MM-DD-YYYY (audit, 2026-11-13), and scripts/normalize-show-dates.js
 *     confirms each one that could be read either way against setlist.fm.
 *   - a Date, or a Firestore Timestamp (anything with toDate()), read on
 *     the device's own calendar.
 * Anything else is unreadable: no `new Date(string)` guessing, whose
 * answer depends on the browser and the time zone.
 *
 * WRITERS WRITE ISO ONLY, through toIsoDate() (buildShowDoc and every
 * update that changes a date).
 *
 * "TODAY" IS THE DEVICE'S LOCAL CALENDAR DAY (today()), never
 * new Date().toISOString().slice(0, 10): that is the UTC date, which on a
 * US evening is already tomorrow (B-02).
 *
 * Dates people TYPE or PASTE (the import, the admin bulk import) go through
 * parseEnteredDate(), which understands month names, slashes, Excel serial
 * numbers and day-first or month-first numeric dates, and says when a date
 * could be read either way.
 *
 * No imports: scripts/normalize-show-dates.mjs loads this file directly.
 */

const pad = (n) => String(n).padStart(2, '0');

// A real calendar day, or null. Built without Date's time-zone handling.
function isoOf(year, month, day) {
  const y = fullYear(year);
  const m = Number(month);
  const d = Number(day);
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return null;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function fullYear(y) {
  const n = Number(y);
  if (String(y).length <= 2) return n + (n < 50 ? 2000 : 1900);
  return n;
}

// ── Stored dates ──────────────────────────────────────────────────────

/** 'YYYY-MM-DD' for any stored show date, or '' when it can't be read. */
export function toIsoDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()) || value.getTime() === 0) return '';
    return isoOf(value.getFullYear(), value.getMonth() + 1, value.getDate()) || '';
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') return toIsoDate(value.toDate());
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return isoOf(m[1], m[2], m[3]) || '';
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return isoOf(m[3], m[2], m[1]) || '';
  return '';
}

/**
 * Which legacy shape a stored value has: 'iso', 'dd-mm-yyyy',
 * 'ambiguous' (NN-NN-YYYY that is a different day read the other way),
 * 'other' or 'missing'. For the migration script and its report.
 */
export function storedDateShape(value) {
  if (value == null || value === '') return 'missing';
  if (typeof value === 'object' && typeof value.toDate === 'function') return 'timestamp';
  if (typeof value !== 'string') return 'other';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'iso';
  const m = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a !== b && a <= 12 && b <= 12) return 'ambiguous';
    return 'dd-mm-yyyy';
  }
  return toIsoDate(value) ? 'iso-variant' : 'other';
}

/**
 * The show's day as a local-midnight Date, or new Date(0) when it can't be
 * read. The long-standing contract of lib/utils.js parseDate, kept so the
 * ~70 callers that sort or measure with it are unchanged.
 */
export function parseDate(value) {
  const iso = toIsoDate(value);
  if (!iso) return new Date(0);
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The show's date for display, in the device's locale; the raw text when unreadable. */
export function formatDate(value, options) {
  const iso = toIsoDate(value);
  if (!iso) return value == null ? '' : String(value);
  return parseDate(iso).toLocaleDateString(undefined, options);
}

/** 'YYYY', or '' when the date can't be read. */
export function showYear(value) {
  return toIsoDate(value).slice(0, 4);
}

/** 'MM-DD', for "on this day" matching, or ''. */
export function monthDay(value) {
  return toIsoDate(value).slice(5, 10);
}

/**
 * Sort comparator on calendar day, oldest first. Unreadable dates sort
 * after readable ones. Use (a, b) => compareShowDates(b.date, a.date) for
 * newest first.
 */
export function compareShowDates(a, b) {
  const x = toIsoDate(a);
  const y = toIsoDate(b);
  if (x === y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x < y ? -1 : 1;
}

/** True when both values are the same calendar day (and readable). */
export function sameShowDate(a, b) {
  const x = toIsoDate(a);
  return !!x && x === toIsoDate(b);
}

// ── Today ─────────────────────────────────────────────────────────────

/** Today on the device's own calendar, 'YYYY-MM-DD'. */
export function today(now = new Date()) {
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** What a new show's date field starts as: today, locally. */
export function defaultShowDate(now = new Date()) {
  return today(now);
}

/** The show is on a day after today. */
export function isUpcoming(value, now = new Date()) {
  const iso = toIsoDate(value);
  return !!iso && iso > today(now);
}

/** The show was on a day before today. */
export function isPast(value, now = new Date()) {
  const iso = toIsoDate(value);
  return !!iso && iso < today(now);
}

/** Whole days from a to b (b later → positive), by calendar day. NaN when either is unreadable. */
export function daysBetweenDates(a, b) {
  const x = toIsoDate(a);
  const y = toIsoDate(b);
  if (!x || !y) return NaN;
  const ms = (iso) => { const [yy, mm, dd] = iso.split('-').map(Number); return Date.UTC(yy, mm - 1, dd); };
  return Math.round((ms(y) - ms(x)) / 86400000);
}

/** Calendar date of a Date or Timestamp, read in UTC (for server-written instants). */
export function utcIsoDate(value) {
  const d = value && typeof value.toDate === 'function' ? value.toDate()
    : typeof value?.seconds === 'number' ? new Date(value.seconds * 1000)
      : value instanceof Date ? value : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) || '';
}

/** A local Date's calendar day, for date pickers and query windows. */
export function localDateIso(d) {
  return d instanceof Date && !Number.isNaN(d.getTime()) ? (isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()) || '') : '';
}

/** setlist.fm's "DD-MM-YYYY" eventDate → ISO, or ''. */
export function fromSetlistfmDate(eventDate) {
  const m = String(eventDate || '').match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return m ? (isoOf(m[3], m[2], m[1]) || '') : '';
}

// ── Dates people type or paste ────────────────────────────────────────

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function monthNumber(word) {
  return MONTHS[String(word || '').toLowerCase().replace(/\.$/, '')] || 0;
}

/**
 * parseEnteredDate(value, { order }) -> {
 *   iso,           // 'YYYY-MM-DD', or null when it can't be read
 *   ambiguous,     // true for 03/04/2019: March 4 or 3 April
 *   alternatives,  // both readings when ambiguous, [mdy, dmy]
 * }
 *
 * Accepts ISO dates (with or without a time), numeric dates with /, - or .
 * in either order, month names ("Jun 3, 2019", "3 June 2019", "June 3rd,
 * 2019", "Sat, Jun 3 2019", "3-Jun-19"), Excel serial day numbers and Date
 * objects. `order` ('mdy' or 'dmy') reads an ambiguous numeric date; the
 * result still says it was ambiguous, so the user can be asked.
 *
 * Every branch builds the day from its parts, never through
 * Date.toISOString(), so no time zone can move it (B-09).
 */
export function parseEnteredDate(value, { order = 'mdy' } = {}) {
  const none = { iso: null, ambiguous: false, alternatives: [] };
  if (value == null || value === '') return none;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return none;
    return { ...none, iso: isoOf(value.getFullYear(), value.getMonth() + 1, value.getDate()) };
  }

  const s = String(value).trim().replace(/\s+/g, ' ');
  if (!s) return none;

  // Excel's day number (days since 1899-12-30), as a cell read without
  // date formatting gives it.
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return { ...none, iso: isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) };
    }
    return none;
  }

  // YYYY-MM-DD, YYYY/MM/DD, with an optional time after it.
  const ymd = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
  if (ymd) return { ...none, iso: isoOf(ymd[1], ymd[2], ymd[3]) };

  // 03/04/2019, 3-4-19, 03.04.2019
  const num = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (num) {
    const [a, b] = [Number(num[1]), Number(num[2])];
    const mdy = isoOf(num[3], a, b);
    const dmy = isoOf(num[3], b, a);
    if (mdy && dmy && a !== b) {
      return { iso: order === 'dmy' ? dmy : mdy, ambiguous: true, alternatives: [mdy, dmy] };
    }
    return { ...none, iso: mdy || dmy };
  }

  // Month names. A weekday in front ("Saturday, June 3, 2019") is dropped.
  const t = s.replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '').replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1');
  // June 3, 2019 / Jun 3 2019 / Jun-03-2019
  let m = t.match(/^([a-z]{3,9}\.?)[\s-](\d{1,2}),?[\s-](\d{2}|\d{4})$/i);
  if (m && monthNumber(m[1])) return { ...none, iso: isoOf(m[3], monthNumber(m[1]), m[2]) };
  // 3 June 2019 / 3-Jun-19 / 3 Jun, 2019
  m = t.match(/^(\d{1,2})[\s-]([a-z]{3,9}\.?),?[\s-](\d{2}|\d{4})$/i);
  if (m && monthNumber(m[2])) return { ...none, iso: isoOf(m[3], monthNumber(m[2]), m[1]) };

  return none;
}

/**
 * inferDateOrder(values) -> 'mdy' | 'dmy'
 *
 * How a file writes numeric dates, from the ones that can only be read
 * one way: 25/12/2019 is day-first, 12/25/2019 is month-first. A file that
 * shows only month-first, or neither, is read month-first.
 */
export function inferDateOrder(values) {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const v of values || []) {
    const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
    if (!m) continue;
    if (Number(m[1]) > 12 && Number(m[2]) <= 12) dayFirst++;
    if (Number(m[2]) > 12 && Number(m[1]) <= 12) monthFirst++;
  }
  return dayFirst > monthFirst ? 'dmy' : 'mdy';
}

/**
 * A typed or pasted date → ISO, month-first when it could be read either
 * way (the admin bulk import's long-standing reading), or null. Replaces
 * lib/utils.js parseImportDate, whose `new Date(s)` fallback converted
 * through toISOString() and saved the day before anywhere east of UTC (B-09).
 */
export function parseImportDate(value) {
  return parseEnteredDate(value, { order: 'mdy' }).iso;
}
