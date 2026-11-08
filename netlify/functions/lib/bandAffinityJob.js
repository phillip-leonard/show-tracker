// netlify/functions/lib/bandAffinityJob.js
//
// The nightly band-affinity run behind Discover, "Fans of X also see…" and
// festival picks. Reads every account's follows and shows with the Admin
// SDK, hands them to lib/recommendations.js's aggregate() with no ids
// attached, and writes back counts only:
//
//   bandAffinity/{bandKey}   { name, fans, candidates: [{ key, name, co, pairScore }],
//                              updatedAt, version }
//   bandPopularity/all       { totalActiveUsers, bands: { key: { name, seen2 } },
//                              updatedAt, version }
//
// Every run is a full recompute. Documents for bands that no longer qualify
// are deleted, so an unfollow, a deleted show or a deleted account is gone
// from the shared data after the next run, and account deletion never has to
// touch these collections (there is nothing in them to find).
//
// Accounts the admin marked isTestUser (and the App Review account, which
// is one) are left out, as they are from the admin stats.
//
// Pure apart from `db`: tests/recommendations/bandAffinityJob.test.js runs
// it against the in-memory Firestore in tests/email/fakeFirestore.js.

const R = require('../../../lib/recommendations');

const AFFINITY = 'bandAffinity';
const POPULARITY = 'bandPopularity';
const POPULARITY_DOC = 'all';
const VERSION = 1;
// Firestore allows 500 writes per batch.
const BATCH_SIZE = 400;

async function loadUsers(db) {
  const profiles = await db.collection('userProfiles').select('favoriteArtists', 'isTestUser').get();
  const users = [];
  let skippedTest = 0;
  for (const doc of profiles.docs) {
    const p = doc.data() || {};
    if (p.isTestUser === true) { skippedTest++; continue; }
    const shows = await db.collection('users').doc(doc.id).collection('shows').select('artist', 'date').get();
    users.push({
      favorites: Array.isArray(p.favoriteArtists) ? p.favoriteArtists : [],
      shows: shows.docs.map((s) => {
        const d = s.data() || {};
        return { artist: d.artist, date: d.date };
      }),
    });
  }
  return { users, skippedTest };
}

/**
 * How many of these users would see at least one Discover suggestion, from
 * the data this run is about to publish. The number to watch while the user
 * base is small: it says whether MIN_CO_FANS / SEEN_THRESHOLD leave Discover
 * empty for most people.
 */
function coverage(users, affinity) {
  let withShows = 0;
  let withSuggestions = 0;
  for (const u of users) {
    if (!u.shows.length && !u.favorites.length) continue;
    withShows++;
    const bands = R.profileBands(u);
    const seeds = R.seedsFor(bands);
    if (R.recommend({ seeds, affinityDocs: affinity, bands, limit: 1 }).length) withSuggestions++;
  }
  return { withShows, withSuggestions };
}

async function commitInBatches(db, ops) {
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + BATCH_SIZE)) op(batch);
    await batch.commit();
  }
}

/**
 * runBandAffinityJob({ db, now, dryRun }) -> report
 * dryRun computes and reports without writing anything.
 */
async function runBandAffinityJob({ db, now = new Date(), dryRun = false }) {
  const started = Date.now();
  const { users, skippedTest } = await loadUsers(db);
  const agg = R.aggregate(users);
  const report = {
    ...agg.stats,
    skippedTest,
    popularBands: Object.keys(agg.popularity).length,
    ...coverage(users, agg.affinity),
    deleted: 0,
    dryRun,
  };
  if (dryRun) {
    report.ms = Date.now() - started;
    return report;
  }

  const existing = await db.collection(AFFINITY).select().get();
  const keep = new Set(Object.keys(agg.affinity));
  const ops = [];
  for (const [key, doc] of Object.entries(agg.affinity)) {
    const ref = db.collection(AFFINITY).doc(key);
    ops.push((b) => b.set(ref, { ...doc, updatedAt: now, version: VERSION }));
  }
  for (const doc of existing.docs) {
    if (!keep.has(doc.id)) {
      ops.push((b) => b.delete(doc.ref || db.collection(AFFINITY).doc(doc.id)));
      report.deleted++;
    }
  }
  const popRef = db.collection(POPULARITY).doc(POPULARITY_DOC);
  ops.push((b) => b.set(popRef, {
    totalActiveUsers: agg.totalActiveUsers,
    bands: agg.popularity,
    updatedAt: now,
    version: VERSION,
  }));
  await commitInBatches(db, ops);

  report.ms = Date.now() - started;
  return report;
}

module.exports = { runBandAffinityJob, coverage, AFFINITY, POPULARITY, POPULARITY_DOC, VERSION };
