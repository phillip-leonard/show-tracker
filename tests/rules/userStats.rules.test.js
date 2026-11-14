/**
 * Firestore rules for the server stats (5.59.15, B-05):
 *   userStats/{uid}        the owner and the admin read; nobody writes
 *   publicUserStats/{uid}  any signed-in user reads; nobody writes
 *   communityStats/global  anyone reads; nobody writes (unchanged)
 *
 * Run with:
 *   npm run test:rules
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'demo-user-stats-rules';
const ADMIN_EMAIL = 'phillip.leonard@gmail.com';

let testEnv;
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

const as = (uid) => testEnv.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
const admin = () => testEnv.authenticatedContext('uid_admin', { email: ADMIN_EMAIL, email_verified: true }).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const STATS = { showCount: 3, songCount: 20, ratedSongCount: 4, venueCount: 2, rank: 1, rankedOf: 5, ranked: true };

async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('userStats/alice').set({ ...STATS, bandCount: 2, topBands: [] });
    await db.doc('publicUserStats/alice').set({ showCount: 3, songCount: 20, ratedSongCount: 4, venueCount: 2, rank: 1, rankedOf: 5 });
    await db.doc('communityStats/global').set({ totalUsers: 5 });
  });

  await test('userStats: the owner reads their own; the admin reads anyone\'s', async () => {
    await assertSucceeds(as('alice').doc('userStats/alice').get());
    await assertSucceeds(admin().doc('userStats/alice').get());
  });

  await test('userStats: another user and a visitor cannot read it', async () => {
    await assertFails(as('bob').doc('userStats/alice').get());
    await assertFails(anon().doc('userStats/alice').get());
    await assertFails(as('bob').collection('userStats').get());
  });

  await test('publicUserStats: any signed-in user reads the public counts; a visitor does not', async () => {
    await assertSucceeds(as('bob').doc('publicUserStats/alice').get());
    await assertFails(anon().doc('publicUserStats/alice').get());
  });

  await test('nobody writes stats from a client, not even the owner or the admin', async () => {
    for (const ctx of [as('alice'), admin()]) {
      await assertFails(ctx.doc('userStats/alice').set({ ...STATS, showCount: 9999 }));
      await assertFails(ctx.doc('userStats/alice').update({ rank: 1 }));
      await assertFails(ctx.doc('publicUserStats/alice').set({ showCount: 9999 }));
      await assertFails(ctx.doc('userStats/alice').delete());
    }
    await assertFails(as('bob').doc('publicUserStats/bob').set({ showCount: 1 }));
  });

  await test('communityStats stays read-only and public', async () => {
    await assertSucceeds(anon().doc('communityStats/global').get());
    await assertFails(as('alice').doc('communityStats/global').set({ totalUsers: 1 }));
  });

  await test('old builds can still write their counts to their own profile (ignored by every reader)', async () => {
    await assertSucceeds(as('alice').doc('userProfiles/alice').set({ showCount: 3, songCount: 20, ratedSongCount: 4, venueCount: 2 }, { merge: true }));
  });

  await test('leaderboard opt-out: the owner sets showOnLeaderboard, only as a boolean (5.60.1)', async () => {
    await assertSucceeds(as('carol').doc('userProfiles/carol').set({ showOnLeaderboard: false }));
    await assertSucceeds(as('carol').doc('userProfiles/carol').update({ showOnLeaderboard: true }));
    await assertFails(as('carol').doc('userProfiles/carol').update({ showOnLeaderboard: 'no' }));
    await assertFails(as('dave').doc('userProfiles/dave').set({ showOnLeaderboard: 0 }));
    await assertFails(as('bob').doc('userProfiles/carol').update({ showOnLeaderboard: false }));
  });

  await testEnv.cleanup();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
