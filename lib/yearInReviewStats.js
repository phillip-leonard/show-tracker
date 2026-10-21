// lib/yearInReviewStats.js
//
// computeYearInReview(): a personalized annual concert recap, computed purely
// from the user's own shows[]. No Firebase here, so it can be unit tested
// with plain node (lib/__tests__/yearInReview.test.js). Caching the result
// and the privacy choice live in lib/yearInReview.js, which re-exports this.
//
// ── WHICH YEAR A SHOW BELONGS TO ───────────────────────────────────────
//
// Always through parseDate (lib/utils.js), never `new Date(show.date)`.
// Show dates are stored as YYYY-MM-DD or DD-MM-YYYY (see the note under
// parseDate). `new Date('2025-01-01')` is UTC midnight, which is still
// Dec 31 2024 anywhere west of Greenwich, so every New Year's Day show
// landed in the previous year's review; `new Date('31-12-2025')` is
// Invalid Date, so DD-MM-YYYY shows with a day above 12 were dropped
// entirely. Both were live bugs until 5.46.0.

import { parseDate, normalizeSongTitle } from '@/lib/utils';
import { forEachSongOncePerShow } from '@/lib/songCounts';

const MILESTONES = [25, 50, 100, 250, 500];

// parseDate returns new Date(0) for a missing or unreadable date.
function showDate(show) {
  if (!show?.date) return null;
  const d = parseDate(show.date);
  return Number.isNaN(d.getTime()) || d.getTime() === 0 ? null : d;
}

export function showYear(show) {
  return showDate(show)?.getFullYear() ?? null;
}

// Local calendar day, so a show is never shifted a day by toISOString's UTC.
function dayKey(show) {
  const d = showDate(show);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The same band typed two ways ("Goose" / "goose ") is one band, and the
// same venue is one venue: keyed like lib/venues.js's venueKeyFor.
function artistKey(name) {
  return (name || '').trim().toLowerCase();
}

function venueKey(name, city) {
  const key = `${(name || '').trim().toLowerCase()}::${(city || '').trim().toLowerCase()}`;
  return key === '::' ? null : key;
}

// Longest run of consecutive calendar days containing at least one show,
// within the given year's shows.
function longestStreak(sortedDayKeys) {
  if (!sortedDayKeys.length) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < sortedDayKeys.length; i++) {
    const prev = new Date(sortedDayKeys[i - 1]);
    const cur = new Date(sortedDayKeys[i]);
    const diffDays = Math.round((cur - prev) / 86400000);
    current = diffDays === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

/**
 * @param {Array} allShows - the user's full show history (all years)
 * @param {number} year - the calendar year to summarize
 */
export function computeYearInReview(allShows = [], year) {
  const yearShows = allShows
    .filter((s) => showYear(s) === year)
    .sort((a, b) => parseDate(a.date) - parseDate(b.date));

  if (!yearShows.length) return null;

  const artistCounts = {};
  const artistDisplay = {};
  const artistRatings = {};
  const venueCounts = {};
  const venueDisplay = {};
  const songCounts = {};
  const songDisplay = {};
  const countries = new Set();
  const states = new Set();

  yearShows.forEach((s) => {
    const aKey = artistKey(s.artist);
    if (aKey) {
      artistCounts[aKey] = (artistCounts[aKey] || 0) + 1;
      artistDisplay[aKey] = artistDisplay[aKey] || s.artist.trim();
      if (typeof s.rating === 'number') {
        artistRatings[aKey] = artistRatings[aKey] || [];
        artistRatings[aKey].push(s.rating);
      }
    }
    const vKey = venueKey(s.venue, s.city);
    if (vKey && s.venue) {
      venueCounts[vKey] = (venueCounts[vKey] || 0) + 1;
      venueDisplay[vKey] = venueDisplay[vKey] || { name: s.venue.trim(), city: (s.city || '').trim() };
    }
    if (s.country) countries.add(s.country.trim());
    if (s.state) states.add(s.state.trim());
    // Shows seen, not performances: a song played twice in one show
    // counts once (lib/songCounts.js).
    forEachSongOncePerShow([s], (song) => normalizeSongTitle((song?.name || '').trim()), (key, song) => {
      songCounts[key] = (songCounts[key] || 0) + 1;
      songDisplay[key] = song.name;
    });
  });

  const topEntry = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || null;
  const average = (ratings) => ratings.reduce((a, b) => a + b, 0) / ratings.length;

  const topArtistEntry = topEntry(artistCounts);
  const topArtist = topArtistEntry ? {
    name: artistDisplay[topArtistEntry[0]],
    showCount: topArtistEntry[1],
    avgRating: artistRatings[topArtistEntry[0]]?.length
      ? Number(average(artistRatings[topArtistEntry[0]]).toFixed(1))
      : null,
  } : null;

  const topVenueEntry = topEntry(venueCounts);
  const favoriteVenue = topVenueEntry ? {
    name: venueDisplay[topVenueEntry[0]].name,
    city: venueDisplay[topVenueEntry[0]].city,
    frequency: topVenueEntry[1],
  } : null;

  const topSongEntry = topEntry(songCounts);
  const mostSeenSong = topSongEntry ? { name: songDisplay[topSongEntry[0]], count: topSongEntry[1] } : null;

  const topRatedShows = yearShows
    .filter((s) => typeof s.rating === 'number')
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 10)
    .map((s) => ({ showId: s.id, artist: s.artist, venue: s.venue, city: s.city, date: s.date, rating: s.rating }));

  const dayKeys = Array.from(new Set(yearShows.map(dayKey).filter(Boolean))).sort();
  const longestConsecutiveStreak = longestStreak(dayKeys);

  const artistRatingAverages = Object.entries(artistRatings)
    .map(([key, ratings]) => ({ name: artistDisplay[key], avg: average(ratings) }))
    .sort((a, b) => b.avg - a.avg);
  const highestRatedArtist = artistRatingAverages[0]
    ? { name: artistRatingAverages[0].name, avgRating: Number(artistRatingAverages[0].avg.toFixed(1)) }
    : null;

  // Achievements
  const achievements = [];
  const priorShows = allShows.filter((s) => {
    const y = showYear(s);
    return y !== null && y < year;
  });
  const priorShowCount = priorShows.length;
  const totalAfterYear = priorShowCount + yearShows.length;
  MILESTONES.forEach((m) => {
    if (priorShowCount < m && totalAfterYear >= m) {
      achievements.push({ title: `${m}th Show Milestone`, description: `You hit your ${m}th show ever this year!` });
    }
  });

  const priorCountries = new Set(priorShows.filter((s) => s.country).map((s) => s.country.trim()));
  const newCountriesThisYear = Array.from(countries).filter((c) => !priorCountries.has(c));
  if (newCountriesThisYear.length) {
    achievements.push({
      title: newCountriesThisYear.length > 1 ? 'New Countries' : 'New Country',
      description: `First time seeing shows in ${newCountriesThisYear.join(', ')}.`,
    });
  }

  if (longestConsecutiveStreak >= 3) {
    achievements.push({ title: 'Concert Streak', description: `${longestConsecutiveStreak} consecutive days catching shows.` });
  }

  const yearlyTotals = {};
  allShows.forEach((s) => {
    const y = showYear(s);
    if (y === null) return;
    yearlyTotals[y] = (yearlyTotals[y] || 0) + 1;
  });
  const bestYearEver = Object.entries(yearlyTotals).sort((a, b) => b[1] - a[1])[0];
  if (bestYearEver && Number(bestYearEver[0]) === year && Object.keys(yearlyTotals).length > 1) {
    achievements.push({ title: 'Your Biggest Year Yet', description: `${year} was your most-attended year with ${yearShows.length} shows.` });
  }

  const totalArtists = Object.keys(artistCounts).length;

  return {
    year,
    totalShows: yearShows.length,
    // "Bands" in the UI. The field keeps its name because cached
    // yearInReviews/{uid}_{year} docs already store it.
    totalArtists,
    totalVenues: Object.keys(venueCounts).length,
    countriesVisited: Array.from(countries),
    statesVisited: Array.from(states),
    topArtist,
    topRatedShows,
    favoriteVenue,
    mostSeenSong,
    highestRatedArtist,
    longestConsecutiveStreak,
    achievements,
    shareableQuote: `In ${year} I saw ${yearShows.length} show${yearShows.length === 1 ? '' : 's'}`
      + ` by ${totalArtists} band${totalArtists === 1 ? '' : 's'}`
      + ` at ${Object.keys(venueCounts).length} venue${Object.keys(venueCounts).length === 1 ? '' : 's'}`
      + (countries.size > 1 ? ` across ${countries.size} countries` : '')
      + '.',
  };
}
