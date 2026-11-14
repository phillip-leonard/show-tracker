/**
 * Firestore rules tests for the 5.59.7 security fixes (S-01 to S-05 in
 * docs/ios-native/SCOPING.md). Each block attacks what used to be open and
 * then runs the writes the app still makes, so a rule that is too tight
 * fails here too.
 *
 * Run with:
 *   npm run test:rules
 *
 * (also run in CI by .github/workflows/rules-tests.yml). Nothing here
 * touches production.
 *
 *   S-01  no email on a profile (create or update)
 *   S-03  shows: owner, the owner's friends and the admin only
 *   S-04  friends lists: only the owner adds; either party removes
 *   S-02  friendRequests, ticketCache, pendingEmailTags, invites,
 *         adminAuditLog, and the server-only rateLimits / emailSends
 *   S-05  guestSessions, roadmapItems, feedback
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

const PROJECT_ID = 'demo-security-rules';
const ADMIN_EMAIL = 'phillip.leonard@gmail.com';
const ALICE = 'uid_alice';
const BOB = 'uid_bob'; // Alice's friend
const MALLORY = 'uid_mallory'; // nobody's friend

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

const EMAILS = { [ALICE]: 'alice@example.com', [BOB]: 'Bob@Example.com', [MALLORY]: 'mallory@example.com' };
const as = (uid) => testEnv.authenticatedContext(uid, { email: EMAILS[uid] }).firestore();
const admin = () => testEnv.authenticatedContext('uid_admin', { email: ADMIN_EMAIL, email_verified: true }).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const ts = () => firebase.firestore.FieldValue.serverTimestamp();
const inc = (n) => firebase.firestore.FieldValue.increment(n);

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`userProfiles/${ALICE}`).set({ showCount: 1 });
    await db.doc(`userProfiles/${BOB}`).set({ showCount: 1, email: 'bob@example.com' }); // pre-5.59.7 profile
    await db.doc(`users/${ALICE}/shows/s1`).set({ artist: 'Goose', date: '2024-06-15' });
    // Alice and Bob are friends both ways; Mallory has added Alice to her
    // own list, which must not let her read Alice's shows.
    await db.doc(`users/${ALICE}/friends/${BOB}`).set({ friendUid: BOB });
    await db.doc(`users/${BOB}/friends/${ALICE}`).set({ friendUid: ALICE });
    await db.doc(`users/${MALLORY}/friends/${ALICE}`).set({ friendUid: ALICE });
    await db.doc('friendRequests/r1').set({ from: MALLORY, to: ALICE, fromName: 'M', toName: 'A', status: 'pending' });
    await db.doc('friendRequests/r2').set({ from: BOB, to: 'uid_carol', status: 'pending' });
    await db.doc('ticketCache/tm_goose').set({ data: [], cachedAt: new Date() });
    await db.doc('pendingEmailTags/p1').set({ fromUid: ALICE, toEmail: 'bob@example.com', status: 'pending', showData: {} });
    await db.doc('invites/i1').set({ inviterUid: ALICE, inviteeEmail: 'new@example.com', status: 'pending' });
    await db.doc('adminAuditLog/a1').set({ action: 'delete' });
    await db.doc('guestSessions/g1').set({ startedAt: new Date(), converted: false, showsAdded: 0 });
    await db.doc('roadmapItems/draft1').set({ title: 'x', status: 'draft', submitterUid: ALICE, voteCount: 0 });
    await db.doc('roadmapItems/live1').set({ title: 'y', status: 'upnext', submitterUid: MALLORY, voteCount: 3 });
    await db.doc('feedback/f1').set({ submitterUid: ALICE, submitterEmail: 'alice@example.com', message: 'hi', status: 'linked' });
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

  // ── S-01: no addresses on profiles ──────────────────────────────────
  await test('S-01: a profile cannot be created or updated with an email', async () => {
    await assertFails(as(MALLORY).doc(`userProfiles/${MALLORY}`).set({ email: 'mallory@example.com' }));
    await assertFails(as(MALLORY).doc(`userProfiles/${MALLORY}`).set({ invitedByEmail: 'x@example.com' }));
    await assertFails(as(ALICE).doc(`userProfiles/${ALICE}`).set({ email: 'alice@example.com' }, { merge: true }));
    await assertFails(as(BOB).doc(`userProfiles/${BOB}`).update({ email: 'other@example.com' }));
  });

  await test('S-01: the app’s profile writes still go through, on old and new profiles', async () => {
    await assertSucceeds(as(MALLORY).doc(`userProfiles/${MALLORY}`).set({ showCount: 0, lastLogin: ts() }));
    // Both id names, as the app writes them since 5.59.10 (B-03).
    await assertSucceeds(as(MALLORY).doc(`userProfiles/${MALLORY}`).set({ userId: MALLORY, odubleserId: MALLORY }, { merge: true }));
    await assertSucceeds(as(ALICE).doc(`userProfiles/${ALICE}`).set({ showCount: 2 }, { merge: true }));
    await assertSucceeds(as(BOB).doc(`userProfiles/${BOB}`).set({ showCount: 2 }, { merge: true }));
  });

  // ── S-03: shows ─────────────────────────────────────────────────────
  await test('S-03: owner, friend and admin can read shows', async () => {
    await assertSucceeds(as(ALICE).doc(`users/${ALICE}/shows/s1`).get());
    await assertSucceeds(as(BOB).collection(`users/${ALICE}/shows`).get());
    await assertSucceeds(admin().collection(`users/${ALICE}/shows`).get());
  });

  await test('S-03: a stranger cannot, even with the owner on their own list', async () => {
    await assertFails(as(MALLORY).doc(`users/${ALICE}/shows/s1`).get());
    await assertFails(as(MALLORY).collection(`users/${ALICE}/shows`).get());
    await assertFails(anon().collection(`users/${ALICE}/shows`).get());
  });

  await test('S-03: only the owner writes shows', async () => {
    await assertFails(as(BOB).doc(`users/${ALICE}/shows/s2`).set({ artist: 'x' }));
    await assertSucceeds(as(ALICE).doc(`users/${ALICE}/shows/s2`).set({ artist: 'x' }));
  });

  // ── S-04: friends lists ─────────────────────────────────────────────
  await test('S-04: nobody can add themselves to someone else’s friends list', async () => {
    await assertFails(as(MALLORY).doc(`users/${ALICE}/friends/${MALLORY}`).set({ friendUid: MALLORY }));
    await assertFails(as(MALLORY).doc(`users/${BOB}/friends/${MALLORY}`).set({ friendUid: MALLORY }));
    await assertFails(as(BOB).doc(`users/${ALICE}/friends/${BOB}`).update({ friendName: 'x' }));
  });

  await test('S-04: the owner manages their own list; either party removes an edge', async () => {
    await assertSucceeds(as(MALLORY).doc(`users/${MALLORY}/friends/${BOB}`).set({ friendUid: BOB }));
    await assertFails(as(MALLORY).doc(`users/${ALICE}/friends/${BOB}`).delete());
    await assertSucceeds(as(MALLORY).doc(`users/${MALLORY}/friends/${ALICE}`).delete());
    await assertSucceeds(as(BOB).doc(`users/${ALICE}/friends/${BOB}`).delete()); // block / remove friend
  });

  await seed();

  // ── S-02: friend requests ───────────────────────────────────────────
  await test('S-02: only the two parties read a friend request', async () => {
    await assertSucceeds(as(ALICE).doc('friendRequests/r1').get());
    await assertSucceeds(as(MALLORY).doc('friendRequests/r1').get());
    await assertFails(as(BOB).doc('friendRequests/r1').get());
    await assertFails(as(ALICE).collection('friendRequests').get()); // the old read-everything query
    await assertSucceeds(as(ALICE).collection('friendRequests').where('to', '==', ALICE).get());
    await assertSucceeds(as(ALICE).collection('friendRequests').where('from', '==', ALICE).get());
  });

  await test('S-02: a request is created as yourself, pending, names only', async () => {
    const req = (over) => ({ from: ALICE, to: MALLORY, fromName: 'A', toName: 'M', status: 'pending', createdAt: ts(), ...over });
    await assertFails(as(ALICE).collection('friendRequests').add(req({ from: BOB })));
    await assertFails(as(ALICE).collection('friendRequests').add(req({ to: ALICE })));
    await assertFails(as(ALICE).collection('friendRequests').add(req({ status: 'accepted' })));
    await assertFails(as(ALICE).collection('friendRequests').add(req({ fromEmail: 'alice@example.com' })));
    await assertSucceeds(as(ALICE).collection('friendRequests').add(req()));
  });

  await test('S-02: the recipient may decline but not accept from the browser; the sender can do neither', async () => {
    await assertFails(as(ALICE).doc('friendRequests/r1').update({ status: 'accepted' }));
    await assertFails(as(MALLORY).doc('friendRequests/r1').update({ status: 'declined' }));
    await assertFails(as(ALICE).doc('friendRequests/r1').update({ status: 'declined', to: MALLORY }));
    await assertSucceeds(as(ALICE).doc('friendRequests/r1').set({ status: 'declined' }, { merge: true }));
  });

  await test('S-02: either party deletes a request; a stranger cannot', async () => {
    await assertFails(as(ALICE).doc('friendRequests/r2').delete());
    await assertSucceeds(as(BOB).doc('friendRequests/r2').delete());
  });

  // ── S-02: ticket cache, audit log, server counters ──────────────────
  await test('S-02: ticketCache is read-only to clients', async () => {
    await assertSucceeds(as(MALLORY).doc('ticketCache/tm_goose').get());
    await assertFails(as(MALLORY).doc('ticketCache/tm_goose').set({ data: [{ url: 'https://evil.example' }] }));
    await assertFails(anon().doc('ticketCache/tm_goose').get());
  });

  await test('S-02: adminAuditLog: admin reads, nobody writes', async () => {
    await assertFails(as(MALLORY).doc('adminAuditLog/a1').get());
    await assertFails(as(MALLORY).doc('adminAuditLog/a2').set({ action: 'x' }));
    await assertSucceeds(admin().doc('adminAuditLog/a1').get());
    await assertFails(admin().doc('adminAuditLog/a2').set({ action: 'x' }));
  });

  await test('S-02: server-only counters and send records have no client access', async () => {
    await assertFails(as(ALICE).doc(`rateLimits/ai_user_${ALICE}_2026-11-13`).get());
    await assertFails(as(ALICE).doc(`rateLimits/ai_user_${ALICE}_2026-11-13`).set({ count: 0 }));
    await assertFails(as(ALICE).doc('emailSends/tag_x').set({ uid: ALICE }));
    await assertFails(as(ALICE).doc('emailSends/tag_x').get());
  });

  // ── S-02: pending email tags ────────────────────────────────────────
  await test('S-02: a pending email tag is read by its sender and the address it was sent to', async () => {
    await assertSucceeds(as(ALICE).doc('pendingEmailTags/p1').get());
    await assertSucceeds(as(BOB).doc('pendingEmailTags/p1').get()); // token email differs only in case
    await assertFails(as(MALLORY).doc('pendingEmailTags/p1').get());
    await assertSucceeds(as(BOB).collection('pendingEmailTags')
      .where('toEmail', '==', 'bob@example.com').where('status', '==', 'pending').get());
    await assertSucceeds(as(ALICE).collection('pendingEmailTags')
      .where('fromUid', '==', ALICE).where('status', '==', 'pending').get());
    await assertFails(as(MALLORY).collection('pendingEmailTags').get());
  });

  await test('S-02: pending email tags: create as yourself; recipient accepts or declines; sender withdraws', async () => {
    await assertFails(as(MALLORY).collection('pendingEmailTags').add({ fromUid: ALICE, toEmail: 'x@example.com', status: 'pending' }));
    await assertSucceeds(as(MALLORY).collection('pendingEmailTags').add({ fromUid: MALLORY, toEmail: 'x@example.com', status: 'pending' }));
    await assertFails(as(MALLORY).doc('pendingEmailTags/p1').set({ status: 'accepted' }, { merge: true }));
    await assertFails(as(BOB).doc('pendingEmailTags/p1').update({ status: 'accepted', fromUid: BOB }));
    await assertSucceeds(as(BOB).doc('pendingEmailTags/p1').set({ status: 'accepted' }, { merge: true }));
    await assertFails(as(BOB).doc('pendingEmailTags/p1').delete());
    await assertSucceeds(as(ALICE).doc('pendingEmailTags/p1').delete());
  });

  // ── S-02: invites ───────────────────────────────────────────────────
  await test('S-02: invites: the inviter and the admin read; nobody else', async () => {
    await assertSucceeds(as(ALICE).doc('invites/i1').get());
    await assertSucceeds(as(ALICE).collection('invites').where('inviterUid', '==', ALICE).where('status', '==', 'pending').get());
    await assertSucceeds(admin().collection('invites').get());
    await assertFails(as(MALLORY).doc('invites/i1').get());
    await assertFails(as(MALLORY).collection('invites').get());
  });

  await test('S-02: invites: create as yourself, no client updates, inviter withdraws', async () => {
    await assertFails(as(MALLORY).collection('invites').add({ inviterUid: ALICE, inviteeEmail: 'x@example.com', status: 'pending' }));
    await assertFails(as(MALLORY).collection('invites').add({ inviterUid: MALLORY, inviteeEmail: 'x@example.com', status: 'accepted' }));
    await assertSucceeds(as(MALLORY).collection('invites').add({ inviterUid: MALLORY, inviterName: 'M', inviteeEmail: 'x@example.com', status: 'pending', createdAt: ts() }));
    await assertFails(as(ALICE).doc('invites/i1').update({ status: 'accepted' }));
    await assertFails(as(MALLORY).doc('invites/i1').delete());
    await assertSucceeds(as(ALICE).doc('invites/i1').delete());
  });

  await seed();

  // ── S-05: guest sessions ────────────────────────────────────────────
  await test('S-05: a guest can start a session only in the app’s shape', async () => {
    await assertSucceeds(anon().collection('guestSessions').add({ startedAt: ts(), converted: false, showsAdded: 0, userAgent: 'Safari' }));
    await assertFails(anon().collection('guestSessions').add({ startedAt: ts(), converted: true, showsAdded: 0 }));
    await assertFails(anon().collection('guestSessions').add({ startedAt: ts(), converted: false, showsAdded: 500 }));
    await assertFails(anon().collection('guestSessions').add({ startedAt: ts(), converted: false, showsAdded: 0, convertedUserId: ALICE }));
  });

  await test('S-05: a guest may update only the show count; conversion is the signed-in user’s own', async () => {
    await assertSucceeds(anon().doc('guestSessions/g1').update({ showsAdded: 3 }));
    await assertFails(anon().doc('guestSessions/g1').update({ showsAdded: 'lots' }));
    await assertFails(anon().doc('guestSessions/g1').update({ converted: true, convertedUserId: ALICE }));
    await assertFails(as(ALICE).doc('guestSessions/g1').update({ converted: true, convertedAt: ts(), convertedUserId: BOB }));
    await assertSucceeds(as(ALICE).doc('guestSessions/g1').update({ converted: true, convertedAt: ts(), convertedUserId: ALICE }));
    await assertFails(anon().doc('guestSessions/g1').update({ showsAdded: 4 })); // converted now
  });

  await test('S-05: guest sessions are read by the admin only', async () => {
    await assertFails(as(ALICE).doc('guestSessions/g1').get());
    await assertFails(anon().doc('guestSessions/g1').get());
    await assertSucceeds(admin().collection('guestSessions').get());
  });

  // ── S-05: roadmap ───────────────────────────────────────────────────
  await test('S-05: published roadmap items are public; drafts only to the submitter and admin', async () => {
    await assertSucceeds(anon().doc('roadmapItems/live1').get());
    await assertSucceeds(anon().collection('roadmapItems').where('status', 'in', ['upnext', 'inprogress', 'shipped']).get());
    await assertFails(anon().doc('roadmapItems/draft1').get());
    await assertFails(as(MALLORY).doc('roadmapItems/draft1').get());
    await assertSucceeds(as(ALICE).doc('roadmapItems/draft1').get());
    await assertSucceeds(admin().collection('roadmapItems').get());
  });

  await test('S-05: Feedback can create a draft as yourself, without addresses', async () => {
    const draft = (over) => ({ title: 't', status: 'draft', voteCount: 0, submitterUid: MALLORY, ...over });
    await assertSucceeds(as(MALLORY).collection('roadmapItems').add(draft()));
    await assertFails(as(MALLORY).collection('roadmapItems').add(draft({ status: 'shipped' })));
    await assertFails(as(MALLORY).collection('roadmapItems').add(draft({ voteCount: 99 })));
    await assertFails(as(MALLORY).collection('roadmapItems').add(draft({ submitterUid: ALICE })));
    await assertFails(as(MALLORY).collection('roadmapItems').add(draft({ submitterEmail: 'm@example.com' })));
  });

  await test('S-05: only the admin edits an item', async () => {
    await assertFails(as(MALLORY).doc('roadmapItems/live1').update({ status: 'shipped' }));
    await assertFails(as(MALLORY).doc('roadmapItems/live1').update({ title: 'pwned' }));
    await assertSucceeds(admin().doc('roadmapItems/live1').update({ status: 'inprogress' }));
  });

  await test('S-05: a vote moves voteCount by one, with your own voter doc', async () => {
    const item = (db) => db.doc('roadmapItems/live1');
    const voter = (db, uid) => db.doc(`roadmapItems/live1/voters/${uid}`);
    // No voter doc: the count can't move.
    await assertFails(item(as(BOB)).update({ voteCount: inc(1) }));
    // +5 with a voter doc: refused.
    const bob = as(BOB);
    await assertFails(bob.runTransaction(async (tx) => {
      await tx.get(voter(bob, BOB));
      tx.set(voter(bob, BOB), { votedAt: ts() });
      tx.update(item(bob), { voteCount: inc(5), updatedAt: ts() });
    }));
    // What RoadmapView does: vote, then take it back.
    await assertSucceeds(bob.runTransaction(async (tx) => {
      await tx.get(voter(bob, BOB));
      tx.set(voter(bob, BOB), { votedAt: ts() });
      tx.update(item(bob), { voteCount: inc(1), updatedAt: ts() });
    }));
    await assertFails(item(bob).update({ voteCount: inc(1), updatedAt: ts() })); // already voted
    await assertSucceeds(bob.runTransaction(async (tx) => {
      await tx.get(voter(bob, BOB));
      tx.delete(voter(bob, BOB));
      tx.update(item(bob), { voteCount: inc(-1), updatedAt: ts() });
    }));
  });

  // ── S-05: feedback ──────────────────────────────────────────────────
  await test('S-05: feedback is read by its submitter and the admin only', async () => {
    await assertSucceeds(as(ALICE).doc('feedback/f1').get());
    await assertSucceeds(admin().collection('feedback').get());
    await assertFails(as(MALLORY).doc('feedback/f1').get());
    await assertFails(as(MALLORY).collection('feedback').get());
  });

  await test('S-05: feedback: create as yourself; link your own draft; the admin edits', async () => {
    await assertFails(as(MALLORY).collection('feedback').add({ submitterUid: ALICE, message: 'x' }));
    const ref = await assertSucceeds(as(MALLORY).collection('feedback').add({ submitterUid: MALLORY, message: 'x', status: 'linked', roadmapItemId: null }));
    await assertSucceeds(as(MALLORY).doc(ref.path).update({ roadmapItemId: 'r1', status: 'linked' }));
    await assertFails(as(MALLORY).doc(ref.path).update({ message: 'changed' }));
    await assertFails(as(MALLORY).doc('feedback/f1').update({ roadmapItemId: 'r9' }));
    await assertSucceeds(admin().doc('feedback/f1').update({ roadmapItemId: 'r9' }));
  });

  // ── One admin rule (5.59.12) ─────────────────────────────────────
  await test('admin: the claim, or the allowlisted address only when verified', async () => {
    const claim = testEnv.authenticatedContext('uid_claim', { email: 'someone@example.com', admin: true }).firestore();
    const unverified = testEnv.authenticatedContext('uid_fake', { email: ADMIN_EMAIL, email_verified: false }).firestore();
    const missing = testEnv.authenticatedContext('uid_fake2', { email: ADMIN_EMAIL }).firestore();
    await assertSucceeds(admin().doc('adminAuditLog/a1').get());
    await assertSucceeds(claim.doc('adminAuditLog/a1').get());
    await assertFails(unverified.doc('adminAuditLog/a1').get());
    await assertFails(missing.doc('adminAuditLog/a1').get());
    await assertFails(as(ALICE).doc('adminAuditLog/a1').get());
    await assertFails(anon().doc('adminAuditLog/a1').get());
  });

  await testEnv.cleanup();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
