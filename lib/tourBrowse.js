// lib/tourBrowse.js
//
// Pure helpers for "browse a tour and bulk-add the nights you caught" —
// tour-name normalization, the free-text `Goose Summer Tour 2025` parse,
// and the already-in-your-account check that keeps bulk add from creating
// duplicates. Same pure-function + unit-tested shape as lib/runIndex.js
// and lib/festivalGrouping.js; nothing here touches Firestore or React.
//
// The network half lives in netlify/functions/get-artist-tours.js (tour
// discovery) and netlify/functions/get-tour-shows.js (one tour's shows).

import { venuesFuzzyMatch } from '@/lib/utils';
import { showYear } from '@/lib/showDate';

// How many leading tokens of a free-text query we're willing to test as an
// artist name. Three covers "Goose", "My Morning Jacket", "King Gizzard
// and the Lizard Wizard" is longer — and that's deliberate: an artist name
// we can't resolve inside this bound is treated as ambiguous and drops the
// user into the picker rather than being guessed at. Each candidate split
// costs one setlist.fm artist search, so this is also the rate-limit bound.
export const MAX_ARTIST_TOKENS = 3;

// ── Tour names ────────────────────────────────────────────────────────
// Tour names on setlist.fm are free text typed by contributors, so the
// same tour shows up as "Summer Tour 2025", "summer tour 2025" and
// "Summer  Tour  2025". Normalize for grouping/matching only — every
// display path uses the name exactly as setlist.fm has it, because the
// contributor's casing is the closest thing to an official spelling.
//
// Deliberately conservative: case, whitespace and surrounding punctuation
// only. The year is NOT stripped — "Summer Tour 2024" and "Summer Tour
// 2025" are different tours and must never collapse into one entry.
export function normalizeTourName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .trim();
}

// setlist.fm's own "no tour on this setlist" bucket. get-artist-tours
// returns it (TourInfoModal shows it as a stats row), but it is never a
// browsable tour — you can't ask /search/setlists for it by name.
export const UNTAGGED_TOUR_NAME = 'No Tour Listed';

export function isBrowsableTour(tour) {
  return !!tour && !tour.untagged && !!(tour.name || '').trim() && tour.name !== UNTAGGED_TOUR_NAME;
}

// Two tours are the same tour when their normalized names match. Tours
// from different years normalize differently (the year is part of the
// name), and a tour whose name genuinely repeats across years is split by
// the caller on date range — see tourOptionLabel below.
export function tourNamesMatch(a, b) {
  const na = normalizeTourName(a);
  const nb = normalizeTourName(b);
  return !!na && na === nb;
}

// Distinguishes two tours that share a name. setlist.fm contributors do
// reuse a name across years ("Summer Tour" logged for both 2024 and
// 2025), so the picker labels every entry with its own date range and
// only appends the year when a name is not unique in the list.
export function tourOptionLabel(tour, allTours = []) {
  const name = tour?.name || '';
  const sameName = allTours.filter(t => tourNamesMatch(t.name, name));
  if (sameName.length <= 1) return name;
  const year = showYear(tour.startDate);
  return year ? `${name} (${year})` : name;
}

// ── Free-text parse ───────────────────────────────────────────────────
// "Goose Summer Tour 2025" -> { artistQuery: 'Goose', tourQuery: 'Summer
// Tour 2025' }, for every split of the leading tokens we're willing to
// test. Returned longest-artist-first so "My Morning Jacket" wins over
// "My" when both resolve to a real artist.
//
// The caller resolves each candidate against the app's existing artist
// search (netlify/functions/search-artists.js — there is deliberately no
// second artist lookup here) and only auto-advances when exactly one
// candidate resolves to exactly one exact-name match. Anything else is
// ambiguous and opens the picker pre-filled: a wrong silent guess costs
// far more than one extra tap.
export function splitCandidates(input) {
  const tokens = String(input || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return [];

  const maxLead = Math.min(MAX_ARTIST_TOKENS, tokens.length - 1);
  const candidates = [];
  for (let lead = maxLead; lead >= 1; lead--) {
    candidates.push({
      artistQuery: tokens.slice(0, lead).join(' '),
      tourQuery: tokens.slice(lead).join(' '),
    });
  }
  return candidates;
}

// An artist search result counts as a resolution only on an exact,
// case-insensitive name equality with the typed prefix. A relevance match
// ("Goose" also returns "Goose Creek Symphony") is not good enough to
// skip a step on the user's behalf.
export function exactArtistMatches(artists = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return artists.filter(a => (a?.name || '').trim().toLowerCase() === q);
}

// Picks the tour a free-text remainder refers to, out of the artist's
// discovered tours. Exact normalized equality first; failing that, a
// unique prefix match ("summer tour" -> "Summer Tour 2025", but only when
// exactly one tour starts that way). Returns null whenever the answer is
// ambiguous, which sends the user to the tour picker with the text
// pre-filled instead of opening the wrong tour.
export function resolveTourQuery(tourQuery, tours = []) {
  const q = normalizeTourName(tourQuery);
  if (!q) return null;

  const browsable = tours.filter(isBrowsableTour);

  const exact = browsable.filter(t => normalizeTourName(t.name) === q);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // same name, different years — let the user pick

  const prefixed = browsable.filter(t => normalizeTourName(t.name).startsWith(q));
  return prefixed.length === 1 ? prefixed[0] : null;
}

// ── Already-in-your-account check ─────────────────────────────────────
// The single most important correctness property of bulk add: a night the
// user already has must be marked and unselectable, because the worst
// outcome of this feature is silently doubling their history.
//
// Rule, in order:
//   1. `setlistfmId` equality — exact, and the only check that can't be
//      fooled by a spelling difference. Everything imported from
//      setlist.fm (including via this flow) carries one.
//   2. artist + date + fuzzy venue — the fallback for shows added by hand
//      or imported from CSV, which have no setlistfmId. Artist is
//      compared case-insensitively, date exactly (both sides are already
//      normalized to yyyy-MM-dd), and venue through the app's existing
//      venuesFuzzyMatch, so "Dick's Sporting Goods Park" vs "Dicks
//      Sporting Goods Park" still counts as the same night.
//
// A third, weaker signal is reported separately rather than folded in:
// same artist + same date but a venue that doesn't fuzzy-match at all.
// That's *probably* the same night typed differently, but it's also
// legitimately two sets in one day, so it stays selectable and is
// surfaced as "you may already have this" — visible, never silent.
export function buildExistingShowIndex(shows = []) {
  const bySetlistfmId = new Set();
  const byArtistDate = new Map(); // `${artist}|${date}` -> [venue, ...]

  shows.forEach(show => {
    if (!show) return;
    if (show.setlistfmId) bySetlistfmId.add(String(show.setlistfmId));
    const artist = (show.artist || '').toLowerCase().trim();
    if (!artist || !show.date) return;
    const key = `${artist}|${show.date}`;
    if (!byArtistDate.has(key)) byArtistDate.set(key, []);
    byArtistDate.get(key).push(show.venue || '');
  });

  return { bySetlistfmId, byArtistDate };
}

// Returns 'added' (definitely already in the account, not selectable),
// 'possible' (same artist and date, different venue — selectable, warned
// about) or 'new'.
export function existingShowStatus(index, candidate) {
  if (!index || !candidate) return 'new';

  if (candidate.setlistfmId && index.bySetlistfmId.has(String(candidate.setlistfmId))) {
    return 'added';
  }

  const artist = (candidate.artist || '').toLowerCase().trim();
  if (!artist || !candidate.date) return 'new';

  const venues = index.byArtistDate.get(`${artist}|${candidate.date}`);
  if (!venues || venues.length === 0) return 'new';

  const candidateVenue = candidate.venue || '';
  if (venues.some(v => venuesFuzzyMatch(v, candidateVenue))) return 'added';

  // Same artist, same date, venues that don't fuzzy-match — including the
  // case where one side has no usable venue string at all, which
  // venuesFuzzyMatch reports as `false` rather than as a match. Probably
  // the same night spelled differently, possibly two sets in one day, so
  // it stays selectable and gets flagged.
  return 'possible';
}
