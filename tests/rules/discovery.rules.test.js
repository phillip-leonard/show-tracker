/**
 * Firestore rules tests for music discovery:
 *
 *   bandAffinity/{bandKey}, bandPopularity/{docId}
 *       counts written by the nightly job (netlify/functions/band-affinity.js)
 *       through the Admin SDK, which these rules don't apply to
 *   users/{uid}/discover/{docId}
 *       the user's "not interested" list (lib/discover.js)
 *   festivals/{id} lineup fields
 *       written only by netlify/functions/festival-lineup.js (Admin SDK)
 *
 * Run with:
 *   npm run test:rules
 *
 * (also run in CI by .github/workflows/rules-tests.yml). Nothing here
 * touches production.
 *
 * What the rules promise, and all of it is here:
 *   - the shared counts are readable when signed in, and no client can write them
 *   - a user's dismissals are theirs alone
 *   - a festival's creator can still edit it once it has a lineup
 *   - no client, creator and admin included, can add, change or remove a lineup
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
// The test contexts are the compat SDK, so the compat sentinels; the app's
// modular serverTimestamp() and arrayUnion() are the same values on the wire.
const firebase = require('firebase/compat/app').default;
require('firebase/compat/firestore');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'demo-discovery-rules';

const ALICE = 'uid_alice';
const BOB = 'uid_bob';
const ADMIN = 'uid_admin';
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

const alice = () => testEnv.authenticatedContext(ALICE, { email: 'alice@example.com' }).firestore();
const bob = () => testEnv.authenticatedContext(BOB, { email: 'bob@example.com' }).firestore();
const admin = () => testEnv.authenticatedContext(ADMIN, { email: ADMIN_EMAIL }).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const now = () => firebase.firestore.FieldValue.serverTimestamp();

const AFFINITY = { name: 'Goose', fans: 9, candidates: [{ key: 'niche', name: 'Niche', co: 6, pairScore: 0.9 }], version: 1 };
const POPULARITY = { totalActiveUsers: 30, bands: { phish: { name: 'Phish', seen2: 20 } }, version: 1 };

// A canonical festival as the app creates it (createFestival in
// context/AppContext.jsx), Alice's.
const FESTIVAL = {
  name: 'Bonnaroo 2027',
  nameNormalized: 'bonnaroo',
  startDate: '2027-06-10',
  endDate: '2027-06-13',
  location: 'Manchester, TN',
  edition: '',
  createdBy: ALICE,
};
// What festival-lineup.js adds.
const LINEUP = {
  lineup: ['Goose', "Umphrey's McGee"],
  lineupSource: 'ticketmaster',
  lineupUrl: 'https://www.ticketmaster.com/event/abc',
  lineupFetchedAt: new Date('2027-05-01T12:00:00Z'),
};

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('bandAffinity/goose').set(AFFINITY);
    await db.doc('bandPopularity/all').set(POPULARITY);
    await db.doc(`users/${ALICE}/discover/prefs`).set({ dismissed: ['phish'] });
    await db.doc('festivals/withLineup').set({ ...FESTIVAL, ...LINEUP });
    await db.doc('festivals/noLineup').set(FESTIVAL);
  });
}

async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  console.log('\ndiscovery rules');

  // ── Shared counts ──────────────────────────────────────────────────────

  await seed();

  await test('a signed-in user can read the affinity and popularity docs', async () => {
    await assertSucceeds(alice().doc('bandAffinity/goose').get());
    await assertSucceeds(alice().doc('bandPopularity/all').get());
    // A band with no doc reads as "missing", not as an error: Discover
    // skips that seed silently.
    await assertSucceeds(alice().doc('bandAffinity/nobody').get());
  });

  await test('signed out, the counts are not readable', async () => {
    await assertFails(anon().doc('bandAffinity/goose').get());
    await assertFails(anon().doc('bandPopularity/all').get());
  });

  await test('no client can write the counts, not even the admin', async () => {
    for (const db of [alice(), admin()]) {
      await assertFails(db.doc('bandAffinity/goose').set({ ...AFFINITY, fans: 999 }));
      await assertFails(db.doc('bandAffinity/goose').update({ fans: 999 }));
      await assertFails(db.doc('bandAffinity/goose').delete());
      await assertFails(db.doc('bandAffinity/newband').set(AFFINITY));
      await assertFails(db.doc('bandPopularity/all').update({ totalActiveUsers: 1 }));
      await assertFails(db.doc('bandPopularity/all').delete());
    }
  });

  // ── Dismissals ─────────────────────────────────────────────────────────

  await test('a user can read and change their own dismissals', async () => {
    await assertSucceeds(alice().doc(`users/${ALICE}/discover/prefs`).get());
    await assertSucceeds(alice().doc(`users/${ALICE}/discover/prefs`).set(
      { dismissed: firebase.firestore.FieldValue.arrayUnion('niche') }, { merge: true }
    ));
    await assertSucceeds(alice().doc(`users/${ALICE}/discover/prefs`).set(
      { dismissed: firebase.firestore.FieldValue.arrayRemove('phish') }, { merge: true }
    ));
  });

  await test('a first dismissal creates the doc', async () => {
    await assertSucceeds(bob().doc(`users/${BOB}/discover/prefs`).set(
      { dismissed: firebase.firestore.FieldValue.arrayUnion('niche') }, { merge: true }
    ));
  });

  await test("nobody else can read or change someone's dismissals", async () => {
    await assertFails(bob().doc(`users/${ALICE}/discover/prefs`).get());
    await assertFails(bob().doc(`users/${ALICE}/discover/prefs`).set({ dismissed: [] }));
    await assertFails(anon().doc(`users/${ALICE}/discover/prefs`).get());
  });

  // ── Festival lineups ───────────────────────────────────────────────────

  await seed();

  await test('the creator can still edit a festival that has a lineup', async () => {
    // updateFestivalData sends only the changed fields plus updatedAt.
    await assertSucceeds(alice().doc('festivals/withLineup').update({
      name: 'Bonnaroo Music & Arts 2027', nameNormalized: 'bonnaroo music and arts', updatedAt: now(),
    }));
    await assertSucceeds(alice().doc('festivals/withLineup').update({ location: 'Manchester, Tennessee', updatedAt: now() }));
  });

  await test('the creator can still edit a festival with no lineup', async () => {
    await assertSucceeds(alice().doc('festivals/noLineup').update({ location: 'Great Stage Park', updatedAt: now() }));
  });

  await test('anyone can read the lineup when signed in', async () => {
    await assertSucceeds(bob().doc('festivals/withLineup').get());
  });

  await test('the creator cannot change, add or remove a lineup', async () => {
    const db = alice();
    await assertFails(db.doc('festivals/withLineup').update({ lineup: ['Somebody Typed This'] }));
    await assertFails(db.doc('festivals/withLineup').update({ lineupUrl: 'https://example.com' }));
    await assertFails(db.doc('festivals/withLineup').update({ lineupSource: 'manual' }));
    await assertFails(db.doc('festivals/withLineup').update({ lineupFetchedAt: now() }));
    await assertFails(db.doc('festivals/withLineup').update({ lineup: firebase.firestore.FieldValue.delete() }));
    await assertFails(db.doc('festivals/noLineup').update({ lineup: ['Somebody Typed This'] }));
    // An edit that carries a lineup change along with an allowed one.
    await assertFails(db.doc('festivals/withLineup').update({ location: 'Elsewhere', lineup: [] }));
  });

  await test('the admin cannot change a lineup from a client either', async () => {
    await assertFails(admin().doc('festivals/withLineup').update({ lineup: ['Admin Typed This'] }));
    await assertSucceeds(admin().doc('festivals/withLineup').update({ location: 'Manchester, TN', updatedAt: now() }));
  });

  await test('another attendee cannot change the festival or its lineup', async () => {
    await assertFails(bob().doc('festivals/withLineup').update({ name: 'Bobnaroo', updatedAt: now() }));
    await assertFails(bob().doc('festivals/withLineup').update({ lineup: [] }));
  });

  await test('a new festival cannot be created with a lineup', async () => {
    await assertFails(alice().doc('festivals/brandNew').set({
      ...FESTIVAL, ...LINEUP, lineupFetchedAt: now(), createdAt: now(), updatedAt: now(),
    }));
    await assertSucceeds(alice().doc('festivals/brandNew').set({ ...FESTIVAL, createdAt: now(), updatedAt: now() }));
  });

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
