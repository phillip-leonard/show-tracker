/**
 * Firestore and Storage rules for guests (5.60.13, native app Part 2): a
 * guest is Firebase anonymous auth with nothing linked. Each block checks
 * that a guest is refused, then that a real account still gets through, so
 * a rule that is too tight fails here too. The decisions behind the lists
 * are in docs/ios-native/DECISIONS.md ("Guests").
 *
 * Run with:
 *   npm run test:rules
 *
 * (also run in CI by .github/workflows/rules-tests.yml). Nothing here
 * touches production.
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app').default;
require('firebase/compat/firestore');
require('firebase/compat/storage');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'demo-anonymous-rules';
const GUEST = 'uid_guest';
const ALICE = 'uid_alice';
const BOB = 'uid_bob';

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

// The claims Firebase puts on a guest's token, and on the same account
// after a link (an identity, whatever sign_in_provider still says).
const guestCtx = () => testEnv.authenticatedContext(GUEST, { firebase: { sign_in_provider: 'anonymous', identities: {} } });
const linkedCtx = () => testEnv.authenticatedContext(GUEST, { email: 'new@example.com', firebase: { sign_in_provider: 'anonymous', identities: { email: ['new@example.com'] } } });
const aliceCtx = () => testEnv.authenticatedContext(ALICE, { email: 'alice@example.com', firebase: { sign_in_provider: 'google.com', identities: { 'google.com': ['1'] } } });
const guest = () => guestCtx().firestore();
const linked = () => linkedCtx().firestore();
const alice = () => aliceCtx().firestore();
const ts = () => firebase.firestore.FieldValue.serverTimestamp();

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`userProfiles/${ALICE}`).set({ displayName: 'Alice' });
    await db.doc(`userProfiles/${BOB}`).set({ displayName: 'Bob' });
    await db.doc('showComments/c1').set({ concertKey: 'k', authorUid: BOB, text: 'hi', likedBy: [] });
    await db.doc('showPhotos/p1').set({ concertKey: 'k', uploadedBy: BOB, likedBy: [] });
    await db.doc('meetups/m1').set({ createdBy: BOB, attendeeUids: [BOB], attendeeNames: ['Bob'] });
    await db.doc('meetupComments/mc1').set({ meetupId: 'm1', authorUid: BOB, text: 'hi' });
    await db.doc('userActivity/a1').set({ userId: BOB, type: 'show' });
    await db.doc('venueRatings/v1').set({ userId: BOB, venueKey: 'red rocks::morrison', overallRating: 5 });
    await db.doc('venueAnnouncements/va1').set({ venueKey: 'red rocks::morrison', text: 'hi' });
    await db.doc('venuePhotos/vp1').set({ venueKey: 'red rocks::morrison', uploadedBy: BOB });
    await db.doc('festivals/f1').set({ name: 'Fest', nameNormalized: 'fest', year: 2025, createdBy: BOB });
    await db.doc('roadmapItems/live1').set({ title: 'y', status: 'upnext', submitterUid: BOB, voteCount: 3 });
    await db.doc('communityStats/global').set({ totalShows: 1 });
    await db.doc('config/app').set({ minSupportedIosVersion: '3.13.10', latestIosVersion: '3.13.28' });
    await db.doc(`publicUserStats/${ALICE}`).set({ showCount: 1 });
    await db.doc(`showTags/t1`).set({ fromUid: BOB, fromName: 'Bob', toUid: GUEST, showData: {}, status: 'pending' });
  });
}

async function main() {
  const rules = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: rules('firestore.rules'), host: '127.0.0.1', port: 8080 },
    storage: { rules: rules('storage.rules'), host: '127.0.0.1', port: 9199 },
  });
  await seed();

  // ── A guest's own data ──────────────────────────────────────────────
  await test('guest: own shows, upcoming shows and discover preferences', async () => {
    await assertSucceeds(guest().doc(`users/${GUEST}/shows/1`).set({ artist: 'Goose', date: '2024-06-15', setlist: [] }));
    await assertSucceeds(guest().doc(`users/${GUEST}/shows/1`).update({ rating: 8 }));
    await assertSucceeds(guest().doc(`users/${GUEST}/shows/1`).get());
    await assertSucceeds(guest().doc(`users/${GUEST}/upcomingShows/u1`).set({ artist: 'Goose', date: '2030-01-01' }));
    await assertSucceeds(guest().doc(`users/${GUEST}/discover/prefs`).set({ dismissed: [] }));
    await assertSucceeds(guest().doc(`users/${GUEST}/shows/1`).delete());
  });

  await test('guest: own profile, blocks, push token, alert settings, wishlist, bucket list, tours', async () => {
    await assertSucceeds(guest().doc(`userProfiles/${GUEST}`).set({ createdAt: ts(), termsAcceptedVersion: 1, favoriteArtists: [] }));
    await assertSucceeds(guest().doc(`userBlocks/${GUEST}`).set({ userId: GUEST, blockedUserIds: [] }));
    await assertSucceeds(guest().doc('pushTokens/tok1').set({ userId: GUEST, platform: 'ios', updatedAt: ts() }));
    await assertSucceeds(guest().doc(`alertSettings/${GUEST}`).set({ uid: GUEST, alertRadiusMiles: 50 }));
    await assertSucceeds(guest().doc(`wishlists/${GUEST}_goose`).set({ userId: GUEST, artistKey: 'goose', songs: {} }));
    await assertSucceeds(guest().doc('bucketList/b1').set({ userId: GUEST, name: 'Goose' }));
    await assertSucceeds(guest().doc(`favoriteTours/${GUEST}`).set({ userId: GUEST, tours: {} }));
  });

  await test('guest: reads public data', async () => {
    await assertSucceeds(guest().doc('communityStats/global').get());
    await assertSucceeds(guest().doc('config/app').get());
    await assertSucceeds(guest().doc(`publicUserStats/${ALICE}`).get());
    await assertSucceeds(guest().doc('festivals/f1').get());
    await assertSucceeds(guest().doc(`userProfiles/${ALICE}`).get());
  });

  await test('guest: a private Year in Review, not a public one', async () => {
    await assertSucceeds(guest().doc(`yearInReviews/${GUEST}_2025`).set({ userId: GUEST, year: 2025, privacy: 'private' }));
    await assertFails(guest().doc(`yearInReviews/${GUEST}_2025`).update({ privacy: 'public' }));
    await assertFails(guest().doc(`yearInReviews/${GUEST}_2024`).set({ userId: GUEST, year: 2024, privacy: 'public' }));
    await assertSucceeds(alice().doc(`yearInReviews/${ALICE}_2025`).set({ userId: ALICE, year: 2025, privacy: 'public' }));
  });

  // ── Refused: social ─────────────────────────────────────────────────
  await test('guest: no friends, friend requests, tags, invites or suggestions', async () => {
    await assertFails(guest().doc(`users/${GUEST}/friends/${ALICE}`).set({ friendUid: ALICE }));
    await assertFails(guest().doc('friendRequests/r1').set({ from: GUEST, to: ALICE, fromName: 'G', toName: 'A', status: 'pending', createdAt: ts() }));
    await assertFails(guest().doc('showTags/t2').set({ fromUid: GUEST, fromName: 'G', toUid: ALICE, showData: {}, status: 'pending', createdAt: ts() }));
    await assertFails(guest().doc('showTags/t1').update({ status: 'accepted' }));
    await assertFails(guest().doc('invites/i1').set({ inviterUid: GUEST, inviteeEmail: 'x@example.com', status: 'pending' }));
    await assertFails(guest().doc('pendingEmailTags/e1').set({ fromUid: GUEST, toEmail: 'x@example.com', status: 'pending', showData: {} }));
    await assertFails(guest().doc(`showSuggestions/${GUEST}_${ALICE}_k`).set({ participants: [GUEST, ALICE] }));
    await assertFails(guest().collection('notifications').add({ uid: ALICE, type: 'x', message: 'hi' }));
  });

  await test('account: the same writes still go through', async () => {
    await assertSucceeds(alice().doc(`users/${ALICE}/friends/${BOB}`).set({ friendUid: BOB }));
    await assertSucceeds(alice().doc('friendRequests/r2').set({ from: ALICE, to: BOB, fromName: 'A', toName: 'B', status: 'pending', createdAt: ts() }));
    await assertSucceeds(alice().doc('showTags/t3').set({ fromUid: ALICE, fromName: 'A', toUid: BOB, showData: {}, status: 'pending', createdAt: ts() }));
    await assertSucceeds(alice().doc('invites/i2').set({ inviterUid: ALICE, inviteeEmail: 'x@example.com', status: 'pending' }));
    await assertSucceeds(alice().collection('notifications').add({ uid: BOB, type: 'x', message: 'hi' }));
  });

  // ── Refused: user-generated content, reading and writing (D-1) ──────
  await test('guest: cannot read comments, photos, meetups, activity or venue reviews', async () => {
    await assertFails(guest().doc('showComments/c1').get());
    await assertFails(guest().doc('showPhotos/p1').get());
    await assertFails(guest().doc('meetups/m1').get());
    await assertFails(guest().doc('meetupComments/mc1').get());
    await assertFails(guest().doc('userActivity/a1').get());
    await assertFails(guest().doc('venueRatings/v1').get());
    await assertFails(guest().doc('venueAnnouncements/va1').get());
    await assertFails(guest().doc('venuePhotos/vp1').get());
  });

  await test('account: can read them', async () => {
    await assertSucceeds(alice().doc('showComments/c1').get());
    await assertSucceeds(alice().doc('showPhotos/p1').get());
    await assertSucceeds(alice().doc('meetups/m1').get());
    await assertSucceeds(alice().doc('userActivity/a1').get());
    await assertSucceeds(alice().doc('venueRatings/v1').get());
  });

  await test('guest: cannot like, rate, post activity, create meetups or report', async () => {
    await assertFails(guest().doc('showComments/c1').update({ likedBy: [GUEST] }));
    await assertFails(guest().doc('showPhotos/p1').update({ likedBy: [GUEST] }));
    await assertFails(guest().doc('meetups/m2').set({ createdBy: GUEST, attendeeUids: [GUEST], description: '' }));
    await assertFails(guest().doc('venueRatings/v2').set({ userId: GUEST, venueKey: 'k', overallRating: 4 }));
    await assertFails(guest().doc('userActivity/a2').set({ userId: GUEST, type: 'show' }));
    await assertFails(guest().doc('reports/r1').set({ reporterId: GUEST, status: 'open' }));
    await assertFails(guest().doc('venueReports/vr1').set({ reporterUid: GUEST }));
  });

  // ── Refused: festivals, venues, roadmap ─────────────────────────────
  await test('guest: cannot join or create festivals, or create venue records', async () => {
    await assertFails(guest().doc(`users/${GUEST}/festivals/a1`).set({ festivalId: 'f1', notes: '' }));
    await assertFails(guest().doc('festivals/f2').set({ name: 'New', nameNormalized: 'new', year: 2025, createdBy: GUEST }));
    await assertFails(guest().doc('venues/k').set({ name: 'X' }));
    await assertFails(guest().doc('venueVerificationApplications/v1').set({ applicantUid: GUEST }));
    await assertFails(guest().doc('venueAnnouncements/va2').set({ venueKey: 'k', text: 'x' }));
    await assertFails(guest().doc('venuePhotos/vp2').set({ uploadedBy: GUEST }));
    await assertSucceeds(alice().doc(`users/${ALICE}/festivals/a1`).set({ festivalId: 'f1', notes: '' }));
    await assertSucceeds(alice().doc('festivals/f3').set({ name: 'New', nameNormalized: 'new', year: 2025, createdBy: ALICE }));
  });

  await test('guest: no roadmap submissions or votes; feedback is fine (D-3)', async () => {
    await assertFails(guest().doc('roadmapItems/d1').set({ title: 'x', status: 'draft', submitterUid: GUEST, voteCount: 0 }));
    const g = guest();
    const batch = g.batch();
    batch.set(g.doc(`roadmapItems/live1/voters/${GUEST}`), { votedAt: ts() });
    batch.update(g.doc('roadmapItems/live1'), { voteCount: 4, updatedAt: ts() });
    await assertFails(batch.commit());
    await assertSucceeds(guest().doc('feedback/fb1').set({ submitterUid: GUEST, message: 'hi' }));
  });

  // ── Linked: a full account at once ──────────────────────────────────
  await test('linked: the account is no longer a guest, whatever sign_in_provider says', async () => {
    await assertSucceeds(linked().doc(`users/${GUEST}/friends/${ALICE}`).set({ friendUid: ALICE }));
    await assertSucceeds(linked().doc('showComments/c1').get());
    await assertSucceeds(linked().doc(`users/${GUEST}/festivals/a1`).set({ festivalId: 'f1', notes: '' }));
  });

  // ── Storage ─────────────────────────────────────────────────────────
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await test('storage: a guest cannot upload or view show photos, or upload venue files', async () => {
    const s = guestCtx().storage();
    await assertFails(s.ref(`showPhotos/k/${GUEST}/a.png`).put(PNG, { contentType: 'image/png' }));
    await assertFails(s.ref(`showPhotos/k/${BOB}/b.png`).getDownloadURL());
    await assertFails(s.ref(`venuePhotos/v/${GUEST}/a.png`).put(PNG, { contentType: 'image/png' }));
    await assertFails(s.ref(`venueVerificationDocs/v/${GUEST}/a.png`).put(PNG, { contentType: 'image/png' }));
  });

  await test('storage: an account still uploads its own show photo', async () => {
    await assertSucceeds(aliceCtx().storage().ref(`showPhotos/k/${ALICE}/a.png`).put(PNG, { contentType: 'image/png' }));
  });

  await testEnv.cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
