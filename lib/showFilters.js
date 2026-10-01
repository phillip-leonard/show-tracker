// lib/showFilters.js
//
// The show filter used on My Shows, Stats, Tours and Festivals: free-text
// match on artist or venue, a calendar year, or a single date. Pure
// functions only; the UI is components/shows/ShowFilters.jsx and the
// per-page state is hooks/useShowFilters.js (My Shows keeps its state in
// AppContext, which predates the others).
//
// This is the logic that used to live inline in AppContext's
// sortedFilteredShows, unchanged, so My Shows filters exactly as before.
// Sorting stays with the caller: only My Shows sorts its result.

import { parseDate } from '@/lib/utils';

export const EMPTY_SHOW_FILTERS = Object.freeze({ searchTerm: '', filterYear: '', filterDate: '' });

export function applyShowFilters(shows, { searchTerm = '', filterYear = '', filterDate = '' } = {}) {
  const term = searchTerm.toLowerCase();
  let filtered = (shows || []).filter(show =>
    (show.artist || '').toLowerCase().includes(term) ||
    (show.venue || '').toLowerCase().includes(term)
  );
  if (filterYear) {
    filtered = filtered.filter(show => parseDate(show.date).getFullYear() === parseInt(filterYear));
  }
  if (filterDate) {
    filtered = filtered.filter(show => show.date === filterDate);
  }
  return filtered;
}

// Distinct years across the shows, newest first — the Year dropdown's options.
export function availableYearsFor(shows) {
  const years = [...new Set((shows || []).map(s => parseDate(s.date).getFullYear()).filter(y => y > 1900))];
  return years.sort((a, b) => b - a);
}

// How many of the three filters are narrowing the list.
export function countActiveShowFilters({ searchTerm, filterYear, filterDate } = {}) {
  return [searchTerm, filterYear, filterDate].filter(Boolean).length;
}
