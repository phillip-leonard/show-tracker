/**
 * Firestore rules tests for pushTokens (v5.49.0): one doc per device that
 * takes push alerts, id = its FCM token, { userId, platform, updatedAt }.
 * Written by lib/pushAlerts.js; read and pruned by the followed-band job
 * through the Admin SDK, which these rules don't apply to.
 *
 * Run with:
 *   npm run test:rules
 *
 * (also run in CI by .github/workflows/rules-tests.yml). Nothing here
 * touches production.
 *
 * What the rule promises, and all of it is here:
 *   - a token is readable by its owner only, alone or in a query
 *   - a write must name the writer as owner, and carry only the three fields
 *   - only the owner can delete one
 *   - a token another account left behind on the same device can be taken
 *     over by the account now signed in there, and is then theirs alone
 *   - signed out, nothing
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
// The test contexts are the compat SDK, so the compat sentinel; the app's
// modular serverTimestamp() is the same value on the wire.
const firebase = require('firebase/compat/app').default;
require('firebase/compat/firestore');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'demo-push-token-rules';

const ALICE = 'uid_alice';
const BOB = 'uid_bob';
const ALICE_PHONE = 'fcm-token-alice-phone';
const ALICE_IPAD = 'fcm-token-alice-ipad';

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

const alice = () => testEnv.authenticatedContext(ALICE).firestore();
const bob = () => testEnv.authenticatedContext(BOB).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

// What lib/pushAlerts.js writes.
const tokenDoc = (userId) => ({ userId, platform: 'ios', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`pushTokens/${ALICE_PHONE}`).set({ userId: ALICE, platform: 'ios' });
    await db.doc(`pushTokens/${ALICE_IPAD}`).set({ userId: ALICE, platform: 'ios' });
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

  // ── Writing ────────────────────────────────────────────────────────────

  await seed();

  await test('a user can register their own device, exactly as the app writes it', async () => {
    await assertSucceeds(bob().doc('pushTokens/fcm-token-bob').set(tokenDoc(BOB)));
    // Launch and rotation rewrite the same doc.
    await assertSucceeds(bob().doc('pushTokens/fcm-token-bob').set(tokenDoc(BOB)));
  });

  await test('a user cannot register a device in someone else’s name', async () => {
    await assertFails(bob().doc('pushTokens/fcm-token-planted').set(tokenDoc(ALICE)));
  });

  await test('a token doc carries only userId, platform and updatedAt', async () => {
    await assertFails(bob().doc('pushTokens/fcm-token-bob2').set({ ...tokenDoc(BOB), email: 'bob@example.com' }));
    await assertFails(bob().doc('pushTokens/fcm-token-bob2').set({ ...tokenDoc(BOB), isAdmin: true }));
  });

  await test('signed out, nothing can be written', async () => {
    await assertFails(anon().doc('pushTokens/fcm-token-anon').set({ userId: '', platform: 'ios' }));
  });

  // ── Reading ────────────────────────────────────────────────────────────

  await seed();

  await test('the owner can read their tokens, one at a time or by query', async () => {
    await assertSucceeds(alice().doc(`pushTokens/${ALICE_PHONE}`).get());
    await assertSucceeds(alice().collection('pushTokens').where('userId', '==', ALICE).get());
  });

  await test('nobody else can read a token, or list the collection', async () => {
    await assertFails(bob().doc(`pushTokens/${ALICE_PHONE}`).get());
    await assertFails(bob().collection('pushTokens').get());
    await assertFails(bob().collection('pushTokens').where('userId', '==', ALICE).get());
    await assertFails(anon().doc(`pushTokens/${ALICE_PHONE}`).get());
  });

  // ── Deleting ───────────────────────────────────────────────────────────

  await seed();

  await test('nobody else can delete a token', async () => {
    await assertFails(bob().doc(`pushTokens/${ALICE_PHONE}`).delete());
    await assertFails(anon().doc(`pushTokens/${ALICE_PHONE}`).delete());
  });

  await test('the owner can delete their token (sign-out)', async () => {
    await assertSucceeds(alice().doc(`pushTokens/${ALICE_PHONE}`).delete());
  });

  await test('deleting a token that is already gone is refused, and the app ignores it', async () => {
    // lib/pushAlerts.js catches this: the job may have pruned the token, or
    // the account deletion removed it, before the app got there.
    await assertFails(alice().doc(`pushTokens/${ALICE_PHONE}`).delete());
  });

  // ── The same iPhone, a different account ───────────────────────────────

  await seed();

  await test('a token left behind by another account can be taken over, and is then the new owner’s alone', async () => {
    // Alice signed out offline, so her doc survived; Bob signs in on that
    // iPhone and gets the same FCM token back.
    await assertSucceeds(bob().doc(`pushTokens/${ALICE_PHONE}`).set(tokenDoc(BOB)));
    await assertSucceeds(bob().doc(`pushTokens/${ALICE_PHONE}`).get());
    await assertFails(alice().doc(`pushTokens/${ALICE_PHONE}`).get());
    await assertFails(alice().doc(`pushTokens/${ALICE_PHONE}`).delete());
  });

  await test('taking a token over still has to name yourself as owner', async () => {
    await assertFails(bob().doc(`pushTokens/${ALICE_IPAD}`).set(tokenDoc('uid_carol')));
    await assertFails(bob().doc(`pushTokens/${ALICE_IPAD}`).update({ platform: 'web' }));
  });

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
