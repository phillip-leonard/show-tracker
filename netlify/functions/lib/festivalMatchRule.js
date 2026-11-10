/**
 * festivalMatchRule — the shared-festival match rule, in CommonJS, for
 * Netlify functions.
 *
 * WHY THIS FILE EXISTS. lib/festivalMatch.js is the rule, but it is an ESM
 * module written against the app's `@/lib` alias; a Netlify function is
 * CommonJS running under firebase-admin with no build step to resolve that
 * alias. Until now each function that needed the rule re-implemented it
 * inline, and admin-migrate-festivals.js and admin-repair-festival-split.js
 * still carry those ports with "keep in step" comments on them.
 *
 * That worked, but it scales badly: the mis-merge those two exist to fix
 * came down to one missing bound, and a fix had to be applied by hand to
 * every copy. Rather than add a fourth copy for admin-merge-festivals.js,
 * this is one shared module — the same arrangement three public-page
 * functions already use for netlify/functions/lib/publicPageHtml.js.
 *
 * NEW FUNCTIONS SHOULD REQUIRE THIS, not re-port the rule. The two existing
 * ports are deliberately left alone: they are shipped, working code, and
 * rewriting them is a bigger change than the one that introduced this file.
 * lib/__tests__/festivalMatchParity.test.js asserts that this module and
 * lib/festivalMatch.js agree, so the two definitions cannot drift silently.
 *
 * The semantics are documented in full in lib/festivalMatch.js; the short
 * version is that both gates must pass — names close AND dates close — that
 * year/edition is identity and the date gate is therefore hard, and that
 * location is a tiebreaker rather than an equality test.
 */

const MS_PER_DAY = 86400000;

const MAX_START_DATE_GAP_DAYS = 3;
const MIN_NAME_SIMILARITY = 0.6;
const MIN_NAME_LENGTH = 3;
const MAX_FESTIVAL_DAYS = 30;
const MIN_FESTIVAL_YEAR = 1900;
const MAX_FESTIVAL_YEAR = 2100;
const FESTIVAL_NAME_MAX = 120;

const LEADING_ARTICLES = /^(the|a|an)\s+/;
const TRAILING_YEAR = /\s+(19|20)\d{2}$/;

function normalizeFestivalName(name) {
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

function nameSimilarity(a, b) {
  const ta = new Set(tokens(normalizeFestivalName(a)));
  const tb = new Set(tokens(normalizeFestivalName(b)));
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  ta.forEach(t => { if (tb.has(t)) shared++; });
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

function namesAreClose(a, b) {
  const na = normalizeFestivalName(a);
  const nb = normalizeFestivalName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length < MIN_NAME_LENGTH || nb.length < MIN_NAME_LENGTH) return false;

  const ta = tokens(na);
  const tb = tokens(nb);
  const shorter = ta.length <= tb.length ? ta : tb;
  const longerSet = new Set(ta.length <= tb.length ? tb : ta);
  if (shorter.every(t => longerSet.has(t))) return true;

  return nameSimilarity(a, b) >= MIN_NAME_SIMILARITY;
}

// yyyy-MM-dd as a UTC day, or null. The regex accepts "0011-08-12" — four
// digits is four digits — so the year is range-checked separately. This is
// the bound whose absence let a mistyped year absorb unrelated editions.
function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const year = Number(String(value).slice(0, 4));
  if (year < MIN_FESTIVAL_YEAR || year > MAX_FESTIVAL_YEAR) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function windowOf(festival) {
  const start = parseDay(festival && festival.startDate);
  if (start === null) return null;
  const end = parseDay(festival && festival.endDate);
  if (end === null || end < start) return { start, end: start };
  if (end - start > MAX_FESTIVAL_DAYS * MS_PER_DAY) return null;
  return { start, end };
}

function datesAreClose(a, b) {
  const wa = windowOf(a);
  const wb = windowOf(b);
  if (!wa || !wb) return false;

  const overlaps = wa.start <= wb.end && wb.start <= wa.end;
  if (overlaps) return true;

  return Math.abs(wa.start - wb.start) <= MAX_START_DATE_GAP_DAYS * MS_PER_DAY;
}

// A festival added with only a year (5.58.0) has `year` and no dates. See
// lib/festivalMatch.js for why the year is its date gate.
function festivalYear(festival) {
  const w = windowOf(festival);
  if (w) return new Date(w.start).getUTCFullYear();
  const y = festival && festival.year;
  return Number.isInteger(y) && y >= MIN_FESTIVAL_YEAR && y <= MAX_FESTIVAL_YEAR ? y : null;
}

function isYearOnly(festival) {
  return !windowOf(festival) && festivalYear(festival) !== null;
}

function yearsAgree(a, b) {
  if (windowOf(a) && windowOf(b)) return false;
  const ya = festivalYear(a);
  const yb = festivalYear(b);
  return ya !== null && ya === yb;
}

function normalizeLocation(location) {
  return String(location || '')
    .toLowerCase()
    .split(',')[0]
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function locationsAgree(a, b) {
  const la = normalizeLocation(a);
  const lb = normalizeLocation(b);
  if (!la || !lb) return true;
  return la === lb || la.includes(lb) || lb.includes(la);
}

function festivalsMatch(a, b) {
  if (!a || !b) return false;
  return namesAreClose(a.name, b.name) && (datesAreClose(a, b) || yearsAgree(a, b));
}

/**
 * A festival's start as a UTC millisecond value, or null when its start
 * date is not a plausible date.
 *
 * Not part of the match rule. admin-merge-festivals.js uses it to measure
 * how far apart two festivals start, which is how it tells "the same
 * edition, with one of the dates typed badly" from "two different years of
 * the same festival" when deciding what an admin may override.
 *
 * Measured in days rather than by comparing calendar years on purpose: a
 * festival running 30 Dec to 2 Jan starts in a different year from a
 * duplicate recorded as starting 1 Jan, and a year-label comparison would
 * call that an edition collapse and refuse it. Two days apart is two days
 * apart whichever side of New Year it falls.
 */
function festivalStartMs(festival) {
  return parseDay(festival && festival.startDate);
}

/**
 * Whole days between two festivals' start dates, or null when either date
 * is unreadable.
 */
function startGapDays(a, b) {
  const ma = festivalStartMs(a);
  const mb = festivalStartMs(b);
  if (ma === null || mb === null) return null;
  return Math.abs(ma - mb) / MS_PER_DAY;
}

module.exports = {
  MS_PER_DAY,
  MAX_START_DATE_GAP_DAYS,
  MIN_NAME_SIMILARITY,
  MIN_NAME_LENGTH,
  MAX_FESTIVAL_DAYS,
  MIN_FESTIVAL_YEAR,
  MAX_FESTIVAL_YEAR,
  FESTIVAL_NAME_MAX,
  normalizeFestivalName,
  nameSimilarity,
  namesAreClose,
  datesAreClose,
  festivalYear,
  isYearOnly,
  yearsAgree,
  normalizeLocation,
  locationsAgree,
  festivalsMatch,
  festivalStartMs,
  startGapDays,
};
