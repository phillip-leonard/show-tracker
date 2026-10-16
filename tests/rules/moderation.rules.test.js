/**
 * Firestore rules tests for the moderation changes in v5.32.0.
 *
 * Run with:
 *   npm run test:rules
 *
 * which starts the Firestore emulator, loads firestore.rules, and runs
 * this file against it. Nothing here touches production.
 *
 * WHY THESE EXIST. Every other guarantee in the moderation feature is
 * enforced by application code, and application code is what an attacker
 * skips: the whole point of closing `allow create` on the comment
 * collections is that someone with the Firebase SDK and a browser console
 * cannot do what the app refuses to do. A rule that is wrong fails
 * silently and permissively, so the only way to know it is right is to
 * try the attack.
 *
 * The five that matter, and all five are here:
 *   - a banned user cannot write
 *   - a banned user cannot un-ban themselves
 *   - a non-admin cannot read `reports`
 *   - hidden content is not readable by third parties
 *   - one user cannot read or overwrite another's block list
 */

const assert = require('assert');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'demo-moderation-rules';
const ADMIN_EMAIL = 'phillip.leonard@gmail.com';

const ALICE = 'uid_alice';
const BANNED = 'uid_banned';
const ADMIN = 'uid_admin';

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

// Contexts. `admin` here means the app's admin ACCOUNT (an ordinary
// signed-in user whose token carries the admin email), not the Admin SDK
// — the rules identify an admin by token email, and that is what these
// tests need to exercise.
const alice = () => testEnv.authenticatedContext(ALICE).firestore();
const banned = () => testEnv.authenticatedContext(BANNED).firestore();
const admin = () => testEnv.authenticatedContext(ADMIN, { email: ADMIN_EMAIL }).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  await testEnv.clearFirestore();

  // Seed through withSecurityRulesDisabled — this is the state of the
  // world the rules are then tested against, not something a client
  // should be able to create.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`userProfiles/${ALICE}`).set({ displayName: 'Alice' });
    await db.doc(`userProfiles/${BANNED}`).set({ displayName: 'Banned', banned: true });
    await db.doc(`userProfiles/${ADMIN}`).set({ displayName: 'Admin' });

    await db.doc('showComments/c1').set({
      concertKey: 'k1', parentId: null, authorUid: ALICE,
      authorName: 'Alice', text: 'great show', likedBy: [],
    });
    await db.doc('showPhotos/p1').set({
      concertKey: 'k1', uploadedBy: ALICE, uploaderName: 'Alice',
      caption: 'the encore', url: 'https://example.test/p.jpg', likedBy: [],
    });
    await db.doc('meetupComments/m1').set({
      meetupId: 'meet1', authorUid: ALICE, authorName: 'Alice', text: 'see you there',
    });

    await db.doc('reports/c1_uid_bob').set({
      contentType: 'showComment', contentId: 'c1', contentPath: 'showComments/c1',
      reporterId: 'uid_bob', reportedUserId: ALICE, reason: 'spam', status: 'open',
    });
    await db.doc('moderationHidden/showComments_c9').set({
      collectionName: 'showComments', docId: 'c9', hidden: true,
      authorUid: ALICE, data: { text: 'something reported three times' },
    });
    await db.doc('moderationCounters/c9').set({ contentId: 'c9', openReports: 3 });
    await db.doc(`userBlocks/${ALICE}`).set({ userId: ALICE, blockedUserIds: ['uid_bob'] });

    // For the published-text tests below.
    await db.doc('handles/taken').set({ uid: 'uid_bob' });

    // What an ejection sweep leaves behind.
    await db.doc('moderationHidden/showComments_ejected1').set({
      collectionName: 'showComments', docId: 'ejected1', hidden: true,
      hiddenReason: 'author ejected by admin', authorUid: BANNED,
      data: { text: 'something the ejected account posted' },
    });
    await db.doc('meetups/meet_owned').set({
      concertKey: 'kd', createdBy: ALICE, attendeeUids: [ALICE], description: '',
    });
    await db.doc('meetups/meet_join').set({
      concertKey: 'kj', createdBy: 'uid_dave', attendeeUids: ['uid_dave'], description: '',
    });
  });

  console.log('\nthe write path is closed to clients');

  await test('nobody can create a comment directly, not even its author', async () => {
    // The filter in netlify/functions/moderate-content.js is only a gate
    // if this is the sole way in. Before v5.32.0 this call succeeded.
    await assertFails(alice().doc('showComments/new1').set({
      concertKey: 'k1', parentId: null, authorUid: ALICE,
      authorName: 'Alice', text: 'straight past the filter', likedBy: [],
    }));
  });

  await test('nobody can create photo metadata directly', async () => {
    await assertFails(alice().doc('showPhotos/new1').set({
      concertKey: 'k1', uploadedBy: ALICE, uploaderName: 'Alice',
      caption: 'straight past the filter', url: 'https://example.test/x.jpg', likedBy: [],
    }));
  });

  await test('nobody can create a meetup message directly', async () => {
    await assertFails(alice().doc('meetupComments/new1').set({
      meetupId: 'meet1', authorUid: ALICE, authorName: 'Alice', text: 'past the filter',
    }));
  });

  console.log('\na banned user cannot write');

  await test('a banned user cannot like a comment', async () => {
    await assertFails(banned().doc('showComments/c1').update({ likedBy: [BANNED] }));
  });

  await test('a banned user cannot like a photo', async () => {
    await assertFails(banned().doc('showPhotos/p1').update({ likedBy: [BANNED] }));
  });

  await test('a banned user cannot create or join a meetup', async () => {
    await assertFails(banned().doc('meetups/meet2').set({
      concertKey: 'k2', createdBy: BANNED, attendeeUids: [BANNED], attendeeNames: {},
    }));
  });

  await test('an ordinary user can still do all three', async () => {
    // The ban check must not be a blanket denial — if this fails, the
    // feature has broken commenting for everyone.
    await assertSucceeds(alice().doc('showComments/c1').update({ likedBy: [ALICE] }));
    await assertSucceeds(alice().doc('showPhotos/p1').update({ likedBy: [ALICE] }));
    await assertSucceeds(alice().doc('meetups/meet3').set({
      concertKey: 'k3', createdBy: ALICE, attendeeUids: [ALICE], attendeeNames: {},
    }));
  });

  await test('a banned user cannot lift their own ban', async () => {
    // Without this, the ban is decorative: `banned` sits on the user's own
    // profile document, which they can otherwise write freely.
    await assertFails(banned().doc(`userProfiles/${BANNED}`).update({ banned: false }));
    await assertFails(banned().doc(`userProfiles/${BANNED}`).set({
      displayName: 'Banned', banned: false,
    }));
  });

  await test('a user cannot ban someone else, or themselves', async () => {
    await assertFails(alice().doc(`userProfiles/${BANNED}`).update({ banned: false }));
    await assertFails(alice().doc(`userProfiles/${ALICE}`).update({ banned: true }));
  });

  await test('an ordinary profile edit still works', async () => {
    // Profiles predating the `banned` field must keep working — a bare
    // field read in the rule would fail evaluation on every one of them.
    // photoURL rather than displayName: the name is closed to clients as
    // of v5.36.2 (see below), but the rest of the profile is not, and a
    // rule that locked the whole document would break every setting.
    await assertSucceeds(alice().doc(`userProfiles/${ALICE}`).update({ photoURL: 'https://example.test/a.jpg' }));
    await assertSucceeds(alice().doc(`userProfiles/${ALICE}`).update({ publicProfile: true }));
  });

  console.log('\npublished text is closed to clients (v5.36.2)');

  // The name, the handle and the meetup description are filtered by
  // lib/contentFilter.js before they are written. A filter the client can
  // skip is advice, not a gate — and a client that writes the field
  // directly skips it. These are the attacks that has to fail.

  await test('a user cannot change their own display name', async () => {
    await assertFails(alice().doc(`userProfiles/${ALICE}`).update({ displayName: 'Alice B' }));
    await assertFails(alice().doc(`userProfiles/${ALICE}`).update({ firstName: 'Alice' }));
    // Nor smuggled in beside a field that IS allowed.
    await assertFails(alice().doc(`userProfiles/${ALICE}`).update({
      photoURL: 'https://example.test/b.jpg', displayName: 'Alice B',
    }));
  });

  await test('a write that leaves the name alone still works', async () => {
    // The rule compares old and new rather than forbidding the key, so
    // set() with merge — which resends every field — must not be refused
    // just for carrying the name it already has.
    await assertSucceeds(alice().doc(`userProfiles/${ALICE}`).set(
      { displayName: 'Alice', showCount: 12 }, { merge: true },
    ));
  });

  await test('a new profile cannot be created carrying published text', async () => {
    const carol = () => testEnv.authenticatedContext('uid_carol').firestore();
    await assertFails(carol().doc('userProfiles/uid_carol').set({ displayName: 'Carol' }));
    await assertFails(carol().doc('userProfiles/uid_carol').set({ handle: 'carol', handleLower: 'carol' }));
    // Creating without it is how the app actually does it; the server
    // establishes the name a moment later.
    await assertSucceeds(carol().doc('userProfiles/uid_carol').set({ email: 'c@example.test' }));
  });

  await test('a user cannot claim a handle directly', async () => {
    await assertFails(alice().doc(`userProfiles/${ALICE}`).update({ handle: 'alice', handleLower: 'alice' }));
    await assertFails(alice().doc('handles/alice').set({ uid: ALICE }));
  });

  await test('handles stay readable, so the availability check works', async () => {
    await assertSucceeds(alice().doc('handles/taken').get());
  });

  await test('the organizer cannot write a meetup description directly', async () => {
    await assertFails(alice().doc('meetups/meet_owned').update({ description: 'come to my thing' }));
    await assertFails(alice().doc('meetups/meet_owned').set(
      { description: 'come to my thing' }, { merge: true },
    ));
  });

  await test('a meetup cannot be created carrying a description', async () => {
    await assertFails(alice().doc('meetups/meet_new').set({
      concertKey: 'kn', createdBy: ALICE, attendeeUids: [ALICE], description: 'slur goes here',
    }));
    await assertSucceeds(alice().doc('meetups/meet_new').set({
      concertKey: 'kn', createdBy: ALICE, attendeeUids: [ALICE], description: '',
    }));
  });

  await test('joining a meetup still works', async () => {
    // The attendee path must survive description being closed.
    await assertSucceeds(alice().doc('meetups/meet_join').update({
      attendeeUids: ['uid_dave', ALICE], attendeeNames: { [ALICE]: 'Alice' },
    }));
  });

  console.log('\nan ejected account is locked down');

  // Ejection (moderate-report.js `ban`) has four parts. Two are Auth-side
  // and cannot be tested here — disabling the account and revoking its
  // refresh tokens are firebase-admin calls, not rules. The two that ARE
  // rules are below: the flag holds against the user themselves, and the
  // quarantine their content is swept into is unreadable by anyone else.

  await test('an ejected user cannot write any UGC', async () => {
    // The ban flag is what firestore.rules reads; disabling the Auth
    // account is belt and braces for the hour an issued token stays valid.
    await assertFails(banned().doc('meetups/meet_ejected').set({
      concertKey: 'ke', createdBy: BANNED, attendeeUids: [BANNED], description: '',
    }));
    await assertFails(banned().doc('showComments/c1').update({ likedBy: [BANNED] }));
    await assertFails(banned().doc('showPhotos/p1').update({ likedBy: [BANNED] }));
  });

  await test('swept content is unreadable by everyone but an admin', async () => {
    // The sweep moves each document into moderationHidden rather than
    // deleting it, so the decision is reversible. That only counts as
    // "removed" if nobody else can read it there — including the author.
    await assertFails(alice().doc('moderationHidden/showComments_ejected1').get());
    await assertFails(banned().doc('moderationHidden/showComments_ejected1').get());
    await assertFails(anon().doc('moderationHidden/showComments_ejected1').get());
    await assertSucceeds(admin().doc('moderationHidden/showComments_ejected1').get());
  });

  await test('an ejected user cannot rescue their own swept content', async () => {
    await assertFails(banned().doc('moderationHidden/showComments_ejected1').delete());
    await assertFails(banned().doc('showComments/ejected1').set({
      concertKey: 'k1', authorUid: BANNED, authorName: 'Banned', text: 'back again', likedBy: [],
    }));
  });

  console.log('\nreports are admin-only to read');

  await test('a signed-in non-admin cannot read reports', async () => {
    await assertFails(alice().doc('reports/c1_uid_bob').get());
    await assertFails(alice().collection('reports').get());
  });

  await test('an anonymous visitor cannot read reports', async () => {
    await assertFails(anon().doc('reports/c1_uid_bob').get());
  });

  await test('the admin can read and resolve reports', async () => {
    await assertSucceeds(admin().doc('reports/c1_uid_bob').get());
    await assertSucceeds(admin().doc('reports/c1_uid_bob').update({ status: 'dismissed' }));
  });

  await test('a user can file a report, but only as themselves', async () => {
    await assertSucceeds(alice().doc('reports/c1_uid_alice').set({
      contentType: 'showComment', contentId: 'c1', contentPath: 'showComments/c1',
      reporterId: ALICE, reportedUserId: 'uid_bob', reason: 'spam', status: 'open',
    }));
    await assertFails(alice().doc('reports/c1_uid_mallory').set({
      contentType: 'showComment', contentId: 'c1', contentPath: 'showComments/c1',
      reporterId: 'uid_mallory', reportedUserId: 'uid_bob', reason: 'spam', status: 'open',
    }));
  });

  console.log('\nhidden content is not readable by third parties');

  await test('a third party cannot read auto-hidden content', async () => {
    await assertFails(alice().doc('moderationHidden/showComments_c9').get());
    await assertFails(alice().collection('moderationHidden').get());
    await assertFails(anon().doc('moderationHidden/showComments_c9').get());
  });

  await test('nobody can hide or un-hide content by hand', async () => {
    await assertFails(alice().doc('moderationHidden/showComments_c9').delete());
    await assertFails(alice().doc('moderationHidden/showComments_c1').set({
      collectionName: 'showComments', docId: 'c1', data: {},
    }));
    // Not even the admin account: restoring goes through
    // netlify/functions/moderate-report.js and the Admin SDK, so the
    // restore and the report closure happen in one batch.
    await assertFails(admin().doc('moderationHidden/showComments_c9').delete());
  });

  await test('the admin can read the hidden queue and the counters', async () => {
    await assertSucceeds(admin().doc('moderationHidden/showComments_c9').get());
    await assertSucceeds(admin().doc('moderationCounters/c9').get());
  });

  await test('a user cannot forge the auto-hide counter', async () => {
    await assertFails(alice().doc('moderationCounters/c1').set({ contentId: 'c1', openReports: 99 }));
    await assertFails(alice().doc('moderationCounters/c9').get());
  });

  console.log('\ntest-user flag is admin-only (v5.44.0)');

  // isTestUser takes an account out of the admin Users and Stats numbers.
  // If an owner could write it, anyone could hide from (or pad) them.

  await test('a user cannot mark or unmark themselves as a test user', async () => {
    await assertFails(alice().doc(`userProfiles/${ALICE}`).update({ isTestUser: true }));
    await assertFails(alice().doc(`userProfiles/${ALICE}`).set({ isTestUser: true }, { merge: true }));
    // Nor smuggled in beside a field that IS allowed.
    await assertFails(alice().doc(`userProfiles/${ALICE}`).update({
      photoURL: 'https://example.test/c.jpg', isTestUser: true,
    }));
  });

  await test('a new profile cannot be created already flagged', async () => {
    const dave = () => testEnv.authenticatedContext('uid_dave').firestore();
    await assertFails(dave().doc('userProfiles/uid_dave').set({ email: 'd@example.test', isTestUser: true }));
    await assertFails(dave().doc('userProfiles/uid_dave').set({ email: 'd@example.test', isTestUser: false }));
  });

  await test('another user cannot flag someone else', async () => {
    await assertFails(banned().doc(`userProfiles/${ALICE}`).update({ isTestUser: true }));
  });

  await test('the admin can mark and unmark a test user', async () => {
    await assertSucceeds(admin().doc(`userProfiles/${ALICE}`).update({ isTestUser: true }));
    await assertSucceeds(admin().doc(`userProfiles/${ALICE}`).update({ isTestUser: false }));
  });

  await test('the admin flag write cannot carry other fields or a non-boolean', async () => {
    await assertFails(admin().doc(`userProfiles/${ALICE}`).update({ isTestUser: true, displayName: 'Hacked' }));
    await assertFails(admin().doc(`userProfiles/${ALICE}`).update({ isTestUser: true, showCount: 0 }));
    await assertFails(admin().doc(`userProfiles/${ALICE}`).update({ isTestUser: 'yes' }));
  });

  await test('a flagged user can still edit the rest of their profile', async () => {
    // merge-set resends the flag unchanged, which must not be refused.
    await assertSucceeds(admin().doc(`userProfiles/${ALICE}`).update({ isTestUser: true }));
    await assertSucceeds(alice().doc(`userProfiles/${ALICE}`).update({ publicProfile: false }));
    await assertSucceeds(alice().doc(`userProfiles/${ALICE}`).set(
      { showCount: 3, isTestUser: true }, { merge: true },
    ));
    await assertFails(alice().doc(`userProfiles/${ALICE}`).update({ isTestUser: false }));
  });

  await test('a brand-new profile can be created with just createdAt', async () => {
    // ensureProfileCreatedAt() in AppContext writes this first on sign-in.
    const erin = () => testEnv.authenticatedContext('uid_erin').firestore();
    await assertSucceeds(erin().doc('userProfiles/uid_erin').set({ createdAt: new Date() }, { merge: true }));
  });

  console.log('\nblock lists stay private');

  await test('nobody can read another user’s block list', async () => {
    // The reason this is not on userProfiles: that document is readable by
    // every signed-in user, so a block list there would tell the blocked
    // person they had been blocked.
    await assertFails(banned().doc(`userBlocks/${ALICE}`).get());
    await assertFails(admin().doc(`userBlocks/${ALICE}`).get());
  });

  await test('a user can read and write their own block list', async () => {
    await assertSucceeds(alice().doc(`userBlocks/${ALICE}`).get());
    await assertSucceeds(alice().doc(`userBlocks/${ALICE}`).set({
      userId: ALICE, blockedUserIds: ['uid_bob', 'uid_carol'],
    }));
  });

  await test('a user cannot write to someone else’s block list', async () => {
    // Pinning the docId is what stops this. Matching on the userId field
    // alone would let anyone overwrite userBlocks/<victim-uid>, wiping
    // their blocks and locking them out of reading it back.
    await assertFails(banned().doc(`userBlocks/${ALICE}`).set({
      userId: BANNED, blockedUserIds: [],
    }));
    await assertFails(banned().doc(`userBlocks/${ALICE}`).set({
      userId: ALICE, blockedUserIds: [],
    }));
  });

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
