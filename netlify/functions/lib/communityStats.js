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
// Test users. Profiles flagged `isTestUser` are left out, with their shows,
// the same way the admin Stats tab leaves them out by default
// (computeTotals in lib/adminUsers.js). The landing page's "N fans, M shows"
// comes from this doc, so it should count the same people the admin does.

const { normalizeSongTitle } = require('./bandSetlistMergeRule');

const TOP_N = 5;

function topProfilesBy(profiles, field) {
  return [...profiles]
    .sort((a, b) => (b[field] || 0) - (a[field] || 0))
    .slice(0, TOP_N)
    .map((p) => ({ userId: p.id, odubleserId: p.id, firstName: p.firstName, photoURL: p.photoURL, count: p[field] || 0 }));
}

/**
 * Pure aggregation. `profiles` is [{ id, ...userProfiles doc }], `showsByUid`
 * a Map (or object) of uid -> array of show docs. Returns every field of
 * communityStats/global except `updatedAt`.
 */
function buildCommunityStats(allProfiles, showsByUid) {
  const profiles = allProfiles.filter((p) => p.isTestUser !== true);
  const showsFor = (uid) => (showsByUid instanceof Map ? showsByUid.get(uid) : showsByUid[uid]) || [];

  const allSongs = {};
  const allVenues = {};
  const totalShows = profiles.reduce((acc, p) => acc + (p.showCount || 0), 0);
  const totalSongs = profiles.reduce((acc, p) => acc + (p.songCount || 0), 0);

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
    topShowsAttended: topProfilesBy(profiles, 'showCount'),
    topSongsRated: topProfilesBy(profiles, 'ratedSongCount'),
    topVenuesVisited: topProfilesBy(profiles, 'venueCount'),
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

module.exports = { buildCommunityStats, rebuildCommunityStats };
