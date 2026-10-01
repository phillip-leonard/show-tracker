// lib/yearInReview.js
//
// Computes a personalized annual concert recap purely from shows already on
// hand — same "pure function over the user's own shows[]" approach as
// lib/runIndex.js / lib/festivalGrouping.js, no new per-show schema needed.
// Firestore is only used to cache the generated result and to store the
// user's privacy choice for the shareable page (see saveYearInReview /
// subscribeYearInReview below).
//
// Schema:
//   yearInReviews/{uid}_{year}
//     {
//       userId, year, generatedDate: serverTimestamp(),
//       privacy: 'private' | 'public',
//       stats: { ...whatever computeYearInReview() returned },
//     }

import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { parseDate, normalizeSongTitle } from '@/lib/utils';
import { forEachSongOncePerShow } from '@/lib/songCounts';

const MILESTONES = [25, 50, 100, 250, 500];

function dayKey(date) {
  const d = parseDate(date);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
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
    .filter((s) => s?.date && new Date(s.date).getFullYear() === year)
    .sort((a, b) => parseDate(a.date) - parseDate(b.date));

  if (!yearShows.length) return null;

  const artistCounts = {};
  const artistRatings = {};
  const venueCounts = {};
  const venueDisplay = {};
  const songCounts = {};
  const songDisplay = {};
  const countries = new Set();
  const states = new Set();

  yearShows.forEach((s) => {
    if (s.artist) {
      artistCounts[s.artist] = (artistCounts[s.artist] || 0) + 1;
      if (typeof s.rating === 'number') {
        artistRatings[s.artist] = artistRatings[s.artist] || [];
        artistRatings[s.artist].push(s.rating);
      }
    }
    if (s.venue) {
      const vKey = `${s.venue}::${s.city || ''}`;
      venueCounts[vKey] = (venueCounts[vKey] || 0) + 1;
      venueDisplay[vKey] = { name: s.venue, city: s.city || '' };
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

  const topArtistEntry = topEntry(artistCounts);
  const topArtist = topArtistEntry ? {
    name: topArtistEntry[0],
    showCount: topArtistEntry[1],
    avgRating: artistRatings[topArtistEntry[0]]?.length
      ? Number((artistRatings[topArtistEntry[0]].reduce((a, b) => a + b, 0) / artistRatings[topArtistEntry[0]].length).toFixed(1))
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

  const dayKeys = Array.from(new Set(yearShows.map((s) => dayKey(s.date)).filter(Boolean))).sort();
  const longestConsecutiveStreak = longestStreak(dayKeys);

  const artistRatingAverages = Object.entries(artistRatings)
    .map(([name, ratings]) => ({ name, avg: ratings.reduce((a, b) => a + b, 0) / ratings.length }))
    .sort((a, b) => b.avg - a.avg);
  const highestRatedArtist = artistRatingAverages[0]
    ? { name: artistRatingAverages[0].name, avgRating: Number(artistRatingAverages[0].avg.toFixed(1)) }
    : null;

  // Achievements
  const achievements = [];
  const priorShowCount = allShows.filter((s) => s?.date && new Date(s.date).getFullYear() < year).length;
  const totalAfterYear = priorShowCount + yearShows.length;
  MILESTONES.forEach((m) => {
    if (priorShowCount < m && totalAfterYear >= m) {
      achievements.push({ title: `${m}th Show Milestone`, description: `You hit your ${m}th show ever this year!` });
    }
  });

  const priorCountries = new Set(
    allShows.filter((s) => s?.date && new Date(s.date).getFullYear() < year && s.country).map((s) => s.country.trim())
  );
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
    if (!s?.date) return;
    const y = new Date(s.date).getFullYear();
    yearlyTotals[y] = (yearlyTotals[y] || 0) + 1;
  });
  const bestYearEver = Object.entries(yearlyTotals).sort((a, b) => b[1] - a[1])[0];
  if (bestYearEver && Number(bestYearEver[0]) === year && Object.keys(yearlyTotals).length > 1) {
    achievements.push({ title: 'Your Biggest Year Yet', description: `${year} was your most-attended year with ${yearShows.length} shows.` });
  }

  return {
    year,
    totalShows: yearShows.length,
    totalArtists: new Set(yearShows.map((s) => s.artist).filter(Boolean)).size,
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
    shareableQuote: `In ${year} I attended ${yearShows.length} concert${yearShows.length === 1 ? '' : 's'}`
      + (countries.size ? ` across ${countries.size} countr${countries.size === 1 ? 'y' : 'ies'}` : '')
      + ` and saw ${new Set(yearShows.map((s) => s.artist).filter(Boolean)).size} different artist${new Set(yearShows.map((s) => s.artist)).size === 1 ? '' : 's'}.`,
  };
}

export function yearInReviewDocId(uid, year) {
  return `${uid}_${year}`;
}

export async function saveYearInReview(uid, year, stats, privacy = 'private') {
  await setDoc(doc(db, 'yearInReviews', yearInReviewDocId(uid, year)), {
    userId: uid,
    year,
    generatedDate: serverTimestamp(),
    privacy,
    stats,
  }, { merge: true });
}

export async function getYearInReview(uid, year) {
  const snap = await getDoc(doc(db, 'yearInReviews', yearInReviewDocId(uid, year)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeYearInReview(uid, year, callback) {
  if (!uid || !year) { callback(null); return () => {}; }
  return onSnapshot(doc(db, 'yearInReviews', yearInReviewDocId(uid, year)), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, (err) => console.error('[yearInReview] Listener failed:', err.code || err.message, err));
}

export async function setYearInReviewPrivacy(uid, year, privacy) {
  await setDoc(doc(db, 'yearInReviews', yearInReviewDocId(uid, year)), { privacy }, { merge: true });
}
