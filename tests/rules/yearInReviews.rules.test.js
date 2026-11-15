/**
 * Firestore rules for Year in Review documents (5.60.4):
 *   yearInReviews/{uid}_{year}
 *     - read: the owner, or any signed-in user when privacy is 'public'
 *     - create/update: the owner, only under their own `${uid}_${year}` id,
 *       and userId and year never change
 *     - delete: nobody
 *
 * Until 5.60.4 anyone signed in could create {someoneElse}_{year} with
 * their own userId, and a public one showed their numbers at the other
 * person's review address. Each block attacks that, then runs the writes
 * the app still makes (this build's privacy toggle, and iOS 3.13.19 and
 * earlier, which still write `stats` on every visit), so a rule that is
 * too tight fails here too.
 *
 * Run with:
 *   npm run test:rules
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

const PROJECT_ID = 'demo-year-in-review-rules';

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
const anon = () => testEnv.unauthenticatedContext().firestore();
const ts = () => firebase.firestore.FieldValue.serverTimestamp();
const STATS = { year: 2025, totalShows: 3, totalArtists: 2, totalVenues: 2 };

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
    await db.doc('yearInReviews/alice_2025').set({ userId: 'alice', year: 2025, privacy: 'public', stats: STATS });
    await db.doc('yearInReviews/alice_2024').set({ userId: 'alice', year: 2024, privacy: 'private', stats: STATS });
  });

  await test('read: a public review by any signed-in user; a private one by the owner only', async () => {
    await assertSucceeds(as('bob').doc('yearInReviews/alice_2025').get());
    await assertSucceeds(as('alice').doc('yearInReviews/alice_2024').get());
    await assertFails(as('bob').doc('yearInReviews/alice_2024').get());
    await assertFails(anon().doc('yearInReviews/alice_2025').get());
  });

  await test('create: nobody files a review under someone else’s id', async () => {
    await assertFails(as('mallory').doc('yearInReviews/bob_2025').set({ userId: 'mallory', year: 2025, privacy: 'public', stats: STATS }));
    await assertFails(as('mallory').doc('yearInReviews/bob_2025').set({ userId: 'bob', year: 2025, privacy: 'public' }));
    await assertFails(as('mallory').doc('yearInReviews/mallory_2024').set({ userId: 'mallory', year: 2025, privacy: 'public' }), 'id year must match');
    await assertFails(as('mallory').doc('yearInReviews/whatever').set({ userId: 'mallory', year: 2025 }));
  });

  await test('create: this build’s privacy toggle makes the owner’s own review', async () => {
    await assertSucceeds(as('bob').doc('yearInReviews/bob_2025').set({ userId: 'bob', year: 2025, generatedDate: ts(), privacy: 'public' }, { merge: true }));
  });

  await test('create and update: what iOS 3.13.19 and earlier write on every visit still passes', async () => {
    await assertSucceeds(as('carol').doc('yearInReviews/carol_2025').set({ userId: 'carol', year: 2025, generatedDate: ts(), stats: STATS }, { merge: true }));
    await assertSucceeds(as('carol').doc('yearInReviews/carol_2025').set({ userId: 'carol', year: 2025, generatedDate: ts(), stats: { ...STATS, totalShows: 4 } }, { merge: true }));
    await assertSucceeds(as('carol').doc('yearInReviews/carol_2025').set({ privacy: 'public' }, { merge: true }), 'the old toggle wrote privacy alone');
  });

  await test('update: userId and year never change; nobody else updates', async () => {
    await assertFails(as('alice').doc('yearInReviews/alice_2025').update({ userId: 'bob' }));
    await assertFails(as('alice').doc('yearInReviews/alice_2025').update({ year: 2024 }));
    await assertFails(as('bob').doc('yearInReviews/alice_2025').update({ privacy: 'private' }));
    await assertSucceeds(as('alice').doc('yearInReviews/alice_2025').update({ privacy: 'private' }));
  });

  await test('recap (5.60.16): the server writes it; no client creates, changes or removes it', async () => {
    const RECAP = { year: 2025, totalShows: 3 };
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('yearInReviews/dave_2025').set({ userId: 'dave', year: 2025, privacy: 'private', stats: STATS, recap: RECAP });
    });
    await assertFails(as('erin').doc('yearInReviews/erin_2025').set({ userId: 'erin', year: 2025, recap: RECAP }), 'create with a recap');
    await assertFails(as('dave').doc('yearInReviews/dave_2025').update({ recap: { ...RECAP, totalShows: 99 } }), 'change it');
    await assertFails(as('dave').doc('yearInReviews/dave_2025').update({ recap: firebase.firestore.FieldValue.delete() }), 'remove it');
    await assertFails(as('dave').doc('yearInReviews/dave_2025').set({ userId: 'dave', year: 2025 }), 'a full overwrite would drop it');
    // What every app version writes (merge, no recap) still passes on a document that has one.
    await assertSucceeds(as('dave').doc('yearInReviews/dave_2025').set({ userId: 'dave', year: 2025, generatedDate: ts(), privacy: 'public' }, { merge: true }));
    await assertSucceeds(as('dave').doc('yearInReviews/dave_2025').set({ userId: 'dave', year: 2025, generatedDate: ts(), stats: STATS }, { merge: true }));
    await assertSucceeds(as('dave').doc('yearInReviews/dave_2025').get());
  });

  await test('delete: nobody', async () => {
    await assertFails(as('alice').doc('yearInReviews/alice_2025').delete());
  });

  await testEnv.cleanup();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
