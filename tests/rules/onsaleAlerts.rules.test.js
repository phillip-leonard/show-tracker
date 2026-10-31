/**
 * Firestore rules tests for on-sale alerts (v5.52.0). The jobs write through
 * the Admin SDK, which these rules don't apply to.
 *
 * Run with:
 *   npm run test:rules
 *
 * What the rules promise, and all of it is here:
 *   - alertSettings: home location is readable and writable by its owner only,
 *     in the shape the app writes
 *   - onsaleAlerts: the owner can read their own, and no client can write any
 *   - presaleIntel, inboundEmails, artists (sign-up links, sender allowlist):
 *     no client can write, and only the admin can read
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'demo-onsale-rules';
const ALICE = 'uid_alice';
const BOB = 'uid_bob';
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

const alice = () => testEnv.authenticatedContext(ALICE).firestore();
const bob = () => testEnv.authenticatedContext(BOB).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const admin = () => testEnv.authenticatedContext('uid_admin', { email: ADMIN_EMAIL }).firestore();

const settings = (uid, over = {}) => ({
  uid,
  homeLocation: { label: 'Denver, CO', lat: 39.739, lng: -104.985 },
  alertRadiusMiles: 100,
  timezone: 'America/Denver',
  ...over,
});

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`alertSettings/${ALICE}`).set(settings(ALICE));
    await db.doc(`onsaleAlerts/${ALICE}_show`).set({ uid: ALICE, artistId: 'a1', presaleCode: 'TACO' });
    await db.doc('presaleIntel/e1').set({ artistId: 'a1', code: 'TACO' });
    await db.doc('inboundEmails/e1').set({ sender: 'news@band.com', text: 'body' });
    await db.doc('artists/a1').set({ name: 'Goose', senderAllowlist: ['band.com'], presaleSignupUrls: [] });
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

  await test('a user can read and write their own alert settings', async () => {
    await assertSucceeds(alice().doc(`alertSettings/${ALICE}`).get());
    await assertSucceeds(alice().doc(`alertSettings/${ALICE}`).set(settings(ALICE, { alertRadiusMiles: 250 })));
    await assertSucceeds(alice().doc(`alertSettings/${ALICE}`).set(settings(ALICE, { homeLocation: null })));
    await assertSucceeds(bob().doc(`alertSettings/${BOB}`).set(settings(BOB)));
  });

  await seed();

  await test('nobody else can read a home location, even the signed-in', async () => {
    await assertFails(bob().doc(`alertSettings/${ALICE}`).get());
    await assertFails(bob().collection('alertSettings').get());
    await assertFails(anon().doc(`alertSettings/${ALICE}`).get());
  });

  await test('nobody else can write it, and it has to name its owner', async () => {
    await assertFails(bob().doc(`alertSettings/${ALICE}`).set(settings(BOB)));
    await assertFails(bob().doc(`alertSettings/${BOB}`).set(settings(ALICE)));
    await assertFails(anon().doc(`alertSettings/${ALICE}`).set(settings(ALICE)));
  });

  await test('settings keep their shape', async () => {
    await assertFails(alice().doc(`alertSettings/${ALICE}`).set(settings(ALICE, { alertRadiusMiles: 5000 })));
    await assertFails(alice().doc(`alertSettings/${ALICE}`).set(settings(ALICE, { isAdmin: true })));
    await assertFails(alice().doc(`alertSettings/${ALICE}`).set(settings(ALICE, { homeLocation: { lat: 'near', lng: 1, label: 'x' } })));
    await assertFails(alice().doc(`alertSettings/${ALICE}`).set(settings(ALICE, { homeLocation: { lat: 1, lng: 1, label: 'x', street: 'y' } })));
  });

  await test('a user can read their own alert, and no one else\'s', async () => {
    await assertSucceeds(alice().doc(`onsaleAlerts/${ALICE}_show`).get());
    await assertSucceeds(alice().collection('onsaleAlerts').where('uid', '==', ALICE).get());
    await assertFails(bob().doc(`onsaleAlerts/${ALICE}_show`).get());
    await assertFails(bob().collection('onsaleAlerts').get());
  });

  await test('no client can write an alert, even its owner or the admin', async () => {
    await assertFails(alice().doc(`onsaleAlerts/${ALICE}_show`).update({ presaleCode: 'MINE' }));
    await assertFails(alice().doc(`onsaleAlerts/${ALICE}_new`).set({ uid: ALICE }));
    await assertFails(alice().doc(`onsaleAlerts/${ALICE}_show`).delete());
    await assertFails(admin().doc(`onsaleAlerts/${ALICE}_show`).update({ presaleCode: 'MINE' }));
  });

  for (const [col, id] of [['presaleIntel', 'e1'], ['inboundEmails', 'e1'], ['artists', 'a1']]) {
    await test(`${col}: admin reads, users read nothing, nobody writes`, async () => {
      await assertSucceeds(admin().doc(`${col}/${id}`).get());
      await assertFails(alice().doc(`${col}/${id}`).get());
      await assertFails(alice().collection(col).get());
      await assertFails(anon().doc(`${col}/${id}`).get());
      await assertFails(alice().doc(`${col}/${id}`).set({ senderAllowlist: ['evil.example'] }));
      await assertFails(alice().doc(`${col}/new`).set({ code: 'FAKE' }));
      await assertFails(admin().doc(`${col}/${id}`).set({ senderAllowlist: ['evil.example'] }));
      await assertFails(alice().doc(`${col}/${id}`).delete());
    });
  }

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
