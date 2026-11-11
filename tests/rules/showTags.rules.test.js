/**
 * Firestore rules tests for showTags/{tagId} (5.59.1). A tag holds who
 * tagged whom at which show, the tagger's display name and a copy of the
 * show. Until 5.59.1 any signed-in user could read, edit or delete any of
 * them.
 *
 * Run with:
 *   npm run test:rules
 *
 * (also run in CI by .github/workflows/rules-tests.yml). Nothing here
 * touches production.
 *
 * What the rule promises, and every write the app makes (context/AppContext.jsx,
 * lib/moderation.js, lib/yearRecapData.js) is exercised here:
 *   - only the sender and the recipient can read a tag, by get or by the
 *     queries the app runs (toUid ==, fromUid == with status / upcomingShowId
 *     / toUid); a stranger can't, and can't run an unfiltered query
 *   - a tag can only be created as yourself, pending, to someone else, with
 *     the fields the app writes
 *   - the recipient can accept or decline a pending tag, and nothing else
 *   - the sender can revoke a pending tag, and edit the show on a pending
 *     upcoming-show tag, and nothing else
 *   - either party can delete a tag (blocking clears tags both ways)
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

const PROJECT_ID = 'demo-show-tags-rules';
const ALICE = 'uid_alice'; // sender
const BOB = 'uid_bob'; // recipient
const MALLORY = 'uid_mallory'; // neither

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
const anon = () => testEnv.unauthenticatedContext().firestore();
const ts = () => firebase.firestore.FieldValue.serverTimestamp();

const SHOW = { artist: 'Goose', venue: 'Red Rocks', date: '2026-06-01', city: 'Morrison, CO', setlist: [] };
const UPCOMING_SHOW = { ...SHOW, date: '2027-06-01', upcoming: true };

// What tagFriendsAtShow writes.
const newTag = (over = {}) => ({
  fromUid: ALICE,
  fromName: 'Alice',
  toUid: BOB,
  showData: SHOW,
  status: 'pending',
  createdAt: ts(),
  ...over,
});

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = { fromUid: ALICE, fromName: 'Alice', toUid: BOB, showData: SHOW, createdAt: new Date() };
    await db.doc('showTags/pending').set({ ...base, status: 'pending' });
    await db.doc('showTags/accepted').set({ ...base, status: 'accepted' });
    await db.doc('showTags/declined').set({ ...base, status: 'declined' });
    await db.doc('showTags/revoked').set({ ...base, status: 'revoked' });
    await db.doc('showTags/upcoming').set({ ...base, showData: UPCOMING_SHOW, upcomingShowId: 'up1', status: 'pending' });
    await db.doc('showTags/upcomingAccepted').set({ ...base, showData: UPCOMING_SHOW, upcomingShowId: 'up1', status: 'accepted' });
    // A tag between two other people, so Alice and Bob aren't parties to it.
    await db.doc('showTags/others').set({ ...base, fromUid: MALLORY, toUid: 'uid_carol', status: 'pending' });
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

  // ── Reads ───────────────────────────────────────────────────────────
  await seed();

  await test('sender and recipient can read a tag; a stranger and a signed-out user cannot', async () => {
    await assertSucceeds(as(ALICE).doc('showTags/pending').get());
    await assertSucceeds(as(BOB).doc('showTags/pending').get());
    await assertFails(as(MALLORY).doc('showTags/pending').get());
    await assertFails(anon().doc('showTags/pending').get());
  });

  await test('the recipient’s incoming-tags listener query (toUid ==) works', async () => {
    const snap = await assertSucceeds(as(BOB).collection('showTags').where('toUid', '==', BOB).get());
    if (snap.size !== 6) throw new Error(`expected 6 tags, got ${snap.size}`);
  });

  await test('the sender’s queries work: show buddy, upcoming statuses, revoke, block', async () => {
    const tags = as(ALICE).collection('showTags');
    await assertSucceeds(tags.where('fromUid', '==', ALICE).where('status', '==', 'accepted').get());
    await assertSucceeds(tags.where('fromUid', '==', ALICE).where('upcomingShowId', '==', 'up1').get());
    await assertSucceeds(tags.where('fromUid', '==', ALICE).where('toUid', '==', BOB).get());
    // clearPendingBetween's other direction, run by the blocked-on side.
    await assertSucceeds(as(BOB).collection('showTags').where('fromUid', '==', ALICE).where('toUid', '==', BOB).get());
  });

  await test('nobody can list tags they aren’t on', async () => {
    await assertFails(as(MALLORY).collection('showTags').get());
    await assertFails(as(MALLORY).collection('showTags').where('toUid', '==', BOB).get());
    await assertFails(as(MALLORY).collection('showTags').where('fromUid', '==', ALICE).get());
    await assertFails(as(ALICE).collection('showTags').where('status', '==', 'pending').get());
  });

  // ── Create ──────────────────────────────────────────────────────────
  await test('a sender can tag a friend at a past show and an upcoming show', async () => {
    await assertSucceeds(as(ALICE).collection('showTags').doc().set(newTag()));
    await assertSucceeds(as(ALICE).collection('showTags').doc().set(newTag({ showData: UPCOMING_SHOW, upcomingShowId: 'up1' })));
  });

  await test('a tag can be created in a batch, as the app does', async () => {
    const db = as(ALICE);
    const batch = db.batch();
    batch.set(db.collection('showTags').doc(), newTag());
    batch.set(db.collection('showTags').doc(), newTag({ toUid: 'uid_carol' }));
    await assertSucceeds(batch.commit());
  });

  await test('a tag cannot be created as someone else, or signed out', async () => {
    await assertFails(as(MALLORY).collection('showTags').doc().set(newTag()));
    await assertFails(anon().collection('showTags').doc().set(newTag()));
  });

  await test('a tag cannot be created already answered, to yourself, or with extra fields', async () => {
    const tags = as(ALICE).collection('showTags');
    await assertFails(tags.doc().set(newTag({ status: 'accepted' })));
    await assertFails(tags.doc().set(newTag({ status: 'revoked' })));
    await assertFails(tags.doc().set(newTag({ toUid: ALICE })));
    await assertFails(tags.doc().set(newTag({ toUid: null })));
    await assertFails(tags.doc().set(newTag({ showData: 'Goose' })));
    await assertFails(tags.doc().set(newTag({ revokedAt: ts() })));
  });

  // ── Recipient answers ───────────────────────────────────────────────
  await seed();

  await test('the recipient can accept a pending tag (acceptShowTag’s merge write)', async () => {
    await assertSucceeds(as(BOB).doc('showTags/pending').set({ status: 'accepted' }, { merge: true }));
  });

  await test('accepting an already-accepted tag again is a harmless no-op', async () => {
    await assertSucceeds(as(BOB).doc('showTags/accepted').set({ status: 'accepted' }, { merge: true }));
  });

  await seed();

  await test('the recipient can decline a pending tag (declineShowTag)', async () => {
    await assertSucceeds(as(BOB).doc('showTags/pending').set({ status: 'declined' }, { merge: true }));
  });

  await test('the recipient can accept a pending upcoming-show tag', async () => {
    await assertSucceeds(as(BOB).doc('showTags/upcoming').set({ status: 'accepted' }, { merge: true }));
  });

  await test('the recipient cannot change an answer, or answer a revoked tag', async () => {
    await assertFails(as(BOB).doc('showTags/accepted').set({ status: 'declined' }, { merge: true }));
    await assertFails(as(BOB).doc('showTags/declined').set({ status: 'accepted' }, { merge: true }));
    await assertFails(as(BOB).doc('showTags/revoked').set({ status: 'accepted' }, { merge: true }));
  });

  await test('the recipient cannot revoke, reset to pending, or edit any other field', async () => {
    await assertFails(as(BOB).doc('showTags/upcoming').update({ status: 'revoked' }));
    await assertFails(as(BOB).doc('showTags/upcoming').update({ status: 'pending', fromName: 'Bob' }));
    await assertFails(as(BOB).doc('showTags/upcoming').update({ showData: SHOW }));
    await assertFails(as(BOB).doc('showTags/upcoming').update({ status: 'accepted', fromUid: BOB }));
    await assertFails(as(BOB).doc('showTags/upcoming').update({ toUid: MALLORY }));
  });

  await test('the sender cannot accept or decline their own tag', async () => {
    await assertFails(as(ALICE).doc('showTags/upcoming').set({ status: 'accepted' }, { merge: true }));
    await assertFails(as(ALICE).doc('showTags/upcoming').set({ status: 'declined' }, { merge: true }));
  });

  // ── Sender revokes / edits ──────────────────────────────────────────
  await seed();

  await test('the sender can revoke a pending tag (revokePendingTags’ batch update)', async () => {
    const db = as(ALICE);
    const batch = db.batch();
    batch.update(db.doc('showTags/pending'), { status: 'revoked', revokedAt: ts() });
    batch.update(db.doc('showTags/upcoming'), { status: 'revoked', revokedAt: ts() });
    await assertSucceeds(batch.commit());
  });

  await seed();

  await test('the sender cannot revoke an answered tag', async () => {
    await assertFails(as(ALICE).doc('showTags/accepted').update({ status: 'revoked', revokedAt: ts() }));
    await assertFails(as(ALICE).doc('showTags/declined').update({ status: 'revoked', revokedAt: ts() }));
  });

  await test('the sender can update the show on a pending upcoming tag (updateUpcomingShow)', async () => {
    await assertSucceeds(as(ALICE).doc('showTags/upcoming').update({ showData: { ...UPCOMING_SHOW, venue: 'Dillon Amphitheater' } }));
  });

  await test('the sender cannot edit the show on an answered tag or a past-show tag', async () => {
    await assertFails(as(ALICE).doc('showTags/upcomingAccepted').update({ showData: { ...UPCOMING_SHOW, venue: 'Elsewhere' } }));
    await assertFails(as(ALICE).doc('showTags/pending').update({ showData: { ...SHOW, venue: 'Elsewhere' } }));
  });

  await test('the sender cannot redirect a tag, rename themselves on it, or mark it pending again', async () => {
    await assertFails(as(ALICE).doc('showTags/upcoming').update({ toUid: MALLORY }));
    await assertFails(as(ALICE).doc('showTags/upcoming').update({ fromName: 'Someone else' }));
    await assertFails(as(ALICE).doc('showTags/upcoming').update({ fromUid: MALLORY }));
    await assertFails(as(ALICE).doc('showTags/revoked').update({ status: 'pending' }));
    await assertFails(as(ALICE).doc('showTags/upcoming').update({ status: 'revoked', showData: SHOW }));
  });

  await test('a stranger cannot accept, decline, revoke or edit a tag', async () => {
    await assertFails(as(MALLORY).doc('showTags/pending').set({ status: 'accepted' }, { merge: true }));
    await assertFails(as(MALLORY).doc('showTags/pending').set({ status: 'declined' }, { merge: true }));
    await assertFails(as(MALLORY).doc('showTags/pending').update({ status: 'revoked', revokedAt: ts() }));
    await assertFails(as(MALLORY).doc('showTags/upcoming').update({ showData: SHOW }));
    await assertFails(anon().doc('showTags/pending').set({ status: 'accepted' }, { merge: true }));
  });

  await test('a stranger cannot overwrite a tag with set()', async () => {
    await assertFails(as(MALLORY).doc('showTags/pending').set(newTag({ fromUid: MALLORY })));
  });

  // ── Delete (lib/moderation.js clearPendingBetween) ──────────────────
  await test('a stranger cannot delete a tag', async () => {
    await assertFails(as(MALLORY).doc('showTags/pending').delete());
    await assertFails(as(ALICE).doc('showTags/others').delete());
    await assertFails(anon().doc('showTags/pending').delete());
  });

  await test('either party can delete a tag between them', async () => {
    await assertSucceeds(as(ALICE).doc('showTags/pending').delete());
    await assertSucceeds(as(BOB).doc('showTags/accepted').delete());
  });

  await testEnv.cleanup();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
