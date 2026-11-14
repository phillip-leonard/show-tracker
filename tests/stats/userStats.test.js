/**
 * Server stats (5.59.15, B-05): the full rebuild, one user's recompute
 * with their rank, the recompute-my-stats function, and the parity report.
 *
 *   node tests/stats/userStats.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const path = require('path');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { rebuildAllStats, recomputeUserStats } = require('../../netlify/functions/lib/userStats');
const { parityReport } = require('../../scripts/backfill-user-stats');
const { parityReport: yearInReviewParity } = require('../../scripts/year-in-review-parity');
const { computeYearInReview } = require('../../lib/yearInReviewStats');
const { showsWithIdsByUser } = require('../../netlify/functions/lib/userStats');

function seed() {
  const db = createFakeDb();
  db._put('userProfiles/alice', { firstName: 'Alice', showCount: 999, venueCount: 999 }); // a forged / stale count
  db._put('userProfiles/bob', { firstName: 'Bob' });
  db._put('userProfiles/carol', { firstName: 'Carol' });
  db._put('userProfiles/qa', { firstName: 'QA', isTestUser: true });
  db._put('userProfiles/empty', { firstName: 'Empty' });
  const show = (uid, id, data) => db._put(`users/${uid}/shows/${id}`, data);
  show('alice', '1', { artist: 'Goose', venue: 'Red Rocks', city: 'Morrison', date: '2025-06-01', setlist: [{ name: 'Arcadia', rating: 9 }] });
  show('alice', '2', { artist: 'goose (US)', venue: 'red rocks', city: 'morrison', date: '02-06-2025', setlist: [] });
  show('alice', '3', { artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlist: [{ name: 'Tweezer' }] });
  show('bob', '1', { artist: 'Phish', venue: 'MSG', date: '2024-12-31' });
  show('bob', '2', { artist: 'Phish', venue: 'MSG', date: '2024-12-30' });
  show('bob', '3', { artist: 'Phish', venue: 'MSG', date: '2024-12-29' });
  show('carol', '1', { artist: 'Goose', venue: 'Red Rocks', date: '2025-06-01' });
  for (let i = 0; i < 10; i++) show('qa', String(i), { artist: 'Test', venue: 'Hall', date: '2025-01-01' });
  db._put('users/alice/upcomingShows/u1', { artist: 'Not a show', date: '2030-01-01' });
  return db;
}

test('rebuildAllStats: stats from the shows, ranks among real accounts, ties shared', async () => {
  const db = seed();
  const r = await rebuildAllStats(db);
  assert.strictEqual(r.users, 5);
  assert.strictEqual(r.ranked, 3, 'qa (test) and empty (no shows) are unranked');
  assert.strictEqual(r.shows, 17, 'upcomingShows are not shows');
  const alice = db._get('userStats/alice');
  assert.strictEqual(alice.showCount, 3, 'not the 999 the client wrote');
  assert.strictEqual(alice.bandCount, 2, 'Goose and goose (US) are one band');
  assert.strictEqual(alice.venueCount, 2);
  assert.deepStrictEqual([alice.rank, alice.rankedOf, alice.ranked], [1, 3, true], 'tied with bob at 3 shows');
  assert.deepStrictEqual([db._get('userStats/bob').rank, db._get('userStats/carol').rank], [1, 3]);
  assert.deepStrictEqual([db._get('userStats/qa').rank, db._get('userStats/qa').ranked], [null, false]);
  const pub = db._get('publicUserStats/alice');
  assert.deepStrictEqual(Object.keys(pub).sort(), ['computedAt', 'rank', 'rankedOf', 'ratedSongCount', 'showCount', 'songCount', 'statsVersion', 'venueCount']);
  const community = db._get('communityStats/global');
  assert.deepStrictEqual(community.topShowsAttended.map((u) => u.userId), ['alice', 'bob', 'carol']);
  assert.strictEqual(community.rankedCount, 3);
});

test('rebuildAllStats write:false computes and writes nothing (the dry run)', async () => {
  const db = seed();
  const r = await rebuildAllStats(db, { write: false });
  assert.strictEqual(r.written, 0);
  assert.strictEqual(db._get('userStats/alice'), undefined);
  assert.strictEqual(r.statsByUid.get('bob').showCount, 3);
});

test("recomputeUserStats: one user, ranked against everyone's stored numbers", async () => {
  const db = seed();
  await rebuildAllStats(db);
  db._put('users/carol/shows/2', { artist: 'Goose', venue: 'X', date: '2025-07-01' });
  db._put('users/carol/shows/3', { artist: 'Goose', venue: 'Y', date: '2025-07-02' });
  db._put('users/carol/shows/4', { artist: 'Goose', venue: 'Z', date: '2025-07-03' });
  const doc = await recomputeUserStats(db, 'carol');
  assert.strictEqual(doc.showCount, 4);
  assert.deepStrictEqual([doc.rank, doc.rankedOf], [1, 3]);
  assert.strictEqual(db._get('publicUserStats/carol').rank, 1);
  const qa = await recomputeUserStats(db, 'qa');
  assert.deepStrictEqual([qa.ranked, qa.rank], [false, null], 'a test user is never ranked');
});

test("recompute-my-stats: signed in only, rate-limited, returns the caller's stats", async () => {
  const db = seed();
  __setTestFirebase({ db, auth: createFakeAuth({ tokens: { alice: { uid: 'alice', email: 'a@example.com', email_verified: true } } }) });
  const fn = require(path.join(__dirname, '../../netlify/functions/recompute-my-stats.js'));
  const call = (token) => fn.handler({ httpMethod: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.strictEqual((await call(null)).statusCode, 401);
  assert.strictEqual((await call('forged')).statusCode, 401);
  const ok = await call('alice');
  assert.strictEqual(ok.statusCode, 200);
  assert.strictEqual(JSON.parse(ok.body).stats.showCount, 3);
  const day = new Date().toISOString().slice(0, 10);
  db._put(`rateLimits/stats_alice_${day}`, { count: 200, uid: 'alice' });
  assert.strictEqual((await call('alice')).statusCode, 429);
});

test('parity report: stale counters, definition changes and rank changes are told apart', async () => {
  const db = seed();
  const r = await rebuildAllStats(db, { write: false });
  const showsByUid = new Map();
  for (const [p, d] of db._store) {
    const parts = p.split('/');
    if (parts.length === 4 && parts[0] === 'users' && parts[2] === 'shows') {
      if (!showsByUid.has(parts[1])) showsByUid.set(parts[1], []);
      showsByUid.get(parts[1]).push(d);
    }
  }
  const report = parityReport({ ...r, showsByUid });
  assert.strictEqual(report.showCount['stored too high (stale counter)'], 1, "alice's 999");
  assert.strictEqual(report.bands['definition: artistNameKeyLoose'], 1);
  assert.strictEqual(report.rank['now unranked: test user'], 1);
  assert.strictEqual(report.rank['now unranked: no shows'], 1);
});

test('leaderboard opt-out: off the boards on the rebuild, still ranked; off at once on recompute (5.60.1)', async () => {
  const db = seed();
  await rebuildAllStats(db);
  assert.ok(db._get('communityStats/global').topShowsAttended.some((u) => u.userId === 'bob'));
  // Bob turns the setting off; his own recompute takes him off now.
  db._put('userProfiles/bob', { firstName: 'Bob', showOnLeaderboard: false });
  const bob = await recomputeUserStats(db, 'bob');
  assert.strictEqual(bob.rank, 1, 'rank unchanged');
  const now = db._get('communityStats/global');
  for (const k of ['topShowsAttended', 'topSongsRated', 'topVenuesVisited']) {
    assert.ok(!(now[k] || []).some((u) => u.userId === 'bob'), k);
  }
  // The next rebuild leaves him off too, and still ranks him.
  await rebuildAllStats(db);
  assert.ok(!db._get('communityStats/global').topShowsAttended.some((u) => u.userId === 'bob'));
  assert.strictEqual(db._get('userStats/bob').rank, 1);
  // Back on: listed again on the next rebuild.
  db._put('userProfiles/bob', { firstName: 'Bob', showOnLeaderboard: true });
  await rebuildAllStats(db);
  assert.ok(db._get('communityStats/global').topShowsAttended.some((u) => u.userId === 'bob'));
});

// ── Year in Review: the public copy is the server's (5.60.4) ──────────

test('rebuildAllStats: every existing review gets the server\'s numbers; no review is created', async () => {
  const db = seed();
  // A review alice's old client wrote, with its own (forged or stale) numbers.
  db._put('yearInReviews/alice_2025', { userId: 'alice', year: 2025, privacy: 'public', stats: { totalShows: 99, totalArtists: 99 } });
  const r = await rebuildAllStats(db);
  const stored = db._get('yearInReviews/alice_2025');
  assert.strictEqual(stored.privacy, 'public', 'privacy is the owner\'s and untouched');
  assert.strictEqual(stored.stats.totalShows, 2);
  assert.strictEqual(stored.stats.totalArtists, 1, '"Goose" and "goose (US)" are one band');
  assert.deepStrictEqual(stored.stats, JSON.parse(JSON.stringify(computeYearInReview([
    { id: '1', ...db._get('users/alice/shows/1') }, { id: '2', ...db._get('users/alice/shows/2') }, { id: '3', ...db._get('users/alice/shows/3') },
  ], 2025))));
  assert.ok(stored.statsComputedAt);
  assert.deepStrictEqual(r.yearInReviews, { docs: 1, changed: 1, written: 1 });
  assert.strictEqual(db._get('yearInReviews/bob_2024'), undefined, 'no review is created for anyone');
});

test('rebuildAllStats: a second run changes nothing (idempotent)', async () => {
  const db = seed();
  db._put('yearInReviews/alice_2025', { userId: 'alice', year: 2025, privacy: 'public' });
  await rebuildAllStats(db);
  const writes = db._writes.filter(([, p]) => p.startsWith('yearInReviews/')).length;
  const r = await rebuildAllStats(db);
  assert.strictEqual(r.yearInReviews.changed, 0);
  assert.strictEqual(db._writes.filter(([, p]) => p.startsWith('yearInReviews/')).length, writes);
});

test('rebuildAllStats: a review filed under someone else\'s id is never filled in', async () => {
  const db = seed();
  db._put('yearInReviews/bob_2025', { userId: 'alice', year: 2025, privacy: 'public', stats: { totalShows: 1 } });
  const r = await rebuildAllStats(db);
  assert.deepStrictEqual(db._get('yearInReviews/bob_2025').stats, { totalShows: 1 });
  assert.strictEqual(r.yearInReviews.changed, 0);
});

test('rebuildAllStats: a year with no shows left gets stats: null; write:false writes no review', async () => {
  const db = seed();
  db._put('yearInReviews/carol_2019', { userId: 'carol', year: 2019, privacy: 'public', stats: { totalShows: 4 } });
  const dry = await rebuildAllStats(db, { write: false });
  assert.strictEqual(dry.yearInReviews.changed, 1);
  assert.deepStrictEqual(db._get('yearInReviews/carol_2019').stats, { totalShows: 4 }, 'the dry run wrote nothing');
  await rebuildAllStats(db);
  assert.strictEqual(db._get('yearInReviews/carol_2019').stats, null);
});

test('recomputeUserStats: refreshes the caller\'s own reviews, and only theirs', async () => {
  const db = seed();
  db._put('yearInReviews/bob_2024', { userId: 'bob', year: 2024, privacy: 'public', stats: { totalShows: 1 } });
  db._put('yearInReviews/alice_2025', { userId: 'alice', year: 2025, privacy: 'public', stats: { totalShows: 99 } });
  db._put('users/bob/shows/4', { artist: 'Phish', venue: 'MSG', date: '2024-12-28', city: 'New York' });
  await recomputeUserStats(db, 'bob');
  assert.strictEqual(db._get('yearInReviews/bob_2024').stats.totalShows, 4);
  assert.strictEqual(db._get('yearInReviews/alice_2025').stats.totalShows, 99, 'someone else\'s waits for their own recompute');
});

test('a show with no city never puts an undefined into a review', async () => {
  const db = seed();
  db._put('yearInReviews/bob_2024', { userId: 'bob', year: 2024, privacy: 'public' });
  db._put('users/bob/shows/9', { artist: 'Phish', venue: 'MSG', date: '2024-12-31', rating: 9 });
  await recomputeUserStats(db, 'bob');
  const walk = (v) => (v && typeof v === 'object' ? Object.values(v).forEach(walk) : assert.notStrictEqual(v, undefined));
  walk(db._get('yearInReviews/bob_2024').stats);
});

test('year-in-review parity report: one merged spelling counts one band fewer, and the recap agrees after', () => {
  const db = seed();
  const byUid = showsWithIdsByUser({ docs: [...db._store.keys()].filter((p) => /^users\/[^/]+\/shows\/[^/]+$/.test(p)).map((p) => ({ id: p.split('/').pop(), ref: { path: p }, data: () => db._get(p) })) });
  const r = yearInReviewParity(byUid);
  assert.strictEqual(r.users, 4);
  assert.strictEqual(r.bandCount.fewer, 1, 'alice 2025: "Goose" and "goose (US)"');
  assert.strictEqual(r.recapDisagreedBefore, 1);
  assert.strictEqual(r.recapDisagreesAfter, 0);
});

run('Server stats (5.59.15, Year in Review 5.60.4)');
