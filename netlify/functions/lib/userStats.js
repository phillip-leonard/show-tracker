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
//   yearInReviews/{uid}_{year}.stats
//                          the Year in Review numbers a visitor sees on a
//                          public review (lib/yearInReviewStats.js), on
//                          every review document that exists (5.60.4). The
//                          app creates the document and owns `privacy`;
//                          the numbers are the server's. Older app builds
//                          still write `stats` themselves; the next
//                          recompute or rebuild replaces them.
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
const { buildCommunityStats, onLeaderboard } = require('./communityStats');
const { computeYearInReview } = require('../../../lib/yearInReviewStats');

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

// ── Year in Review (5.60.4) ───────────────────────────────────────────

/** Each user's shows with their document ids (topRatedShows links them). */
function showsWithIdsByUser(showsSnap) {
  const byUid = new Map();
  (showsSnap.docs || []).forEach((docSnap) => {
    const parts = String(docSnap.ref && docSnap.ref.path || '').split('/');
    if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'shows') return;
    if (!byUid.has(parts[1])) byUid.set(parts[1], []);
    byUid.get(parts[1]).push({ id: docSnap.id, ...docSnap.data() });
  });
  return byUid;
}

/**
 * yearInReviewUpdates(reviewDocs, showsFor) → [{ ref, stats }] for every
 * review whose stored numbers differ from its owner's shows. Pure apart
 * from reading the snapshots, so the parity report and the tests can use
 * it. A year that no longer has any shows gets `stats: null`, which the
 * page shows as unavailable.
 */
// JSON with object keys sorted at every level: Firestore hands maps back
// with their keys in its own order, so a plain JSON.stringify would see a
// change on every run.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function yearInReviewUpdates(reviewDocs, showsFor) {
  const out = [];
  for (const d of reviewDocs || []) {
    const data = d.data() || {};
    const year = Number(data.year);
    if (!data.userId || !Number.isInteger(year)) continue;
    // Only the owner's own review: the page reads yearInReviews/{uid}_{year},
    // so a document filed under someone else's id is never filled in.
    if (d.id && d.id !== `${data.userId}_${year}`) continue;
    // Through JSON, so a missing field (a show with no city) is left out as
    // Firestore stores it, rather than an `undefined` the Admin SDK refuses.
    const computed = computeYearInReview(showsFor(data.userId) || [], year);
    const stats = computed == null ? null : JSON.parse(JSON.stringify(computed));
    if (canonicalJson(stats) === canonicalJson(data.stats == null ? null : data.stats)) continue;
    out.push({ ref: d.ref, uid: data.userId, year, stats });
  }
  return out;
}

async function writeYearInReviews(db, updates, at) {
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = db.batch();
    updates.slice(i, i + BATCH).forEach((u) => batch.update(u.ref, { stats: u.stats, statsComputedAt: at }));
    await batch.commit();
  }
  return updates.length;
}

/**
 * rebuildAllStats(db, { now, write }) → { users, ranked, shows, written }
 * write:false computes everything and writes nothing (the backfill's dry
 * run). Returns the computed stats by uid for the parity report.
 */
async function rebuildAllStats(db, { serverTimestamp = () => new Date(), write = true } = {}) {
  const [profilesSnap, showsSnap, reviewsSnap] = await Promise.all([
    db.collection('userProfiles').get(),
    db.collectionGroup('shows').get(),
    db.collection('yearInReviews').get(),
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
  const withIds = showsWithIdsByUser(showsSnap);
  const reviewUpdates = yearInReviewUpdates(reviewsSnap.docs, (uid) => withIds.get(uid));
  let written = 0;
  let reviewsWritten = 0;
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
    reviewsWritten = await writeYearInReviews(db, reviewUpdates, at);
  }

  return {
    users: uids.size,
    ranked: rankedEntries.length,
    shows: [...byUid.values()].reduce((n, l) => n + l.length, 0),
    written,
    yearInReviews: { docs: reviewsSnap.size, changed: reviewUpdates.length, written: reviewsWritten },
    reviewUpdates,
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
  const [showsSnap, profileSnap, othersSnap, reviewsSnap] = await Promise.all([
    db.collection('users').doc(uid).collection('shows').get(),
    db.collection('userProfiles').doc(uid).get(),
    db.collection('userStats').where('ranked', '==', true).get(),
    db.collection('yearInReviews').where('userId', '==', uid).get(),
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
  const shows = showsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const reviewUpdates = yearInReviewUpdates(reviewsSnap.docs, (owner) => (owner === uid ? shows : []));
  await Promise.all([
    db.collection('userStats').doc(uid).set(docs.full),
    db.collection('publicUserStats').doc(uid).set(docs.public),
    writeYearInReviews(db, reviewUpdates, at),
  ]);
  // Opted out of the leaderboard (5.60.1): leave the boards now rather
  // than at the next rebuild. Opting back in shows on the next rebuild.
  if (!onLeaderboard(profile)) await removeFromBoards(db, uid);
  return docs.full;
}

/** Takes a user off communityStats/global's lists, in a transaction. */
async function removeFromBoards(db, uid) {
  const ref = db.collection('communityStats').doc('global');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    const lists = ['topShowsAttended', 'topSongsRated', 'topVenuesVisited'];
    const isMe = (e) => e && (e.userId === uid || e.odubleserId === uid);
    if (!lists.some((k) => (data[k] || []).some(isMe))) return;
    const update = {};
    for (const k of lists) update[k] = (data[k] || []).filter((e) => !isMe(e));
    tx.update(ref, update);
  });
}

module.exports = { rebuildAllStats, recomputeUserStats, userStatsDocs, showsByUser, removeFromBoards, yearInReviewUpdates, showsWithIdsByUser };
