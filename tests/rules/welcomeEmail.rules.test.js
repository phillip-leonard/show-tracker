/**
 * Firestore rules tests for userProfiles/{uid}.welcomeEmail (5.55.0): the
 * server's record of the one welcome email, written only by
 * netlify/functions/lib/welcomeEmail.js through the Admin SDK.
 *
 * Run with:
 *   npm run test:rules
 *
 * What the rule promises:
 *   - an owner can't create their profile carrying welcomeEmail
 *   - an owner can't set, change or delete it, so they can't get it resent
 *   - the profile writes the app makes (updateUserProfile's stats) still work
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

const PROJECT_ID = 'demo-welcome-email-rules';
const ALICE = 'uid_alice';
const NEWBIE = 'uid_newbie';

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

const as = (uid) => testEnv.authenticatedContext(uid).firestore();

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`userProfiles/${ALICE}`).set({
      email: 'alice@example.com', showCount: 1,
      welcomeEmail: { status: 'sent', attempts: 1 },
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

  await seed();

  await test('a new profile cannot arrive carrying welcomeEmail', async () => {
    await assertFails(as(NEWBIE).doc(`userProfiles/${NEWBIE}`).set({ email: 'n@example.com', welcomeEmail: { status: 'sent' } }));
    await assertSucceeds(as(NEWBIE).doc(`userProfiles/${NEWBIE}`).set({ showCount: 0 }));
  });

  await test('an owner cannot set welcomeEmail on their profile', async () => {
    await assertFails(as(NEWBIE).doc(`userProfiles/${NEWBIE}`).set({ welcomeEmail: { status: 'skipped_opt_out' } }, { merge: true }));
  });

  await test('an owner cannot clear or change welcomeEmail to get it resent', async () => {
    await assertFails(as(ALICE).doc(`userProfiles/${ALICE}`).update({ welcomeEmail: firebase.firestore.FieldValue.delete() }));
    await assertFails(as(ALICE).doc(`userProfiles/${ALICE}`).update({ welcomeEmail: { status: 'failed', attempts: 1 } }));
  });

  await test('the app’s own profile writes still go through', async () => {
    await assertSucceeds(as(ALICE).doc(`userProfiles/${ALICE}`).set({
      showCount: 2, songCount: 30,
      lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }));
  });

  await testEnv.cleanup();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
