// lib/setlistSearch.js
//
// Helpers for the setlist.fm search on /search (components/SearchView.jsx).
// Pure apart from fetchAllSetlistPages, which takes its page fetcher as an
// argument so it can be tested without a network.
//
// The search can run without an artist. setlist.fm's /search/setlists
// accepts a venue or a city on its own, which is what makes "every show at
// Red Rocks in 2024" a single search. A year on its own is refused, both
// here and in netlify/functions/search-setlists.js: that's every show on
// setlist.fm for twelve months.

// Is there enough to search on? An artist, a venue or a city. A year only
// narrows one of those.
export function hasSearchTarget({ artist = '', venueName = '', cityName = '' } = {}) {
  return !!(String(artist).trim() || String(venueName).trim() || String(cityName).trim());
}

// One setlist.fm setlist -> the show data addShow / addShowsFromTour take.
// The single "Add Show" button and "Add all" both build shows here, so
// a show added either way is identical.
export function setlistToShowData(setlist, extractSongs) {
  const parts = (setlist.eventDate || '').split('-');
  return {
    artist: setlist.artist?.name || '',
    venue: setlist.venue?.name || '',
    city: setlist.venue?.city?.name || '',
    country: setlist.venue?.city?.country?.name || '',
    // setlist.fm returns DD-MM-YYYY; normalize to YYYY-MM-DD for storage.
    date: parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : setlist.eventDate,
    setlist: extractSongs(setlist),
    setlistfmId: setlist.id,
    tour: setlist.tour ? setlist.tour.name : null,
  };
}

// 10 pages x 20 = 200 shows: a busy venue's year (Red Rocks runs ~150
// nights a season) fits, and a search that hits the cap says so rather
// than coming back silently short. Same cap as get-tour-shows.js.
export const MAX_ADD_ALL_PAGES = 10;

// setlist.fm allows about two requests a second per API key. Pages are
// fetched one at a time with this gap, so one "Add all" can't trip the
// limit for everyone else searching at the same moment.
export const ADD_ALL_PAGE_DELAY_MS = 600;

// Every setlist across a search's pages, starting from page 1.
// `fetchPage(n)` resolves to setlist.fm's search response ({ setlist,
// total, itemsPerPage }) or null when there are no more pages (404).
// Returns { setlists, total, truncated }. `truncated` is true when the
// search has more shows than the page cap allowed.
export async function fetchAllSetlistPages(fetchPage, {
  maxPages = MAX_ADD_ALL_PAGES,
  delayMs = ADD_ALL_PAGE_DELAY_MS,
  onProgress = () => {},
  sleep = (ms) => new Promise(r => setTimeout(r, ms)),
} = {}) {
  const setlists = [];
  const seen = new Set();
  let total = 0;
  let pageCount = 1;

  for (let page = 1; page <= Math.min(pageCount, maxPages); page++) {
    if (page > 1 && delayMs > 0) await sleep(delayMs);
    const data = await fetchPage(page);
    if (!data || !Array.isArray(data.setlist) || data.setlist.length === 0) break;

    if (page === 1) {
      total = data.total || data.setlist.length;
      const perPage = data.itemsPerPage || data.setlist.length || 20;
      pageCount = Math.max(1, Math.ceil(total / perPage));
    }
    data.setlist.forEach(s => {
      if (s?.id && seen.has(s.id)) return;
      if (s?.id) seen.add(s.id);
      setlists.push(s);
    });
    onProgress({ page, pageCount: Math.min(pageCount, maxPages), loaded: setlists.length, total });
  }

  return { setlists, total, truncated: pageCount > maxPages };
}

// Groups shows by venue for the "Add all" review. setlist.fm's venueName
// is a loose match, so "Madison Square Garden" also brings back the
// Hulu Theater at Madison Square Garden. Grouping lets the user keep the
// venue they meant and untick the rest. Largest group first.
export function groupShowsByVenue(shows) {
  const groups = new Map();
  (shows || []).forEach(show => {
    const key = `${(show.venue || '').trim().toLowerCase()}|${(show.city || '').trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { key, venue: show.venue || 'Unknown venue', city: show.city || '', shows: [] });
    groups.get(key).shows.push(show);
  });
  return [...groups.values()].sort((a, b) => b.shows.length - a.shows.length || a.venue.localeCompare(b.venue));
}
