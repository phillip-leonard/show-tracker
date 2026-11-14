// lib/festivalDates.js
//
// When a festival happened, for display, sorting and filtering (5.58.0).
//
// A shared festival has either both dates (startDate, endDate, yyyy-MM-dd)
// or, when whoever added it didn't know them, only `year`. firestore.rules
// enforces exactly those two shapes; lib/festivalMatch.js holds the match
// rule for each. Every screen that used to read startDate directly goes
// through here instead, so a year-only festival never shows a blank date,
// sorts to a random place, or counts as past or upcoming by accident.

import { festivalYear, isYearOnly } from '@/lib/festivalMatch';
import { formatDate } from '@/lib/utils';
import { showYear, toIsoDate } from '@/lib/showDate';

export { festivalYear, isYearOnly };

/** "6/13/2024 – 6/16/2024", "6/13/2024", "2024", or "" when unknown. */
export function festivalWhenLabel(festival) {
  if (festival?.startDate) {
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
export function festivalSortKey(festival) {
  if (festival?.startDate) return festival.startDate;
  const year = festivalYear(festival);
  return year ? `${year}-00-00` : '';
}

/**
 * The last day a festival could have run, yyyy-MM-dd. For a year-only
 * festival that is 31 December, so one in the current year still counts as
 * upcoming: we can't tell, and offering festival picks for a festival that
 * has already happened costs less than hiding them for one that hasn't.
 */
export function festivalLastDay(festival) {
  if (festival?.startDate) return festival.endDate || festival.startDate;
  const year = festivalYear(festival);
  return year ? `${year}-12-31` : '';
}

/**
 * The date fields a festival is written with, from what the form gave:
 * both dates and their year, or only the year. Returns null when there is
 * neither, which firestore.rules would refuse anyway.
 */
export function festivalWhenFields({ startDate, endDate, year } = {}) {
  if (startDate) {
    return {
      startDate,
      endDate: endDate || startDate,
      year: Number(showYear(startDate)),
    };
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
export function showFitsFestival(showDate, festival) {
  const date = isoShowDate(showDate);
  if (!date) return true;
  if (festival?.startDate) {
    return date >= festival.startDate && date <= (festival.endDate || festival.startDate);
  }
  const year = festivalYear(festival);
  if (!year) return true;
  return showYear(date) === String(year);
}
