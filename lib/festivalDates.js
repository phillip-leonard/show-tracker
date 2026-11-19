// lib/festivalDates.js
//
// When a festival happened, for festivals with both dates and for
// festivals added with only a year (5.58.0). The year rules themselves
// (festivalYear, isYearOnly, the 1900–2100 bounds) are lib/festivalMatch.js.
//
// CommonJS since 5.60.36 (Stage 5): netlify/functions/festivals.js builds
// festivals with festivalWhenFields, and the native app's copy is checked
// against fixtures/festivals/dates.json. The label formats with the
// device's locale; native formats its own, so the fixture leaves it out.

const { festivalYear, isYearOnly } = require('./festivalMatch');
const { formatDate, showYear, toIsoDate } = require('./showDate');

/** "6/13/2024 – 6/16/2024", "6/13/2024", "2024", or "" when unknown. */
function festivalWhenLabel(festival) {
  if (festival && festival.startDate) {
    const start = formatDate(festival.startDate);
    return festival.endDate && festival.endDate !== festival.startDate
      ? `${start} – ${formatDate(festival.endDate)}`
      : start;
  }
  const year = festivalYear(festival);
  return year ? String(year) : '';
}

/**
 * A key that sorts festivals by when they started, as a yyyy-MM-dd string.
 * A year-only festival sorts as the very start of its year ("2024-00-00"),
 * so newest-first lists show it after that year's dated festivals and
 * before the previous year's.
 */
function festivalSortKey(festival) {
  if (festival && festival.startDate) return festival.startDate;
  const year = festivalYear(festival);
  return year ? `${year}-00-00` : '';
}

/**
 * The last day a festival could have run, yyyy-MM-dd. For a year-only
 * festival that is 31 December, so one in the current year still counts as
 * upcoming: we can't tell, and offering festival picks for a festival that
 * has already happened costs less than hiding them for one that hasn't.
 */
function festivalLastDay(festival) {
  if (festival && festival.startDate) return festival.endDate || festival.startDate;
  const year = festivalYear(festival);
  return year ? `${year}-12-31` : '';
}

/**
 * The date fields a festival is written with, from what the form gave:
 * both dates and their year, or only the year. Returns null when there is
 * neither, or the dates can't be read, which firestore.rules would refuse
 * anyway. An end before the start is null too.
 */
function festivalWhenFields({ startDate, endDate, year } = {}) {
  if (startDate) {
    const start = toIsoDate(startDate);
    const end = endDate ? toIsoDate(endDate) : start;
    if (!start || !end || end < start || start !== startDate || (endDate && end !== endDate)) return null;
    const y = Number(showYear(start));
    if (festivalYear({ year: y }) === null) return null;
    return { startDate: start, endDate: end, year: y };
  }
  const y = Number(year);
  if (Number.isInteger(y) && festivalYear({ year: y }) !== null) return { year: y };
  return null;
}

// A show's date as yyyy-MM-dd. Shows store yyyy-MM-dd; dd-MM-yyyy is
// setlist.fm's format and still turns up on old imports.
function isoShowDate(date) {
  return toIsoDate(date) || String(date || '');
}

/**
 * True when a show's date falls inside the festival: within its dates, or
 * anywhere in its year when it has only a year. A festival with neither,
 * or a show with no date, is treated as a fit so nothing is hidden.
 */
function showFitsFestival(showDate, festival) {
  const date = isoShowDate(showDate);
  if (!date) return true;
  if (festival && festival.startDate) {
    return date >= festival.startDate && date <= (festival.endDate || festival.startDate);
  }
  const year = festivalYear(festival);
  if (!year) return true;
  return showYear(date) === String(year);
}

module.exports = {
  festivalYear,
  isYearOnly,
  festivalWhenLabel,
  festivalSortKey,
  festivalLastDay,
  festivalWhenFields,
  showFitsFestival,
};
