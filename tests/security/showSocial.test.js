/**
 * Stage 3, Part 3a (5.60.29), against an in-memory Firestore:
 *   - friends.js tag, respondTag, revokeTag, refreshUpcomingTags and
 *     respondSuggestion (C-2, C-3): who may, what a tag carries (the
 *     tagger's stored show, never the request's), the emails
 *   - engagement-notify and moderate-content (C-5): engagement
 *     notifications written by the server, only for a like or join that is
 *     stored, never to yourself, across a block or to someone opted out
 *   - no client code writes a tag, a suggestion answer or a notification
 *
 *   node tests/security/showSocial.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('module');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');

// moderate-content reaches firebase-admin directly; give it the fakes.
let db;
let auth;
const fakeModules = {
  'firebase-admin/app': { getApps: () => [{}], initializeApp: () => ({}), cert: () => ({}) },
  'firebase-admin/auth': { getAuth: () => auth },
  'firebase-admin/firestore': {
    getFirestore: () => db,
    FieldValue: { serverTimestamp: () => new Date() },
  },
};
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (fakeModules[request]) return fakeModules[request];
  return realLoad.call(this, request, parent, isMain);
};

const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestTransport } = require('../../netlify/functions/lib/outgoingEmail');
const friends = require('../../netlify/functions/friends');
const engagementNotify = require('../../netlify/functions/engagement-notify');
const moderateContent = require('../../netlify/functions/moderate-content');
const { pastTagShowData, nextSuggestionStatus } = require('../../netlify/functions/lib/showSocialActions');

const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com', name: 'Alice' };
const BOB = { uid: 'bobUid00000001', email: 'bob@example.com', name: 'Bob' };
const CAROL = { uid: 'carolUid000001', email: 'carol@example.com', name: 'Carol' };
const MALLORY = { uid: 'malloryUid0001', email: 'mallory@example.com', name: 'Mallory' };
const GUEST = { uid: 'guestUid000001', firebase: { sign_in_provider: 'anonymous' } };
const FUTURE = '2099-06-01';

let sent;
function setup() {
  db = createFakeDb();
  auth = createFakeAuth({
    tokens: { alice: ALICE, bob: BOB, carol: CAROL, mallory: MALLORY, guest: GUEST },
    users: [ALICE, BOB, CAROL, MALLORY, { uid: GUEST.uid, providerData: [] }],
  });
  __setTestFirebase({ db, auth });
  sent = [];
  __setTestTransport((p, payload) => { sent.push(payload); return { status: 200, body: '{"id":"x"}' }; });
  for (const u of [ALICE, BOB, CAROL, MALLORY]) db._put(`userProfiles/${u.uid}`, { displayName: u.name });
  // Alice and Bob are friends; Alice and Carol too; Mallory is nobody's.
  for (const [a, b] of [[ALICE, BOB], [ALICE, CAROL]]) {
    db._put(`users/${a.uid}/friends/${b.uid}`, { friendUid: b.uid, friendName: b.name });
    db._put(`users/${b.uid}/friends/${a.uid}`, { friendUid: a.uid, friendName: a.name });
  }
  db._put(`users/${ALICE.uid}/shows/s1`, {
    artist: 'Phish', venue: 'MSG', city: 'New York, NY', date: '2025-12-31', tour: 'NYE',
    setlist: [{ id: 'a1', name: 'Tweezer', rating: 9, comment: 'my note' }], rating: 10, comment: 'private', taggedFriendUids: [],
  });
  db._put(`users/${ALICE.uid}/upcomingShows/u1`, {
    artist: 'Goose', venue: 'Red Rocks', city: 'Morrison, CO', date: FUTURE, time: '19:00', notes: 'mine', taggedFriendUids: [],
  });
  return db;
}

const post = (handler) => (token, body) => handler({
  httpMethod: 'POST',
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: JSON.stringify(body),
});
const callFriends = post(friends.handler);
const callEngagement = post(engagementNotify.handler);
const callModerate = post(moderateContent.handler);
const json = (res) => JSON.parse(res.body);
const tagsFrom = (uid) => db._list('showTags').filter((t) => t.fromUid === uid);
const notificationsFor = (uid) => db._list('notifications').filter((n) => n.uid === uid);

// ── tag ──────────────────────────────────────────────────────────────

test('tag: from the stored show, never the request; mutual friends only; listed on the show; emailed', async () => {
  setup();
  db._put(`userBlocks/${CAROL.uid}`, { userId: CAROL.uid, blockedUserIds: [ALICE.uid] });
  const res = await callFriends('alice', {
    action: 'tag', showId: 's1', friendUids: [BOB.uid, CAROL.uid, MALLORY.uid, ALICE.uid],
    showData: { artist: 'Forged', setlist: [] },
  });
  assert.strictEqual(res.statusCode, 200, res.body);
  const b = json(res);
  assert.deepStrictEqual(b.tagged, [BOB.uid]);
  assert.deepStrictEqual(b.skipped.sort(), [CAROL.uid, MALLORY.uid].sort(), 'blocked and non-friends skipped; yourself dropped');
  const [tag] = tagsFrom(ALICE.uid);
  assert.strictEqual(tag.toUid, BOB.uid);
  assert.strictEqual(tag.showId, 's1');
  assert.strictEqual(tag.fromName, 'Alice');
  assert.strictEqual(tag.status, 'pending');
  assert.deepStrictEqual(tag.showData, pastTagShowData(db._get(`users/${ALICE.uid}/shows/s1`)));
  assert.strictEqual(tag.showData.artist, 'Phish');
  assert.deepStrictEqual(tag.showData.setlist, [{ id: 'a1', name: 'Tweezer' }], 'no ratings or notes');
  assert.ok(!('rating' in tag.showData) && !('comment' in tag.showData));
  assert.deepStrictEqual(db._get(`users/${ALICE.uid}/shows/s1`).taggedFriendUids, [BOB.uid]);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, BOB.email);
});

test('tag: a friend already holding a pending tag for the show isn’t tagged twice', async () => {
  setup();
  await callFriends('alice', { action: 'tag', showId: 's1', friendUids: [BOB.uid] });
  const again = json(await callFriends('alice', { action: 'tag', showId: 's1', friendUids: [BOB.uid] }));
  assert.deepStrictEqual(again.tagged, [BOB.uid]);
  assert.strictEqual(tagsFrom(ALICE.uid).length, 1);
  assert.strictEqual(sent.length, 1);
});

test('tag: an upcoming show carries upcomingShowId and the upcoming copy', async () => {
  setup();
  const res = await callFriends('alice', { action: 'tag', upcomingId: 'u1', friendUids: [BOB.uid] });
  assert.strictEqual(res.statusCode, 200, res.body);
  const [tag] = tagsFrom(ALICE.uid);
  assert.strictEqual(tag.upcomingShowId, 'u1');
  assert.strictEqual(tag.showData.upcoming, true);
  assert.strictEqual(tag.showData.time, '19:00');
  assert.ok(!('notes' in tag.showData));
  assert.deepStrictEqual(db._get(`users/${ALICE.uid}/upcomingShows/u1`).taggedFriendUids, [BOB.uid]);
});

test('tag: someone without an account gets a pending email tag and an invite', async () => {
  setup();
  const res = await callFriends('alice', { action: 'tag', showId: 's1', emails: [{ email: ' New@Example.com ', name: 'Newt', message: 'You were there!' }] });
  assert.strictEqual(res.statusCode, 200, res.body);
  const [p] = db._list('pendingEmailTags');
  assert.strictEqual(p.toEmail, 'new@example.com');
  assert.strictEqual(p.toName, 'Newt');
  assert.strictEqual(p.fromUid, ALICE.uid);
  assert.strictEqual(p.showData.artist, 'Phish');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, 'new@example.com');
  assert.strictEqual((await callFriends('alice', { action: 'tag', showId: 's1', emails: [{ email: 'alice@example.com' }] })).statusCode, 400, 'not your own address');
  assert.strictEqual((await callFriends('alice', { action: 'tag', upcomingId: 'u1', emails: [{ email: 'x@example.com' }] })).statusCode, 400, 'past shows only');
});

test('tag: someone else’s show, no show, or nobody to tag is refused; a guest is refused', async () => {
  setup();
  assert.strictEqual((await callFriends('bob', { action: 'tag', showId: 's1', friendUids: [ALICE.uid] })).statusCode, 404, 'only your own show');
  assert.strictEqual((await callFriends('alice', { action: 'tag', friendUids: [BOB.uid] })).statusCode, 400);
  assert.strictEqual((await callFriends('alice', { action: 'tag', showId: 's1', upcomingId: 'u1', friendUids: [BOB.uid] })).statusCode, 400);
  assert.strictEqual((await callFriends('alice', { action: 'tag', showId: 's1' })).statusCode, 400);
  const g = await callFriends('guest', { action: 'tag', showId: 's1', friendUids: [BOB.uid] });
  assert.strictEqual(g.statusCode, 403);
  assert.strictEqual(json(g).code, 'account_required');
});

// ── respondTag / revokeTag / refreshUpcomingTags ─────────────────────

test('respondTag: decline by the recipient only; the same answer twice is fine; a changed one isn’t', async () => {
  setup();
  db._put('showTags/t1', { fromUid: ALICE.uid, toUid: BOB.uid, status: 'pending', showData: { artist: 'Phish' } });
  assert.strictEqual((await callFriends('carol', { action: 'respondTag', tagId: 't1', response: 'declined' })).statusCode, 403);
  assert.strictEqual((await callFriends('bob', { action: 'respondTag', tagId: 't1', response: 'declined' })).statusCode, 200);
  assert.strictEqual(db._get('showTags/t1').status, 'declined');
  assert.strictEqual((await callFriends('bob', { action: 'respondTag', tagId: 't1', response: 'declined' })).statusCode, 200);
  assert.strictEqual((await callFriends('bob', { action: 'respondTag', tagId: 't1', response: 'accepted' })).statusCode, 409);
});

test('respondTag: a past show’s tag is accepted through normalize-show; a revoked one can’t be answered', async () => {
  setup();
  db._put('showTags/t1', { fromUid: ALICE.uid, toUid: BOB.uid, status: 'pending', showData: { artist: 'Phish', date: '2025-12-31' } });
  const res = await callFriends('bob', { action: 'respondTag', tagId: 't1', response: 'accepted' });
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(json(res).code, 'use_normalize_show');
  db._put('showTags/t2', { fromUid: ALICE.uid, toUid: BOB.uid, status: 'revoked', showData: { artist: 'Phish' } });
  assert.strictEqual((await callFriends('bob', { action: 'respondTag', tagId: 't2', response: 'declined' })).statusCode, 409);
});

test('respondTag: accepting an upcoming tag adds it to the friend’s upcoming list with the credit', async () => {
  setup();
  await callFriends('alice', { action: 'tag', upcomingId: 'u1', friendUids: [BOB.uid] });
  const [tag] = tagsFrom(ALICE.uid);
  const tagId = db._list('showTags')[0].id;
  const res = await callFriends('bob', { action: 'respondTag', tagId, response: 'accepted' });
  assert.strictEqual(res.statusCode, 200, res.body);
  const b = json(res);
  assert.strictEqual(b.duplicate, false);
  const mine = db._get(`users/${BOB.uid}/upcomingShows/${b.upcomingId}`);
  assert.strictEqual(mine.artist, 'Goose');
  assert.strictEqual(mine.date, FUTURE);
  assert.strictEqual(mine.taggedBy, 'Alice');
  assert.strictEqual(mine.taggedByUid, ALICE.uid);
  assert.strictEqual(mine.originUpcomingId, 'u1');
  assert.strictEqual(db._get(`showTags/${tagId}`).status, 'accepted');
  assert.ok(tag);
});

test('respondTag: an upcoming show already on the list takes the credit; a passed date is date_passed', async () => {
  setup();
  db._put(`users/${BOB.uid}/upcomingShows/mine`, { artist: 'goose ', venue: 'RR', date: FUTURE, taggedFriendUids: [] });
  db._put('showTags/t1', { fromUid: ALICE.uid, fromName: 'Alice', toUid: BOB.uid, upcomingShowId: 'u1', status: 'pending', showData: { artist: 'Goose', venue: 'Red Rocks', date: FUTURE, upcoming: true } });
  const b = json(await callFriends('bob', { action: 'respondTag', tagId: 't1', response: 'accepted' }));
  assert.strictEqual(b.upcomingId, 'mine');
  assert.strictEqual(b.duplicate, true);
  assert.strictEqual(db._get(`users/${BOB.uid}/upcomingShows/mine`).taggedBy, 'Alice');
  assert.strictEqual(db._list(`users/${BOB.uid}/upcomingShows`).length, 1);

  db._put('showTags/t2', { fromUid: ALICE.uid, toUid: BOB.uid, upcomingShowId: 'u1', status: 'pending', showData: { artist: 'Goose', venue: 'Red Rocks', date: '2020-01-01', upcoming: true } });
  const late = await callFriends('bob', { action: 'respondTag', tagId: 't2', response: 'accepted' });
  assert.strictEqual(late.statusCode, 409);
  assert.strictEqual(json(late).code, 'date_passed');
  assert.strictEqual(db._get('showTags/t2').status, 'pending', 'left for normalize-show');
});

test('respondTag: a pending email tag is declined by the account with that address only', async () => {
  setup();
  db._put('pendingEmailTags/p1', { fromUid: ALICE.uid, toEmail: 'bob@example.com', status: 'pending', showData: {} });
  assert.strictEqual((await callFriends('carol', { action: 'respondTag', pendingEmailTagId: 'p1', response: 'declined' })).statusCode, 403);
  assert.strictEqual((await callFriends('bob', { action: 'respondTag', pendingEmailTagId: 'p1', response: 'accepted' })).statusCode, 409);
  assert.strictEqual((await callFriends('bob', { action: 'respondTag', pendingEmailTagId: 'p1', response: 'declined' })).statusCode, 200);
  assert.strictEqual(db._get('pendingEmailTags/p1').status, 'declined');
});

test('revokeTag: the sender only, pending only; untagging takes the friend off the show', async () => {
  setup();
  await callFriends('alice', { action: 'tag', upcomingId: 'u1', friendUids: [BOB.uid, CAROL.uid] });
  const bobTag = db._list('showTags').find((t) => t.toUid === BOB.uid);
  assert.strictEqual((await callFriends('bob', { action: 'revokeTag', tagId: bobTag.id })).statusCode, 403);
  const res = json(await callFriends('alice', { action: 'revokeTag', upcomingId: 'u1', toUid: BOB.uid }));
  assert.strictEqual(res.revoked, 1);
  assert.strictEqual(db._get(`showTags/${bobTag.id}`).status, 'revoked');
  assert.strictEqual(db._list('showTags').find((t) => t.toUid === CAROL.uid).status, 'pending');
  assert.deepStrictEqual(db._get(`users/${ALICE.uid}/upcomingShows/u1`).taggedFriendUids, [CAROL.uid]);
  // Deleting the show revokes the rest (the show is gone by then).
  db._store.delete(`users/${ALICE.uid}/upcomingShows/u1`);
  assert.strictEqual(json(await callFriends('alice', { action: 'revokeTag', upcomingId: 'u1' })).revoked, 1);
  assert.strictEqual(db._list('showTags').find((t) => t.toUid === CAROL.uid).status, 'revoked');
});

test('refreshUpcomingTags: pending tags take the edited date; answered ones are left', async () => {
  setup();
  await callFriends('alice', { action: 'tag', upcomingId: 'u1', friendUids: [BOB.uid, CAROL.uid] });
  const carolTag = db._list('showTags').find((t) => t.toUid === CAROL.uid);
  db._put(`showTags/${carolTag.id}`, { ...db._get(`showTags/${carolTag.id}`), status: 'accepted' });
  db._put(`users/${ALICE.uid}/upcomingShows/u1`, { ...db._get(`users/${ALICE.uid}/upcomingShows/u1`), date: '2099-07-04' });
  assert.strictEqual(json(await callFriends('alice', { action: 'refreshUpcomingTags', upcomingId: 'u1' })).updated, 1);
  assert.strictEqual(db._list('showTags').find((t) => t.toUid === BOB.uid).showData.date, '2099-07-04');
  assert.strictEqual(db._get(`showTags/${carolTag.id}`).showData.date, FUTURE);
});

// ── respondSuggestion ────────────────────────────────────────────────

test('respondSuggestion: participants only; status from both answers; one nudge email', async () => {
  setup();
  db._put('showSuggestions/g1', {
    participants: [ALICE.uid, BOB.uid], names: {}, showKey: 'k', showData: { artist: 'Phish', venue: 'MSG', date: '2025-12-31', city: '' },
    responses: { [ALICE.uid]: 'pending', [BOB.uid]: 'pending' }, overallStatus: 'pending',
  });
  assert.strictEqual((await callFriends('carol', { action: 'respondSuggestion', suggestionId: 'g1', response: 'confirmed' })).statusCode, 403);
  const a = json(await callFriends('alice', { action: 'respondSuggestion', suggestionId: 'g1', response: 'confirmed' }));
  assert.deepStrictEqual(a, { success: true, overallStatus: 'partially_confirmed', nudged: true });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, BOB.email);
  assert.strictEqual(db._get('showSuggestions/g1').emailSentToUid, BOB.uid);
  const b = json(await callFriends('bob', { action: 'respondSuggestion', suggestionId: 'g1', response: 'confirmed' }));
  assert.strictEqual(b.overallStatus, 'confirmed');
  assert.strictEqual(b.nudged, false);
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(db._get('showSuggestions/g1').responses, { [ALICE.uid]: 'confirmed', [BOB.uid]: 'confirmed' });
});

test('respondSuggestion: a backfill suggestion is never emailed; declining ends it', async () => {
  setup();
  db._put('showSuggestions/g2', {
    participants: [ALICE.uid, BOB.uid], showData: { artist: 'X', venue: '', date: '', city: '' },
    responses: { [ALICE.uid]: 'pending', [BOB.uid]: 'pending' }, overallStatus: 'pending', backfill: true,
  });
  assert.strictEqual(json(await callFriends('alice', { action: 'respondSuggestion', suggestionId: 'g2', response: 'confirmed' })).nudged, false);
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(json(await callFriends('bob', { action: 'respondSuggestion', suggestionId: 'g2', response: 'declined' })).overallStatus, 'declined');
  assert.strictEqual(nextSuggestionStatus({ participants: ['a', 'b'], responses: { b: 'confirmed' } }, 'a', 'confirmed'), 'confirmed');
});

// ── engagement-notify ────────────────────────────────────────────────

test('engagement-notify: a stored like notifies the author once, as the server words it', async () => {
  setup();
  db._put('showComments/c1', { concertKey: 'phish|msg|2025-12-31', authorUid: BOB.uid, likedBy: [], artist: 'Phish', venue: 'MSG', date: '2025-12-31' });
  const notLiked = await callEngagement('alice', { type: 'comment_like', id: 'c1' });
  assert.strictEqual(notLiked.statusCode, 409);
  assert.strictEqual(json(notLiked).code, 'not_liked');
  db._put('showComments/c1', { ...db._get('showComments/c1'), likedBy: [ALICE.uid] });
  const res = await callEngagement('alice', { type: 'comment_like', id: 'c1', show: { artist: 'Ignored' } });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.strictEqual(json(res).written, true);
  const [n] = notificationsFor(BOB.uid);
  assert.strictEqual(n.type, 'comment_like');
  assert.strictEqual(n.fromUid, ALICE.uid);
  assert.strictEqual(n.fromName, 'Alice');
  assert.strictEqual(n.message, 'Alice liked your comment on Phish');
  assert.strictEqual(n.read, false);
  // Unlike and like again: still one.
  assert.strictEqual(json(await callEngagement('alice', { type: 'comment_like', id: 'c1' })).reason, 'already_notified');
  assert.strictEqual(notificationsFor(BOB.uid).length, 1);
  assert.strictEqual(sent.length, 0, 'no email unless the recipient chose immediate');
});

test('engagement-notify: an old comment takes the show from the request; photo nouns; meetups', async () => {
  setup();
  db._put('showComments/old', { concertKey: 'k', authorUid: BOB.uid, likedBy: [ALICE.uid] });
  await callEngagement('alice', { type: 'comment_like', id: 'old', show: { artist: 'Goose' } });
  assert.strictEqual(notificationsFor(BOB.uid)[0].message, 'Alice liked your comment on Goose');
  db._put('showPhotos/p1', { concertKey: 'k', uploadedBy: CAROL.uid, likedBy: [ALICE.uid], artist: 'Phish', category: 'setlist', type: 'image' });
  await callEngagement('alice', { type: 'photo_like', id: 'p1' });
  assert.strictEqual(notificationsFor(CAROL.uid)[0].message, 'Alice liked your setlist photo from Phish');
  db._put('meetups/m1', { concertKey: 'k', createdBy: CAROL.uid, attendeeUids: [CAROL.uid], artist: 'Phish' });
  assert.strictEqual(json(await callEngagement('bob', { type: 'meetup_join', id: 'm1' })).code, 'not_joined');
  db._put('meetups/m1', { ...db._get('meetups/m1'), attendeeUids: [CAROL.uid, BOB.uid] });
  await callEngagement('bob', { type: 'meetup_join', id: 'm1' });
  assert.strictEqual(notificationsFor(CAROL.uid).find((n) => n.type === 'meetup_join').message, 'Bob is meeting up with you at Phish');
});

test('engagement-notify: nothing for yourself, across a block, or for someone opted out; immediate email when chosen', async () => {
  setup();
  db._put('showComments/mine', { concertKey: 'k', authorUid: ALICE.uid, likedBy: [ALICE.uid], artist: 'X' });
  assert.strictEqual(json(await callEngagement('alice', { type: 'comment_like', id: 'mine' })).reason, 'self');
  db._put('showComments/c2', { concertKey: 'k', authorUid: BOB.uid, likedBy: [MALLORY.uid], artist: 'X' });
  db._put(`userBlocks/${BOB.uid}`, { userId: BOB.uid, blockedUserIds: [MALLORY.uid] });
  assert.strictEqual(json(await callEngagement('mallory', { type: 'comment_like', id: 'c2' })).reason, 'blocked');
  db._put('showComments/c3', { concertKey: 'k', authorUid: CAROL.uid, likedBy: [ALICE.uid], artist: 'X' });
  db._put(`userProfiles/${CAROL.uid}`, { displayName: 'Carol', notificationPrefs: { engagementNotifications: false } });
  assert.strictEqual(json(await callEngagement('alice', { type: 'comment_like', id: 'c3' })).reason, 'opted_out');
  assert.strictEqual(db._list('notifications').length, 0);

  db._put(`userProfiles/${BOB.uid}`, { displayName: 'Bob', notificationPrefs: { emailFrequency: 'immediate' } });
  db._put('showComments/c4', { concertKey: 'k', authorUid: BOB.uid, likedBy: [ALICE.uid], artist: 'Phish' });
  await callEngagement('alice', { type: 'comment_like', id: 'c4' });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, BOB.email);

  const g = await callEngagement('guest', { type: 'comment_like', id: 'c4' });
  assert.strictEqual(g.statusCode, 403);
  assert.strictEqual(json(g).code, 'account_required');
});

// ── moderate-content: replies and mentions ───────────────────────────

test('moderate-content: a reply notifies the parent’s author; a mention notifies the author’s friend', async () => {
  setup();
  db._put('showComments/parent', { concertKey: 'phish|msg', authorUid: BOB.uid, likedBy: [] });
  const res = await callModerate('alice', {
    target: 'showComment', concertKey: 'phish|msg', parentId: 'parent', text: 'Great night @Carol and @Mallory',
    show: { artist: 'Phish', venue: 'MSG', date: '2025-12-31' },
  });
  assert.strictEqual(res.statusCode, 200, res.body);
  const comment = db._get(`showComments/${json(res).id}`);
  assert.strictEqual(comment.artist, 'Phish');
  assert.strictEqual(notificationsFor(BOB.uid)[0].type, 'comment_reply');
  assert.strictEqual(notificationsFor(BOB.uid)[0].message, 'Alice replied to your comment on Phish');
  assert.strictEqual(notificationsFor(CAROL.uid)[0].type, 'comment_mention');
  assert.strictEqual(notificationsFor(MALLORY.uid).length, 0, 'only the author’s own friends');
});

// ── No client writes ─────────────────────────────────────────────────

test('no client code writes a tag, a suggestion answer or an engagement notification', () => {
  const root = path.join(__dirname, '../..');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); } else if (/\.(js|jsx)$/.test(e.name)) files.push(p);
    }
  };
  ['app', 'components', 'context', 'hooks', 'lib'].forEach((d) => fs.existsSync(path.join(root, d)) && walk(path.join(root, d)));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f);
    assert.ok(!/collection\(db, 'showTags'\)\)/.test(src) && !/doc\(db, 'showTags', [^)]+\)[^;]*\{ status/.test(src), `${rel} writes a tag`);
    assert.ok(!/addDoc\(collection\(db, 'pendingEmailTags'\)/.test(src) && !/setDoc\(doc\(db, 'pendingEmailTags'/.test(src), `${rel} writes an email tag`);
    assert.ok(!/(updateDoc|setDoc)\([^)]*'showSuggestions'/.test(src) && !/doc\(db, 'showSuggestions', [^)]+\);\s*[\s\S]{0,80}updateDoc/.test(src), `${rel} answers a suggestion`);
    assert.ok(!/createEngagementNotification/.test(src), `${rel} writes an engagement notification`);
    // The admin's roadmap notice is the one client-written notification left.
    if (!rel.endsWith('AdminView.jsx')) assert.ok(!/addDoc\(collection\(db, 'notifications'\)/.test(src), `${rel} writes a notification`);
  }
});

run('Tags, suggestion answers and engagement notifications on the server (5.60.29)');
