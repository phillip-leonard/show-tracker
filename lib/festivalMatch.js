// lib/festivalMatch.js
//
// "Is this the festival someone already created?" — the one match rule for
// the shared festival catalog, defined the same way the run rule is (named
// constants at the top, one exported predicate, pure functions, unit
// tested). Used in three places and nowhere else:
//
//   1. The create form (components/festivals/FestivalFormModal.jsx), which
//      surfaces matches inline before writing anything.
//   2. context/AppContext.jsx's findFestivalMatches, which fetches the
//      bounded candidate set and runs this over it.
//   3. netlify/functions/admin-migrate-festivals.js, which groups existing
//      per-user festivals by the same rule. That function re-implements
//      these functions rather than importing them — it's CommonJS running
//      under firebase-admin, with no build step to resolve `@/lib` — and
//      says so at the top. Change one, change both.
//
// FESTIVAL IDENTITY, in order of how hard we guard it:
//
//   Year/edition is identity. Bonnaroo 2025 and Bonnaroo 2026 are
//   different festivals and must NEVER match, even though their names are
//   100% identical. This is the mistake to guard hardest against, so the
//   date test is a hard gate: no amount of name similarity can produce a
//   match across editions.
//
//   Name similarity is the second gate, and it is deliberately fuzzy:
//   "Bonnaroo", "Bonnaroo 2026", "The Bonnaroo Music & Arts Festival" all
//   normalize toward the same thing, because a trailing year, a leading
//   article and punctuation are noise once the dates already pin the
//   edition.
//
//   Location is a TIEBREAKER, never an equality test. A festival with a
//   Chicago and a Berlin edition on overlapping dates is two festivals,
//   but a user who left the location blank must still match one that has
//   it filled in. So a differing city lowers a candidate's rank and is
//   shown to the user to choose from — it never rejects a candidate on its
//   own.

// Two festivals match on dates when their windows overlap, or when their
// start dates are within this many days of each other. A festival whose
// dates a creator typed slightly wrong ("June 11-14" vs "June 12-15") is
// still the same festival; one a year apart never is.
export const MAX_START_DATE_GAP_DAYS = 3;

// Minimum token-overlap similarity (Jaccard: shared tokens / total
// distinct tokens) between two normalized names for them to be candidates.
// 0.6 keeps "bonnaroo music arts festival" matched to "bonnaroo" (1 of 4
// distinct tokens is a low Jaccard, so the substring rule below carries
// that case) while keeping "summer camp" apart from "summer solstice".
export const MIN_NAME_SIMILARITY = 0.6;

// Names shorter than this are compared by equality only. Two-character
// names produce meaningless similarity scores.
export const MIN_NAME_LENGTH = 3;

const MS_PER_DAY = 86400000;

// A festival lasts days, not years, and happens in the modern era. Both
// bounds exist because of a real mis-merge in production: a record whose
// startDate had been typed as "0011-08-12" instead of "2011-08-12" parsed
// as year 11 AD, giving it a ~2001-year-wide window that overlapped every
// other festival in the catalog. Its name ("Outside Lands") was contained
// by another edition's ("Outside Lands Music & Arts Festival"), so both
// gates passed and the 2011 record was merged into the 2008 festival —
// precisely the edition collapse the date gate exists to prevent.
//
// A date outside these bounds is a typo, not data. Such a record matches
// NOTHING rather than everything: the worst outcome here is a wrong merge,
// so a record we cannot date confidently is left to stand alone.
export const MAX_FESTIVAL_DAYS = 30;
export const MIN_FESTIVAL_YEAR = 1900;
export const MAX_FESTIVAL_YEAR = 2100;

// Leading articles carry no identity — "The Bonnaroo" is Bonnaroo.
const LEADING_ARTICLES = /^(the|a|an)\s+/;

// A trailing year is the edition, and the edition is already pinned by the
// date gate, so it's stripped from the name rather than compared twice.
// Only a *trailing* year: "1964 Festival" keeps its year, because there the
// year is part of the name itself.
const TRAILING_YEAR = /\s+(19|20)\d{2}$/;

/**
 * Lowercase, strip punctuation and leading articles, collapse whitespace,
 * strip a trailing year. Used for comparison only — every display path
 * shows the name the creator typed.
 */
// Field limits enforced by the `festivals` create/update rules in
// firestore.rules. Exported so the create form can reject an over-long
// name as a form error instead of letting Firestore reject the write —
// a rules denial surfaces as a bare permission error with nothing telling
// the user which field was at fault. Note normalizeFestivalName can make a
// name LONGER (it expands "&" to " and "), so the normalized form is
// checked against its own limit rather than assumed shorter.
export const FESTIVAL_NAME_MAX = 120;

export function festivalNameProblem(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'Give your festival a name.';
  if (trimmed.length > FESTIVAL_NAME_MAX) {
    return `Festival name is too long (${trimmed.length} characters, max ${FESTIVAL_NAME_MAX}).`;
  }
  if (normalizeFestivalName(trimmed).length > FESTIVAL_NAME_MAX) {
    return 'Festival name is too long once punctuation is expanded — try shortening it.';
  }
  return '';
}

export function normalizeFestivalName(name) {
  let out = String(name || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  out = out.replace(LEADING_ARTICLES, '');
  out = out.replace(TRAILING_YEAR, '').trim();
  return out;
}

function tokens(normalized) {
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

/**
 * Token-overlap (Jaccard) similarity of two normalized names, 0..1. Chosen
 * over edit distance because festival names differ by whole words —
 * "Bonnaroo" vs "Bonnaroo Music and Arts Festival" — far more often than
 * by typo'd characters, and edit distance scores that pair terribly.
 */
export function nameSimilarity(a, b) {
  const ta = new Set(tokens(normalizeFestivalName(a)));
  const tb = new Set(tokens(normalizeFestivalName(b)));
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  ta.forEach(t => { if (tb.has(t)) shared++; });
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * True when two names are close enough to be the same festival. Equality
 * or containment first (one name being a prefix of the other is the
 * "Bonnaroo" / "Bonnaroo Music and Arts Festival" case, which token
 * overlap alone scores too low), then the similarity threshold.
 */
export function namesAreClose(a, b) {
  const na = normalizeFestivalName(a);
  const nb = normalizeFestivalName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length < MIN_NAME_LENGTH || nb.length < MIN_NAME_LENGTH) return false;

  // Whole-token containment, not raw substring: "roo" must not match
  // "bonnaroo", but "bonnaroo" must match "bonnaroo music and arts".
  const ta = tokens(na);
  const tb = tokens(nb);
  const shorter = ta.length <= tb.length ? ta : tb;
  const longerSet = new Set(ta.length <= tb.length ? tb : ta);
  if (shorter.every(t => longerSet.has(t))) return true;

  return nameSimilarity(a, b) >= MIN_NAME_SIMILARITY;
}

// Parses yyyy-MM-dd as a UTC day. UTC on purpose: every comparison here is
// whole-day arithmetic, and a local-time parse shifts a day either side of
// a month or year boundary depending on the viewer's timezone. Returns
// null for anything that isn't a well-formed date, so a malformed record
// fails the date gate rather than matching everything.
function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  // The regex happily accepts "0011-08-12" — four digits is four digits —
  // so the year has to be range-checked separately.
  const year = Number(value.slice(0, 4));
  if (year < MIN_FESTIVAL_YEAR || year > MAX_FESTIVAL_YEAR) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function windowOf(festival) {
  const start = parseDay(festival?.startDate);
  if (start === null) return null;
  const end = parseDay(festival?.endDate);
  // A single-day festival (start === end) and one with a missing end date
  // both collapse to a one-day window. An end before the start is
  // malformed; treat it as one day rather than an inverted window that
  // overlaps nothing.
  if (end === null || end < start) return { start, end: start };
  // Both dates parsed, but no festival runs for a month. A span this wide
  // is a mistyped year, and honouring it would let one bad record overlap
  // and absorb unrelated editions.
  if (end - start > MAX_FESTIVAL_DAYS * MS_PER_DAY) return null;
  return { start, end };
}

/**
 * True when two festivals' date windows overlap, or their starts are
 * within MAX_START_DATE_GAP_DAYS. This is the hard gate on edition
 * identity — two editions a year apart fail it no matter what their names
 * say. Correct across month and year boundaries because both sides are
 * whole UTC days.
 */
export function datesAreClose(a, b) {
  const wa = windowOf(a);
  const wb = windowOf(b);
  if (!wa || !wb) return false;

  const overlaps = wa.start <= wb.end && wb.start <= wa.end;
  if (overlaps) return true;

  return Math.abs(wa.start - wb.start) <= MAX_START_DATE_GAP_DAYS * MS_PER_DAY;
}

/**
 * A festival's year: from its start date when it has readable dates,
 * otherwise from `year`, which a festival added without exact dates
 * carries instead (5.58.0). null when neither is usable.
 */
export function festivalYear(festival) {
  const w = windowOf(festival);
  if (w) return new Date(w.start).getUTCFullYear();
  const y = festival?.year;
  return Number.isInteger(y) && y >= MIN_FESTIVAL_YEAR && y <= MAX_FESTIVAL_YEAR ? y : null;
}

/**
 * True when a festival has a year but no readable dates: added with only
 * the year known.
 */
export function isYearOnly(festival) {
  return !windowOf(festival) && festivalYear(festival) !== null;
}

/**
 * The date gate for a festival with only a year. When either side has no
 * dates, the same year is as close as the two can be compared, so the
 * year is the gate: Bonnaroo 2025 still never matches Bonnaroo 2026. When
 * both sides have dates, datesAreClose decides and this is false, so a
 * festival with dates is never matched more loosely than before.
 *
 * A year-only festival matches every edition in its year, which means
 * both Coachella weekends. That's the right answer for a suggestion list:
 * both are shown and the user picks.
 */
export function yearsAgree(a, b) {
  if (windowOf(a) && windowOf(b)) return false;
  const ya = festivalYear(a);
  const yb = festivalYear(b);
  return ya !== null && ya === yb;
}

/**
 * The city out of a free-text location ("Manchester, TN" -> "manchester").
 * Location is a tiebreaker only, so this is deliberately forgiving.
 */
export function normalizeLocation(location) {
  return String(location || '')
    .toLowerCase()
    .split(',')[0]
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Same city, as far as we can tell. A blank location on either side is
 * "unknown", not "different" — it must never be the thing that splits two
 * records of the same festival.
 */
export function locationsAgree(a, b) {
  const la = normalizeLocation(a);
  const lb = normalizeLocation(b);
  if (!la || !lb) return true;
  return la === lb || la.includes(lb) || lb.includes(la);
}

/**
 * THE match rule. Both gates must pass: names close AND dates close (or,
 * when either side was added with only a year, the same year). Location
 * never gates — see the header comment.
 */
export function festivalsMatch(a, b) {
  if (!a || !b) return false;
  return namesAreClose(a.name, b.name) && (datesAreClose(a, b) || yearsAgree(a, b));
}

/**
 * Every candidate in `catalog` that matches `draft`, best first.
 *
 * Ranking exists for one reason: when two candidates tie on name and dates
 * and differ on city (a festival with a Chicago and a Berlin edition), the
 * caller shows both and lets the user choose — so the one whose city
 * agrees is listed first, and neither is hidden.
 */
export function findFestivalMatches(draft, catalog = []) {
  return catalog
    .filter(candidate => festivalsMatch(draft, candidate))
    .map(candidate => ({
      festival: candidate,
      similarity: nameSimilarity(draft.name, candidate.name),
      sameLocation: locationsAgree(draft.location, candidate.location),
    }))
    .sort((x, y) =>
      (y.sameLocation === x.sameLocation ? 0 : y.sameLocation ? 1 : -1) ||
      y.similarity - x.similarity ||
      String(x.festival.name).localeCompare(String(y.festival.name))
    );
}
