// netlify/functions/lib/communityStats.js
//
// The community leaderboard (communityStats/global), rebuilt on a schedule
// by netlify/functions/community-stats.js.
//
// Until 5.52.1 every signed-in browser rebuilt this doc itself, on page
// load and on every show add/delete, whenever the stored copy was over an
// hour old. That meant firestore.rules had to let any signed-in user write
// it (so anyone could overwrite the leaderboard), and each rebuild read
// every profile and every user's shows from the client. It now runs here
// with the Admin SDK and the rule is `allow write: if false`.
//
// Each leaderboard entry carries the user's id twice (5.59.10, B-03):
// `userId`, the correct name new builds read, and the misspelled
// `odubleserId` that components/CommunityStatsView.jsx read until then and
// that iOS 3.13.9 and earlier still read. Drop `odubleserId` only once
// those builds are retired (the minimum-version banner).
//
// Server numbers (5.59.15, B-05). The leaderboards and the totals come
// from lib/stats computed here from the shows, never from the counts
// clients write to userProfiles (iOS 3.13.14 and earlier still write them;
// nothing reads them). The leaderboards list only ranked accounts
// (lib/stats isRanked: not a test user, not banned, at least one show).
// The job that writes this doc is lib/userStats.js rebuildAllStats, run by
// community-stats.js, which also writes every user's userStats doc.
//
// Test users. Profiles flagged `isTestUser` are left out, with their shows,
// the same way the admin Stats tab leaves them out by default
// (computeTotals in lib/adminUsers.js). The landing page's "N fans, M shows"
// comes from this doc, so it should count the same people the admin does.

const { normalizeSongTitle } = require('./bandSetlistMergeRule');
const { computeUserStats, isRanked } = require('../../../lib/stats');

/** On the community boards unless the profile opted out (5.60.1). */
const onLeaderboard = (profile) => !(profile && profile.showOnLeaderboard === false);

const TOP_N = 5;

function topProfilesBy(ranked, field) {
  return [...ranked]
    .sort((a, b) => (b.stats[field] || 0) - (a.stats[field] || 0) || String(a.profile.id).localeCompare(String(b.profile.id)))
    .slice(0, TOP_N)
    .map(({ profile: p, stats }) => ({ userId: p.id, odubleserId: p.id, firstName: p.firstName, photoURL: p.photoURL, count: stats[field] || 0 }));
}

/**
 * Pure aggregation. `profiles` is [{ id, ...userProfiles doc }], `showsByUid`
 * a Map (or object) of uid -> array of show docs. Returns every field of
 * communityStats/global except `updatedAt`.
 */
function buildCommunityStats(allProfiles, showsByUid, statsByUid = null) {
  const profiles = allProfiles.filter((p) => p.isTestUser !== true);
  const showsFor = (uid) => (showsByUid instanceof Map ? showsByUid.get(uid) : showsByUid[uid]) || [];
  const statsFor = (uid) => (statsByUid && statsByUid.get(uid)) || computeUserStats(showsFor(uid));

  const allSongs = {};
  const allVenues = {};
  const withStats = profiles.map((profile) => ({ profile, stats: statsFor(profile.id) }));
  // The boards list ranked accounts that haven't opted out (Profile →
  // "Show me on the community leaderboard", userProfiles.showOnLeaderboard,
  // 5.60.1; missing means on). Opting out leaves your rank as it is.
  const ranked = withStats.filter(({ profile, stats }) => isRanked(profile, stats));
  const listed = ranked.filter(({ profile }) => onLeaderboard(profile));
  const totalShows = withStats.reduce((acc, { stats }) => acc + stats.showCount, 0);
  const totalSongs = withStats.reduce((acc, { stats }) => acc + stats.songCount, 0);

  for (const profile of profiles) {
    for (const show of showsFor(profile.id)) {
      const venueName = show.venue + (show.city ? `, ${show.city}` : '');
      if (!allVenues[venueName]) allVenues[venueName] = { count: 0, artists: new Set() };
      allVenues[venueName].count++;
      allVenues[venueName].artists.add(show.artist);

      for (const song of show.setlist || []) {
        // The client threw on a nameless song and lost that user's whole
        // show list for the run; skip just the song instead.
        if (!song || typeof song.name !== 'string' || !song.name.trim()) continue;
        const songKey = normalizeSongTitle(song.name) || song.name.toLowerCase().trim();
        if (!allSongs[songKey]) {
          allSongs[songKey] = { songName: song.name, users: new Set(), artists: new Set(), ratings: [] };
        }
        allSongs[songKey].users.add(profile.id);
        allSongs[songKey].artists.add(show.artist);
        if (song.rating) allSongs[songKey].ratings.push(song.rating);
      }
    }
  }

  const topSongsBySightings = Object.values(allSongs)
    .map((s) => ({ songName: s.songName, userCount: s.users.size, artists: [...s.artists].slice(0, 3) }))
    .sort((a, b) => b.userCount - a.userCount)
    .slice(0, TOP_N);

  const topSongsByRating = Object.values(allSongs)
    .filter((s) => s.ratings.length >= 2)
    .map((s) => ({
      songName: s.songName,
      avgRating: (s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length).toFixed(1),
      ratingCount: s.ratings.length,
      artists: [...s.artists].slice(0, 3),
    }))
    .sort((a, b) => parseFloat(b.avgRating) - parseFloat(a.avgRating))
    .slice(0, TOP_N);

  const topVenues = Object.entries(allVenues)
    .map(([name, data]) => ({ venueName: name, showCount: data.count, artistCount: data.artists.size }))
    .sort((a, b) => b.showCount - a.showCount)
    .slice(0, TOP_N);

  return {
    totalUsers: profiles.length,
    totalShows,
    totalSongs,
    topShowsAttended: topProfilesBy(listed, 'showCount'),
    topSongsRated: topProfilesBy(listed, 'ratedSongCount'),
    topVenuesVisited: topProfilesBy(listed, 'venueCount'),
    rankedCount: ranked.length,
    topSongsBySightings,
    topSongsByRating,
    topVenues,
  };
}

/**
 * Reads every profile and every users/{uid}/shows doc (one collection-group
 * query, not one read per user), rebuilds the leaderboard and writes it.
 * Only `users/{uid}/shows` counts: upcomingShows and any other collection
 * named `shows` elsewhere are skipped by path.
 */
async function rebuildCommunityStats(db, { serverTimestamp }) {
  const [profilesSnap, showsSnap] = await Promise.all([
    db.collection('userProfiles').get(),
    db.collectionGroup('shows').get(),
  ]);

  const profiles = profilesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const showsByUid = new Map();
  showsSnap.forEach((docSnap) => {
    const userRef = docSnap.ref.parent.parent;
    if (!userRef || userRef.parent.id !== 'users') return;
    if (!showsByUid.has(userRef.id)) showsByUid.set(userRef.id, []);
    showsByUid.get(userRef.id).push(docSnap.data());
  });

  const stats = buildCommunityStats(profiles, showsByUid);
  await db.collection('communityStats').doc('global').set({ updatedAt: serverTimestamp(), ...stats });
  return stats;
}

module.exports = { buildCommunityStats, rebuildCommunityStats, onLeaderboard };
