/**
 * The nightly band-affinity job (netlify/functions/lib/bandAffinityJob.js)
 * against an in-memory Firestore:
 *   - writes bandAffinity/* and bandPopularity/all, counts only
 *   - leaves test accounts out
 *   - deletes docs for bands that stopped qualifying (unfollows, deleted
 *     accounts), so account deletion never has to touch these collections
 *   - a dry run writes nothing
 *
 *   node tests/recommendations/bandAffinityJob.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb } = require('../email/fakeFirestore');
const { runBandAffinityJob } = require('../../netlify/functions/lib/bandAffinityJob');

function addUser(db, uid, { favorites = [], shows = [], isTestUser = false } = {}) {
  db._put(`userProfiles/${uid}`, {
    email: `${uid}@example.com`,
    firstName: uid,
    favoriteArtists: favorites.map((name) => ({ name })),
    ...(isTestUser ? { isTestUser: true } : {}),
  });
  shows.forEach((s, i) => db._put(`users/${uid}/shows/${uid}-s${i}`, { userId: uid, ...s }));
}
function saw(artist, times) {
  return Array.from({ length: times }, (_, i) => ({ artist, date: `2024-02-${String(i + 1).padStart(2, '0')}`, venue: 'Somewhere' }));
}
function world(db) {
  for (let i = 0; i < 4; i++) {
    addUser(db, `fan${i}`, { favorites: ['Goose'], shows: [...saw('Goose', 2), ...saw('Niche', 2)] });
  }
  for (let i = 0; i < 3; i++) addUser(db, `other${i}`, { shows: saw('Phish', 2) });
}

test('writes affinity and popularity with counts only', async () => {
  const db = createFakeDb();
  world(db);
  const report = await runBandAffinityJob({ db, now: new Date('2026-11-07T14:00:00Z') });

  const goose = db._get('bandAffinity/goose');
  assert.strictEqual(goose.fans, 4);
  assert.deepStrictEqual(goose.candidates.map((c) => [c.key, c.co]), [['niche', 4]]);
  const pop = db._get('bandPopularity/all');
  assert.strictEqual(pop.totalActiveUsers, 7);
  assert.strictEqual(pop.bands.phish.seen2, 3);

  const everything = JSON.stringify(db._list('bandAffinity').concat(db._list('bandPopularity')));
  for (const leak of ['fan0', 'other0', '@example.com', 'Somewhere', 'userId']) {
    assert.ok(!everything.includes(leak), `found "${leak}" in shared data`);
  }
  assert.strictEqual(report.affinityDocs, 2); // goose and niche
  assert.strictEqual(report.withShows, 7);
  assert.strictEqual(report.withSuggestions, 0); // every fan has already seen Niche
});

test('test accounts are left out', async () => {
  const db = createFakeDb();
  world(db);
  addUser(db, 'reviewer', { isTestUser: true, favorites: ['Goose'], shows: [...saw('Goose', 2), ...saw('Niche', 2)] });
  const report = await runBandAffinityJob({ db });
  assert.strictEqual(db._get('bandAffinity/goose').fans, 4);
  assert.strictEqual(report.skippedTest, 1);
});

test('a deleted account drops a pair below the floor and its doc is deleted', async () => {
  const db = createFakeDb();
  for (let i = 0; i < 3; i++) addUser(db, `fan${i}`, { shows: [...saw('Goose', 2), ...saw('Niche', 2)] });
  await runBandAffinityJob({ db });
  assert.ok(db._get('bandAffinity/goose'));

  // fan2 deletes their account (lib/userDataPurge.js removes these docs).
  db._store.delete('userProfiles/fan2');
  db._store.delete('users/fan2/shows/fan2-s0');
  const report = await runBandAffinityJob({ db });
  assert.strictEqual(db._get('bandAffinity/goose'), undefined);
  assert.strictEqual(db._get('bandAffinity/niche'), undefined);
  assert.strictEqual(report.deleted, 2);
  assert.deepStrictEqual(db._get('bandPopularity/all').bands, {});
});

test('a user who would get suggestions is counted in the report', async () => {
  const db = createFakeDb();
  world(db);
  addUser(db, 'newbie', { favorites: ['Goose'] });
  const report = await runBandAffinityJob({ db });
  assert.strictEqual(report.withSuggestions, 1);
});

test('a dry run writes nothing', async () => {
  const db = createFakeDb();
  world(db);
  const before = db._writes.length;
  const report = await runBandAffinityJob({ db, dryRun: true });
  assert.strictEqual(db._writes.length, before);
  assert.strictEqual(report.affinityDocs, 2);
});

run('band affinity job');
