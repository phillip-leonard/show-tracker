// netlify/functions/lib/userStats.js — the server's copy of every user's
// numbers (5.59.15, B-05, SCOPING §7.2).
//
// Documents (written only here; firestore.rules denies every client write):
//   userStats/{uid}        the full lib/stats object, rank, rankedOf,
//                          ranked, computedAt. Owner and admin read.
//   publicUserStats/{uid}  showCount, songCount, ratedSongCount,
//                          venueCount, rank, rankedOf: what other signed-in
//                          users see (Friends list, profile sheet). Any
//                          signed-in user reads, as userProfiles today.
//   communityStats/global  the leaderboards and community totals
//                          (lib/communityStats.js), from the same numbers.
//
// Two ways in:
//   rebuildAllStats(db)        every user, every 6 hours (community-stats.js)
//                              and the backfill script. One read of every
//                              profile and one collection-group read of
//                              every show; about 1,500 shows today.
//   recomputeUserStats(db, uid) one user, after they change a show
//                              (recompute-my-stats.js). Their rank is
//                              recomputed against everyone's stored counts;
//                              other users' ranks catch up on the next run.
//
// Never reads the counts clients write to userProfiles: iOS 3.13.14 and
// earlier still write them, and nothing trusts them any more.

const { computeUserStats, publicStats, isRanked, rankUsers } = require('../../../lib/stats');
const { buildCommunityStats } = require('./communityStats');

const BATCH = 400;

function showsByUser(showsSnap) {
  const byUid = new Map();
  (showsSnap.docs || []).forEach((docSnap) => {
    // Only users/{uid}/shows/{id}: upcomingShows and any other `shows`
    // collection elsewhere are skipped by path.
    const parts = String(docSnap.ref && docSnap.ref.path || '').split('/');
    if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'shows') return;
    if (!byUid.has(parts[1])) byUid.set(parts[1], []);
    byUid.get(parts[1]).push(docSnap.data());
  });
  return byUid;
}

/** The two documents for one user. */
function userStatsDocs(stats, rank, ranked, computedAt) {
  return {
    full: { ...stats, ranked, rank: rank ? rank.rank : null, rankedOf: rank ? rank.of : null, computedAt },
    public: { ...publicStats(stats, rank), computedAt },
  };
}

/**
 * rebuildAllStats(db, { now, write }) → { users, ranked, shows, written }
 * write:false computes everything and writes nothing (the backfill's dry
 * run). Returns the computed stats by uid for the parity report.
 */
async function rebuildAllStats(db, { serverTimestamp = () => new Date(), write = true } = {}) {
  const [profilesSnap, showsSnap] = await Promise.all([
    db.collection('userProfiles').get(),
    db.collectionGroup('shows').get(),
  ]);
  const profiles = profilesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const byUid = showsByUser(showsSnap);

  const uids = new Set([...profileById.keys(), ...byUid.keys()]);
  const statsByUid = new Map();
  for (const uid of uids) statsByUid.set(uid, computeUserStats(byUid.get(uid) || []));

  const rankedEntries = [...uids]
    .filter((uid) => isRanked(profileById.get(uid), statsByUid.get(uid)))
    .map((uid) => ({ uid, showCount: statsByUid.get(uid).showCount }));
  const ranks = rankUsers(rankedEntries);

  const community = buildCommunityStats(profiles, byUid, statsByUid);
  let written = 0;
  if (write) {
    const at = serverTimestamp();
    const ops = [];
    for (const uid of uids) {
      const docs = userStatsDocs(statsByUid.get(uid), ranks.get(uid) || null, ranks.has(uid), at);
      ops.push([db.collection('userStats').doc(uid), docs.full]);
      ops.push([db.collection('publicUserStats').doc(uid), docs.public]);
    }
    for (let i = 0; i < ops.length; i += BATCH) {
      const batch = db.batch();
      ops.slice(i, i + BATCH).forEach(([ref, data]) => batch.set(ref, data));
      await batch.commit();
      written += Math.min(BATCH, ops.length - i);
    }
    await db.collection('communityStats').doc('global').set({ updatedAt: at, ...community });
  }

  return {
    users: uids.size,
    ranked: rankedEntries.length,
    shows: [...byUid.values()].reduce((n, l) => n + l.length, 0),
    written,
    statsByUid,
    ranks,
    profiles: profileById,
    community,
  };
}

/**
 * recomputeUserStats(db, uid) → the user's userStats document. Ranks them
 * against everyone else's stored publicUserStats (one small read), so the
 * caller sees their new rank at once.
 */
async function recomputeUserStats(db, uid, { serverTimestamp = () => new Date() } = {}) {
  const [showsSnap, profileSnap, othersSnap] = await Promise.all([
    db.collection('users').doc(uid).collection('shows').get(),
    db.collection('userProfiles').doc(uid).get(),
    db.collection('userStats').where('ranked', '==', true).get(),
  ]);
  const stats = computeUserStats(showsSnap.docs.map((d) => d.data()));
  const profile = profileSnap.exists ? profileSnap.data() : null;
  const ranked = isRanked(profile, stats);

  const entries = othersSnap.docs
    .filter((d) => d.id !== uid)
    .map((d) => ({ uid: d.id, showCount: Number(d.data().showCount) || 0 }));
  if (ranked) entries.push({ uid, showCount: stats.showCount });
  const rank = ranked ? rankUsers(entries).get(uid) : null;

  const at = serverTimestamp();
  const docs = userStatsDocs(stats, rank, ranked, at);
  await Promise.all([
    db.collection('userStats').doc(uid).set(docs.full),
    db.collection('publicUserStats').doc(uid).set(docs.public),
  ]);
  return docs.full;
}

module.exports = { rebuildAllStats, recomputeUserStats, userStatsDocs, showsByUser };
