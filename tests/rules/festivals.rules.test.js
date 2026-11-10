/**
 * Firestore rules tests for when a shared festival happened (5.58.0):
 *
 *   festivals/{id}  either both dates, or only the year
 *
 * Run with:
 *   npm run test:rules
 *
 * (also run in CI by .github/workflows/rules-tests.yml). Nothing here
 * touches production.
 *
 * What the rules promise, and all of it is here:
 *   - a festival can be created with both dates, as every client before
 *     5.58.0 creates it (no `year` field), or with both dates and a
 *     matching `year`, as 5.58.0 does
 *   - a festival can be created with only a year, a whole number from
 *     1900 to 2100
 *   - never one date without the other, never neither dates nor a year,
 *     never a year that disagrees with the start date
 *   - the creator can move a festival between the two in either direction
 *   - the lineup fields still can't be written by any client
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app').default;
require('firebase/compat/firestore');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'demo-festival-rules';

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
const now = () => firebase.firestore.FieldValue.serverTimestamp();
const del = () => firebase.firestore.FieldValue.delete();

// As createFestival in context/AppContext.jsx writes them.
const BASE = {
  name: 'Bonnaroo',
  nameNormalized: 'bonnaroo',
  location: 'Manchester, TN',
  edition: '',
  createdBy: ALICE,
};
const DATED_OLD = { ...BASE, startDate: '2019-06-13', endDate: '2019-06-16' }; // before 5.58.0
const DATED = { ...DATED_OLD, year: 2019 };
const YEAR_ONLY = { ...BASE, year: 2019 };

const create = (db, id, data) => db.doc(`festivals/${id}`).set({ ...data, createdAt: now(), updatedAt: now() });

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('festivals/dated').set(DATED);
    await db.doc('festivals/yearOnly').set(YEAR_ONLY);
    await db.doc('festivals/yearOnlyWithLineup').set({
      ...YEAR_ONLY,
      lineup: ['Goose'],
      lineupSource: 'seed',
      lineupUrl: null,
      lineupFetchedAt: new Date('2019-05-01T12:00:00Z'),
    });
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

  console.log('\nfestival date rules');

  await seed();

  // ── Create ─────────────────────────────────────────────────────────────

  await test('a festival with both dates and no year still creates (clients before 5.58.0)', async () => {
    await assertSucceeds(create(alice(), 'a1', DATED_OLD));
  });

  await test('a festival with both dates and a matching year creates', async () => {
    await assertSucceeds(create(alice(), 'a2', DATED));
  });

  await test('a festival with only a year creates', async () => {
    await assertSucceeds(create(alice(), 'a3', YEAR_ONLY));
    await assertSucceeds(create(alice(), 'a4', { ...YEAR_ONLY, year: 1900 }));
    await assertSucceeds(create(alice(), 'a5', { ...YEAR_ONLY, year: 2100 }));
  });

  await test('a year that disagrees with the start date is refused', async () => {
    await assertFails(create(alice(), 'b1', { ...DATED, year: 2020 }));
  });

  await test('a year outside 1900–2100, or not a whole number, is refused', async () => {
    await assertFails(create(alice(), 'b2', { ...YEAR_ONLY, year: 1899 }));
    await assertFails(create(alice(), 'b3', { ...YEAR_ONLY, year: 2101 }));
    await assertFails(create(alice(), 'b4', { ...YEAR_ONLY, year: '2019' }));
    await assertFails(create(alice(), 'b5', { ...YEAR_ONLY, year: 2019.5 }));
  });

  await test('one date without the other is refused', async () => {
    await assertFails(create(alice(), 'c1', { ...BASE, startDate: '2019-06-13' }));
    await assertFails(create(alice(), 'c2', { ...BASE, startDate: '2019-06-13', year: 2019 }));
    await assertFails(create(alice(), 'c3', { ...BASE, endDate: '2019-06-16', year: 2019 }));
  });

  await test('neither dates nor a year is refused', async () => {
    await assertFails(create(alice(), 'c4', BASE));
  });

  await test('null dates are not the same as no dates', async () => {
    await assertFails(create(alice(), 'c5', { ...YEAR_ONLY, startDate: null, endDate: null }));
  });

  await test('the date checks that were there before still hold', async () => {
    await assertFails(create(alice(), 'd1', { ...DATED_OLD, endDate: '2019-06-12' }));
    await assertFails(create(alice(), 'd2', { ...DATED_OLD, startDate: '13-06-2019' }));
  });

  await test('another user cannot create a festival in Alice\'s name', async () => {
    await assertFails(create(bob(), 'e1', YEAR_ONLY));
  });

  // ── Update ─────────────────────────────────────────────────────────────

  await test('the creator can turn a dated festival into a year-only one', async () => {
    await assertSucceeds(alice().doc('festivals/dated').update({
      startDate: del(), endDate: del(), year: 2019, updatedAt: now(),
    }));
  });

  await seed();

  await test('the creator can add dates to a year-only festival', async () => {
    await assertSucceeds(alice().doc('festivals/yearOnly').update({
      startDate: '2019-06-13', endDate: '2019-06-16', updatedAt: now(),
    }));
  });

  await seed();

  await test('the creator can change the year of a year-only festival', async () => {
    await assertSucceeds(alice().doc('festivals/yearOnly').update({ year: 2018, updatedAt: now() }));
  });

  await test('an edit cannot leave one date or no year behind', async () => {
    await assertFails(alice().doc('festivals/dated').update({ endDate: del(), updatedAt: now() }));
    await assertFails(alice().doc('festivals/yearOnly').update({ year: del(), updatedAt: now() }));
    await assertFails(alice().doc('festivals/yearOnly').update({ startDate: '2019-06-13', updatedAt: now() }));
    await assertFails(alice().doc('festivals/dated').update({ year: 2020, updatedAt: now() }));
  });

  await test('another attendee cannot change a year-only festival', async () => {
    await assertFails(bob().doc('festivals/yearOnly').update({ year: 2018, updatedAt: now() }));
  });

  await test('the admin can edit a year-only festival', async () => {
    await assertSucceeds(admin().doc('festivals/yearOnly').update({ location: 'Great Stage Park', updatedAt: now() }));
  });

  await test('a year-only festival\'s lineup still can\'t be written by a client', async () => {
    await assertSucceeds(alice().doc('festivals/yearOnlyWithLineup').update({ location: 'Elsewhere', updatedAt: now() }));
    await assertFails(alice().doc('festivals/yearOnlyWithLineup').update({ lineup: ['Typed'] }));
    await assertFails(admin().doc('festivals/yearOnlyWithLineup').update({ lineupSource: 'manual' }));
  });

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
