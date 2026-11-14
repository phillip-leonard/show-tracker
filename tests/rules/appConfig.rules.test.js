/**
 * Firestore rules tests for config/app (5.59.10): the iOS minimum and
 * latest versions read by components/layout/VersionGate.jsx.
 *
 *   - anyone reads it, signed in or not
 *   - only the admin writes it, only in the documented shape
 *   - nobody deletes it from a client
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

const PROJECT_ID = 'demo-app-config-rules';
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

const admin = () => testEnv.authenticatedContext('uid_admin', { email: ADMIN_EMAIL }).firestore();
const alice = () => testEnv.authenticatedContext('uid_alice', { email: 'alice@example.com' }).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const ts = () => firebase.firestore.FieldValue.serverTimestamp();
const GOOD = { minSupportedIosVersion: '3.13.7', latestIosVersion: '3.13.10' };

async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
  // One ctx.firestore() per context: a second call throws "Firestore has
  // already been started".
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('config/app').set(GOOD);
    await db.doc('config/other').set({ secret: true });
  });

  await test('anyone reads config/app, signed in or not', async () => {
    await assertSucceeds(anon().doc('config/app').get());
    await assertSucceeds(alice().doc('config/app').get());
  });

  await test('other config docs are not opened up', async () => {
    await assertFails(anon().doc('config/other').get());
    await assertFails(alice().doc('config/other').get());
  });

  await test('the admin saves both versions, with a reason and stamp', async () => {
    await assertSucceeds(admin().doc('config/app').set({
      ...GOOD, latestIosVersion: '3.14', reason: 'Fixes sign-in.', updatedAt: ts(), updatedBy: 'uid_admin',
    }));
    await assertSucceeds(admin().doc('config/app').update({ minSupportedIosVersion: '3.13.10' }));
  });

  await test('nobody else writes it', async () => {
    await assertFails(alice().doc('config/app').set(GOOD));
    await assertFails(alice().doc('config/app').update({ minSupportedIosVersion: '1.0' }));
    await assertFails(anon().doc('config/app').set(GOOD));
  });

  await test('only the documented shape: versions are version strings, no extra fields', async () => {
    await assertFails(admin().doc('config/app').set({ ...GOOD, minSupportedIosVersion: 'latest' }));
    await assertFails(admin().doc('config/app').set({ ...GOOD, latestIosVersion: 3.14 }));
    await assertFails(admin().doc('config/app').set({ minSupportedIosVersion: '3.13.7' }));
    await assertFails(admin().doc('config/app').set({ ...GOOD, blockEveryone: true }));
    await assertFails(admin().doc('config/app').set({ ...GOOD, reason: 'x'.repeat(281) }));
  });

  await test('nobody deletes it from a client', async () => {
    await assertFails(admin().doc('config/app').delete());
    await assertFails(alice().doc('config/app').delete());
  });

  await testEnv.cleanup();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
