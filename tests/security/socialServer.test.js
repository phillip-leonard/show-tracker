/**
 * Stage 6, Part 2a (5.60.38), against an in-memory Firestore and Storage:
 *   - likes written by engagement-notify (call A), the old shape still answered
 *   - meetups.js join and leave (call A): the show from your own bucket list
 *     item, names from profiles and never an email, the organizer notified
 *   - the activity feed (call B): friends.js `activity` and `rated`, and the
 *     entries moderate-content writes; mutual friends only, blocks and
 *     opt-outs left out, old builds' copies deduplicated
 *   - moderate-content's checks (call I): uploads read from Storage, the
 *     per-concert cap, reply parents, meetup messages, daily limits, names
 *   - report-content's `meetup` type and moderate-report's deletes (call J, I)
 *   - scripts/cleanup-meetup-names.js planning
 *   - no client code writes a like, a meetup or an activity entry
 *
 *   node tests/security/socialServer.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('module');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');

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
const meetups = require('../../netlify/functions/meetups');
const moderateContent = require('../../netlify/functions/moderate-content');
const moderateReport = require('../../netlify/functions/moderate-report');
const reportContent = require('../../netlify/functions/report-content');
const { dedupe, DEDUPE_MS } = require('../../netlify/functions/lib/activityLog');
const { meetupIdFor, mediaPathSegment } = require('../../lib/concertKeys');
const { showMatchKey } = require('../../lib/showIdentity');
const { planMeetupFixes, planCommentFixes } = require('../../scripts/cleanup-meetup-names');

const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com', name: 'Alice' };
const BOB = { uid: 'bobUid00000001', email: 'bob@example.com', name: 'Bob' };
const CAROL = { uid: 'carolUid000001', email: 'carol@example.com', name: 'Carol' };
const MALLORY = { uid: 'malloryUid0001', email: 'mallory@example.com', name: 'Mallory' };
// No display name: the account the old meetup card named by its email.
const NONAME = { uid: 'nonameUid00001', email: 'noname@example.com' };
const ADMIN = { uid: 'adminUid000001', email: 'admin@example.com', admin: true };
const GUEST = { uid: 'guestUid000001', firebase: { sign_in_provider: 'anonymous' } };
const KEY = 'phish|madison square garden|2025-12-31';
const SEGMENT = mediaPathSegment(KEY);
const MB = 1024 * 1024;

// A Storage bucket: objects by path, each { size, contentType, token? }.
let objects;
let deleted;
function fakeBucket() {
  return {
    name: 'test-bucket.firebasestorage.app',
    file(p) {
      return {
        bucket: { name: 'test-bucket.firebasestorage.app' },
        async getMetadata() {
          const o = objects.get(p);
          if (!o) { const e = new Error('No such object'); e.code = 404; throw e; }
          return [{ size: String(o.size), contentType: o.contentType, metadata: o.token ? { firebaseStorageDownloadTokens: o.token } : {} }];
        },
        async setMetadata({ metadata }) { objects.get(p).token = metadata.firebaseStorageDownloadTokens; },
        async delete() { deleted.push(p); objects.delete(p); },
      };
    },
  };
}

function setup() {
  db = createFakeDb();
  auth = createFakeAuth({
    tokens: { alice: ALICE, bob: BOB, carol: CAROL, mallory: MALLORY, noname: NONAME, admin: ADMIN, guest: GUEST },
    users: [ALICE, BOB, CAROL, MALLORY, NONAME, ADMIN, { uid: GUEST.uid, providerData: [] }],
  });
  __setTestFirebase({ db, auth });
  __setTestTransport(() => ({ status: 200, body: '{"id":"x"}' }));
  objects = new Map();
  deleted = [];
  moderateContent.__setTestBucket(fakeBucket());
  moderateReport.__setTestBucket(fakeBucket());
  for (const u of [ALICE, BOB, CAROL, MALLORY]) db._put(`userProfiles/${u.uid}`, { displayName: u.name });
  db._put(`userProfiles/${NONAME.uid}`, {});
  // Alice–Bob and Alice–Carol are friends; Alice has Mallory on her list, not back.
  for (const [a, b] of [[ALICE, BOB], [ALICE, CAROL]]) {
    db._put(`users/${a.uid}/friends/${b.uid}`, { friendUid: b.uid, friendName: b.name });
    db._put(`users/${b.uid}/friends/${a.uid}`, { friendUid: a.uid, friendName: a.name });
  }
  db._put(`users/${ALICE.uid}/friends/${MALLORY.uid}`, { friendUid: MALLORY.uid, friendName: 'Mallory' });
  db._put(`users/${BOB.uid}/shows/b1`, { artist: 'Phish', venue: 'Madison Square Garden', date: '2025-12-31', rating: 9 });
  db._put(`users/${ALICE.uid}/shows/a1`, { artist: 'Phish', venue: 'Madison Square Garden', date: '2025-12-31' });
  return db;
}

const post = (handler) => (token, body) => handler({
  httpMethod: 'POST',
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: JSON.stringify(body),
});
const callEngagement = post(engagementNotify.handler);
const callMeetups = post(meetups.handler);
const callFriends = post(friends.handler);
const callModerate = post(moderateContent.handler);
const callReportModeration = post(moderateReport.handler);
const callReport = post(reportContent.handler);
const json = (res) => JSON.parse(res.body);
const notificationsFor = (uid) => db._list('notifications').filter((n) => n.uid === uid);
const activityOf = (uid) => db._list('userActivity').filter((a) => a.userId === uid);

// ── Likes (call A) ───────────────────────────────────────────────────

test('likes: the server writes likedBy, notifies once, and unlikes', async () => {
  setup();
  db._put('showComments/c1', { concertKey: KEY, authorUid: BOB.uid, likedBy: [CAROL.uid], artist: 'Phish' });
  const res = await callEngagement('alice', { type: 'comment_like', id: 'c1', liked: true });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.deepStrictEqual(json(res), { liked: true, likeCount: 2, written: true });
  assert.deepStrictEqual(db._get('showComments/c1').likedBy, [CAROL.uid, ALICE.uid]);
  assert.strictEqual(notificationsFor(BOB.uid)[0].message, 'Alice liked your comment on Phish');
  // Again: no second uid, no second notification.
  assert.strictEqual(json(await callEngagement('alice', { type: 'comment_like', id: 'c1', liked: true })).likeCount, 2);
  assert.strictEqual(notificationsFor(BOB.uid).length, 1);
  const off = json(await callEngagement('alice', { type: 'comment_like', id: 'c1', liked: false }));
  assert.deepStrictEqual(off, { liked: false, likeCount: 1, written: false });
  assert.deepStrictEqual(db._get('showComments/c1').likedBy, [CAROL.uid], 'only the caller’s own uid goes');
});

test('likes: photos; your own; a banned account; a guest; a meetup can’t be liked; missing', async () => {
  setup();
  db._put('showPhotos/p1', { concertKey: KEY, uploadedBy: ALICE.uid, likedBy: [], artist: 'Phish', category: 'poster', type: 'image' });
  const own = json(await callEngagement('alice', { type: 'photo_like', id: 'p1', liked: true }));
  assert.strictEqual(own.liked, true);
  assert.strictEqual(own.written, false, 'nothing for yourself');
  const bob = json(await callEngagement('bob', { type: 'photo_like', id: 'p1', liked: true }));
  assert.strictEqual(bob.written, true);
  assert.strictEqual(notificationsFor(ALICE.uid)[0].message, 'Bob liked your poster from Phish');
  db._put(`userProfiles/${CAROL.uid}`, { displayName: 'Carol', banned: true });
  assert.strictEqual((await callEngagement('carol', { type: 'photo_like', id: 'p1', liked: true })).statusCode, 403);
  assert.strictEqual(db._get('showPhotos/p1').likedBy.includes(CAROL.uid), false);
  const guest = await callEngagement('guest', { type: 'photo_like', id: 'p1', liked: true });
  assert.strictEqual(guest.statusCode, 403);
  assert.strictEqual(json(guest).code, 'account_required');
  assert.strictEqual((await callEngagement('bob', { type: 'meetup_join', id: 'm1', liked: true })).statusCode, 400);
  assert.strictEqual((await callEngagement('bob', { type: 'photo_like', id: 'nope', liked: true })).statusCode, 404);
});

test('likes: the 5.60.29 shape (old builds) still only notifies a stored like', async () => {
  setup();
  db._put('showComments/c2', { concertKey: KEY, authorUid: BOB.uid, likedBy: [], artist: 'Phish' });
  assert.strictEqual(json(await callEngagement('alice', { type: 'comment_like', id: 'c2' })).code, 'not_liked');
  db._put('showComments/c2', { ...db._get('showComments/c2'), likedBy: [ALICE.uid] });
  assert.strictEqual(json(await callEngagement('alice', { type: 'comment_like', id: 'c2' })).written, true);
  assert.deepStrictEqual(db._get('showComments/c2').likedBy, [ALICE.uid], 'the old shape writes no like');
});

// ── Meetups (call A) ─────────────────────────────────────────────────

const ITEM_KEY = 'phish_madison-square-garden_2026-07-04';
function putBucketItem(user, extra = {}) {
  db._put(`bucketList/${user.uid}_${ITEM_KEY}`, {
    userId: user.uid, artist: 'Phish', venue: 'Madison Square Garden', city: 'New York', date: '2026-07-04', source: 'manual', ...extra,
  });
}

test('meetups: join from your own bucket list item creates it, with your profile name and never your email', async () => {
  setup();
  putBucketItem(NONAME);
  const res = await callMeetups('noname', { action: 'join', bucketListItemKey: ITEM_KEY });
  assert.strictEqual(res.statusCode, 200, res.body);
  const { meetup, created } = json(res);
  const key = showMatchKey({ artist: 'Phish', venue: 'Madison Square Garden', date: '2026-07-04' });
  assert.strictEqual(created, true);
  assert.strictEqual(meetup.id, meetupIdFor(key));
  const stored = db._get(`meetups/${meetup.id}`);
  assert.strictEqual(stored.concertKey, key);
  assert.strictEqual(stored.createdBy, NONAME.uid);
  assert.strictEqual(stored.createdByName, 'Someone');
  assert.deepStrictEqual(stored.attendeeNames, { [NONAME.uid]: 'Someone' });
  assert.ok(!JSON.stringify(stored).includes('@'), 'no email anywhere on the shared document');
  assert.strictEqual(stored.description, '');
});

test('meetups: a second person joins (own name only), the organizer hears once; leave takes uid and name', async () => {
  setup();
  putBucketItem(ALICE);
  putBucketItem(BOB);
  const id = json(await callMeetups('alice', { action: 'join', bucketListItemKey: ITEM_KEY })).meetup.id;
  db._put(`meetups/${id}`, { ...db._get(`meetups/${id}`), attendeeNames: { [ALICE.uid]: 'Alice' } });
  const joined = json(await callMeetups('bob', { action: 'join', bucketListItemKey: ITEM_KEY }));
  assert.strictEqual(joined.created, false);
  assert.deepStrictEqual(db._get(`meetups/${id}`).attendeeUids, [ALICE.uid, BOB.uid]);
  assert.deepStrictEqual(db._get(`meetups/${id}`).attendeeNames, { [ALICE.uid]: 'Alice', [BOB.uid]: 'Bob' });
  const [n] = notificationsFor(ALICE.uid);
  assert.strictEqual(n.type, 'meetup_join');
  assert.strictEqual(n.message, 'Bob is meeting up with you at Phish');
  assert.strictEqual(json(await callMeetups('bob', { action: 'join', meetupId: id })).already, true);
  assert.strictEqual(notificationsFor(ALICE.uid).length, 1);
  // Carol has no bucket item; she joins by id.
  assert.strictEqual(json(await callMeetups('carol', { action: 'join', meetupId: id })).meetup.attendeeUids.length, 3);
  const left = json(await callMeetups('bob', { action: 'leave', meetupId: id }));
  assert.deepStrictEqual(left.meetup.attendeeUids, [ALICE.uid, CAROL.uid]);
  assert.ok(!(BOB.uid in db._get(`meetups/${id}`).attendeeNames));
  assert.strictEqual(json(await callMeetups('bob', { action: 'leave', meetupId: id })).already, true);
});

test('meetups: someone else’s item, a missing meetup, filtered text, a banned account and a guest are refused', async () => {
  setup();
  putBucketItem(BOB);
  assert.strictEqual((await callMeetups('alice', { action: 'join', bucketListItemKey: ITEM_KEY })).statusCode, 404);
  assert.strictEqual((await callMeetups('alice', { action: 'join', meetupId: 'no_such_meetup' })).statusCode, 404);
  assert.strictEqual((await callMeetups('alice', { action: 'join', bucketListItemKey: '../x' })).statusCode, 400);
  putBucketItem(ALICE, { venue: 'mail me at someone@example.com' });
  assert.strictEqual((await callMeetups('alice', { action: 'join', bucketListItemKey: ITEM_KEY })).statusCode, 422);
  db._put(`userProfiles/${CAROL.uid}`, { displayName: 'Carol', banned: true });
  putBucketItem(CAROL);
  assert.strictEqual((await callMeetups('carol', { action: 'join', bucketListItemKey: ITEM_KEY })).statusCode, 403);
  assert.strictEqual((await callMeetups('guest', { action: 'join', meetupId: 'x' })).statusCode, 403);
  assert.strictEqual(db._list('meetups').length, 0);
});

// ── Activity (call B) ────────────────────────────────────────────────

test('activity: mutual friends only; blocks either way and opt-outs left out; newest first', async () => {
  setup();
  const at = (min) => new Date(Date.UTC(2026, 10, 19, 12, min));
  db._put('userActivity/b1', { userId: BOB.uid, userName: 'Bob', action: 'added_show', showId: 'b1', artist: 'Phish', timestamp: at(1) });
  db._put('userActivity/c1', { userId: CAROL.uid, userName: 'Carol', action: 'rated_show', showId: 'c9', artist: 'Goose', rating: 8, timestamp: at(30) });
  db._put('userActivity/m1', { userId: MALLORY.uid, userName: 'Mallory', action: 'added_show', showId: 'm1', artist: 'Phish', timestamp: at(40) });
  const res = await callFriends('alice', { action: 'activity' });
  assert.strictEqual(res.statusCode, 200, res.body);
  const { items } = json(res);
  assert.deepStrictEqual(items.map((i) => i.id), ['c1', 'b1'], 'Mallory isn’t a friend back');
  assert.strictEqual(items[0].rating, 8);
  assert.strictEqual(items[0].timestamp, at(30).getTime());
  db._put(`userBlocks/${CAROL.uid}`, { blockedUserIds: [ALICE.uid] });
  db._put(`userProfiles/${BOB.uid}`, { displayName: 'Bob', shareActivity: false });
  assert.deepStrictEqual(json(await callFriends('alice', { action: 'activity' })).items, []);
  assert.strictEqual((await callFriends('guest', { action: 'activity' })).statusCode, 403);
});

test('activity: an old build’s copy of an entry is one entry; separate comments stay separate', () => {
  const t = 1_700_000_000_000;
  const items = [
    { id: 'server', userId: 'u', action: 'added_show', showId: 's', timestamp: t + 1000 },
    { id: 'old', userId: 'u', action: 'added_show', showId: 's', timestamp: t },
    { id: 'later', userId: 'u', action: 'added_show', showId: 's', timestamp: t - DEDUPE_MS - 2000 },
    { id: 'cA', userId: 'u', action: 'commented', showId: 's', commentId: 'a', timestamp: t },
    { id: 'cB', userId: 'u', action: 'commented', showId: 's', commentId: 'b', timestamp: t - 1000 },
  ];
  assert.deepStrictEqual(dedupe(items).map((i) => i.id), ['server', 'later', 'cA', 'cB']);
});

test('activity: `rated` is built from the stored show; an opted-out account writes nothing', async () => {
  setup();
  const res = await callFriends('bob', { action: 'rated', showId: 'b1', rating: 2, artist: 'Forged' });
  assert.strictEqual(json(res).written, true, res.body);
  const [entry] = activityOf(BOB.uid);
  assert.strictEqual(entry.action, 'rated_show');
  assert.strictEqual(entry.rating, 9, 'the stored rating, not the request');
  assert.strictEqual(entry.artist, 'Phish');
  assert.strictEqual(entry.userName, 'Bob');
  await callFriends('bob', { action: 'rated', showId: 'b1' });
  assert.strictEqual(activityOf(BOB.uid).length, 1, 'a re-rating rewrites the one entry');
  assert.strictEqual((await callFriends('bob', { action: 'rated', showId: 'nope' })).statusCode, 404);
  db._put(`userProfiles/${BOB.uid}`, { displayName: 'Bob', shareActivity: false });
  db._put('userActivity/x', undefined);
  db._store.clear();
  setup();
  db._put(`userProfiles/${BOB.uid}`, { displayName: 'Bob', shareActivity: false });
  assert.strictEqual(json(await callFriends('bob', { action: 'rated', showId: 'b1' })).written, false);
  assert.strictEqual(activityOf(BOB.uid).length, 0);
});

// ── moderate-content (calls B and I) ─────────────────────────────────

test('comments: a comment writes the poster’s activity, linked to their own show only', async () => {
  setup();
  db._put(`userProfiles/${ALICE.uid}`, { displayName: 'Alice', publicProfile: true, handle: 'alice' });
  const res = await callModerate('alice', { target: 'showComment', concertKey: KEY, text: 'What a night', show: { artist: 'Phish', venue: 'MSG' }, showId: 'a1' });
  assert.strictEqual(res.statusCode, 200, res.body);
  const [entry] = activityOf(ALICE.uid);
  assert.strictEqual(entry.action, 'commented');
  assert.strictEqual(entry.showId, 'a1');
  assert.strictEqual(entry.commentId, json(res).id);
  assert.strictEqual(entry.handle, 'alice');
  await callModerate('alice', { target: 'showComment', concertKey: KEY, text: 'Again', showId: 'b1' });
  assert.strictEqual(activityOf(ALICE.uid).find((e) => e.commentId !== entry.commentId).showId, null, 'Bob’s show isn’t Alice’s');
});

test('comments: a reply needs a top-level parent on the same concert', async () => {
  setup();
  db._put('showComments/top', { concertKey: KEY, parentId: null, authorUid: BOB.uid });
  db._put('showComments/reply', { concertKey: KEY, parentId: 'top', authorUid: BOB.uid });
  db._put('showComments/elsewhere', { concertKey: 'other|show|2020-01-01', parentId: null, authorUid: BOB.uid });
  const reply = (parentId) => callModerate('alice', { target: 'showComment', concertKey: KEY, parentId, text: 'Agreed' });
  assert.strictEqual((await reply('top')).statusCode, 200);
  for (const bad of ['reply', 'elsewhere', 'missing']) {
    const res = await reply(bad);
    assert.strictEqual(res.statusCode, 400, bad);
    assert.strictEqual(json(res).code, 'bad_parent');
  }
});

test('names: an author without a display name is never published as an email', async () => {
  setup();
  db._put('meetups/m1', { concertKey: KEY, createdBy: BOB.uid, attendeeUids: [BOB.uid] });
  const res = await callModerate('noname', { target: 'meetupComment', meetupId: 'm1', text: 'See you there', authorName: NONAME.email });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.strictEqual(db._get(`meetupComments/${json(res).id}`).authorName, 'Anonymous');
  assert.strictEqual((await callModerate('alice', { target: 'meetupComment', meetupId: 'gone', text: 'Hello' })).statusCode, 404);
});

test('uploads: path, size, type and URL come from Storage; the request’s are ignored', async () => {
  setup();
  const p = `showPhotos/${SEGMENT}/${ALICE.uid}/1700-photo.jpg`;
  objects.set(p, { size: 2 * MB, contentType: 'image/jpeg', token: 'tok123' });
  const res = await callModerate('alice', {
    target: 'showMedia', concertKey: KEY, category: 'photo', type: 'image', storagePath: p,
    url: 'https://tracker.example/pixel.gif', fileSize: 1, caption: 'Tweezer', show: { artist: 'Phish' }, showId: 'a1',
  });
  assert.strictEqual(res.statusCode, 200, res.body);
  const doc = db._get(`showPhotos/${json(res).id}`);
  assert.strictEqual(doc.url, `https://firebasestorage.googleapis.com/v0/b/test-bucket.firebasestorage.app/o/${encodeURIComponent(p)}?alt=media&token=tok123`);
  assert.strictEqual(doc.fileSize, 2 * MB);
  assert.strictEqual(doc.type, 'image');
  assert.strictEqual(doc.uploadedBy, ALICE.uid);
  assert.strictEqual(activityOf(ALICE.uid)[0].mediaCategory, 'photo');
  // The same file twice is one post.
  assert.strictEqual((await callModerate('alice', { target: 'showMedia', concertKey: KEY, storagePath: p })).statusCode, 409);
});

test('uploads: someone else’s path, another concert, no file, wrong type, too big and a full concert are refused', async () => {
  setup();
  const mine = (name) => `showPhotos/${SEGMENT}/${ALICE.uid}/${name}`;
  const send = (body) => callModerate('alice', { target: 'showMedia', concertKey: KEY, category: 'photo', ...body });
  objects.set(`showPhotos/${SEGMENT}/${BOB.uid}/b.jpg`, { size: MB, contentType: 'image/jpeg', token: 't' });
  assert.strictEqual(json(await send({ storagePath: `showPhotos/${SEGMENT}/${BOB.uid}/b.jpg` })).code, 'bad_path');
  assert.strictEqual(json(await send({ storagePath: `showPhotos/other-show/${ALICE.uid}/a.jpg` })).code, 'bad_path');
  assert.strictEqual(json(await send({ storagePath: mine('../x.jpg') })).code, 'bad_path');
  assert.strictEqual(json(await send({ storagePath: mine('never-uploaded.jpg') })).code, 'no_upload');
  objects.set(mine('a.heic'), { size: MB, contentType: 'image/heic', token: 't' });
  assert.strictEqual(json(await send({ storagePath: mine('a.heic') })).code, 'bad_type');
  objects.set(mine('v.mp4'), { size: MB, contentType: 'video/mp4', token: 't' });
  assert.strictEqual(json(await send({ storagePath: mine('v.mp4'), category: 'poster' })).code, 'bad_type', 'posters are images');
  objects.set(mine('big.jpg'), { size: 11 * MB, contentType: 'image/jpeg', token: 't' });
  assert.strictEqual(json(await send({ storagePath: mine('big.jpg') })).code, 'too_large');
  assert.ok(deleted.includes(mine('a.heic')) && deleted.includes(mine('big.jpg')), 'refused files are removed');
  for (let i = 0; i < 5; i++) db._put(`showPhotos/full${i}`, { concertKey: KEY, fileSize: 9.5 * MB });
  objects.set(mine('last.jpg'), { size: 3 * MB, contentType: 'image/jpeg', token: 't' });
  assert.strictEqual(json(await send({ storagePath: mine('last.jpg') })).code, 'concert_full');
  // A file uploaded without a download token gets one.
  db._store.clear();
  setup();
  objects.set(mine('notoken.png'), { size: MB, contentType: 'image/png' });
  const ok = json(await send({ storagePath: mine('notoken.png') }));
  assert.ok(objects.get(mine('notoken.png')).token, 'a token is set');
  assert.ok(ok.url.endsWith(`token=${objects.get(mine('notoken.png')).token}`));
});

test('uploads: a YouTube link is stored canonical; anything else isn’t a link', async () => {
  setup();
  const res = await callModerate('alice', { target: 'showMedia', concertKey: KEY, type: 'youtube', category: 'poster', url: 'https://youtu.be/dQw4w9WgXcQ?t=42' });
  const doc = db._get(`showPhotos/${json(res).id}`);
  assert.strictEqual(doc.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(doc.category, 'photo');
  assert.strictEqual(doc.storagePath, null);
  assert.strictEqual(json(await callModerate('alice', { target: 'showMedia', concertKey: KEY, type: 'youtube', url: 'https://evil.example/x' })).code, 'bad_link');
});

test('daily limits: comments stop at 200 a day', async () => {
  setup();
  for (let i = 0; i < 200; i++) {
    const r = await callModerate('alice', { target: 'showComment', concertKey: KEY, text: `Great show, take ${i}` });
    assert.strictEqual(r.statusCode, 200, r.body);
  }
  const over = await callModerate('alice', { target: 'showComment', concertKey: KEY, text: 'one more' });
  assert.strictEqual(over.statusCode, 429);
  assert.strictEqual(json(over).code, 'daily_limit');
});

// ── Reports and moderation (calls I and J) ───────────────────────────

test('reports: a meetup’s details can be reported, go to the queue, and “delete” clears only the details', async () => {
  setup();
  db._put('meetups/m1', { concertKey: KEY, createdBy: BOB.uid, attendeeUids: [BOB.uid, CAROL.uid], description: 'something awful' });
  for (const who of ['alice', 'carol', 'mallory']) {
    const r = await callReport(who, { contentType: 'meetup', contentId: 'm1', reason: 'harassment' });
    assert.strictEqual(r.statusCode, 200, r.body);
  }
  assert.ok(db._get('meetups/m1'), 'never auto-hidden');
  const report = db._get(`reports/m1_${ALICE.uid}`);
  assert.strictEqual(report.reportedUserId, BOB.uid);
  assert.strictEqual(report.contentPath, 'meetups/m1');
  const res = await callReportModeration('admin', { reportId: `m1_${ALICE.uid}`, action: 'delete' });
  assert.strictEqual(res.statusCode, 200, res.body);
  const after = db._get('meetups/m1');
  assert.strictEqual(after.description, '');
  assert.deepStrictEqual(after.attendeeUids, [BOB.uid, CAROL.uid]);
});

test('moderation: deleting a photo deletes its file too', async () => {
  setup();
  const p = `showPhotos/${SEGMENT}/${BOB.uid}/x.jpg`;
  objects.set(p, { size: MB, contentType: 'image/jpeg' });
  db._put('showPhotos/p9', { concertKey: KEY, uploadedBy: BOB.uid, storagePath: p, caption: 'bad' });
  db._put(`reports/p9_${ALICE.uid}`, { contentType: 'showMedia', contentId: 'p9', contentPath: 'showPhotos/p9', reportedUserId: BOB.uid, status: 'open' });
  const res = await callReportModeration('admin', { reportId: `p9_${ALICE.uid}`, action: 'delete' });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.strictEqual(json(res).fileDeleted, true);
  assert.strictEqual(db._get('showPhotos/p9'), undefined);
  assert.deepStrictEqual(deleted, [p]);
});

// ── The cleanup script ───────────────────────────────────────────────

test('cleanup-meetup-names: email-shaped names become the display name or Someone; others untouched', () => {
  const profiles = new Map([['u1', { displayName: 'Uma' }], ['u2', {}], ['u3', { displayName: 'Old@Name.com' }]]);
  const fixes = planMeetupFixes([
    { id: 'm1', data: { createdBy: 'u1', createdByName: 'uma@example.com', attendeeNames: { u1: 'uma@example.com', u4: 'Vic' } } },
    { id: 'm2', data: { createdBy: 'u4', createdByName: 'Vic', attendeeNames: { u4: 'Vic', u2: 'x@y.co' } } },
    { id: 'm3', data: { createdBy: 'u4', createdByName: 'Vic', attendeeNames: { u4: 'Vic' } } },
  ], profiles);
  assert.deepStrictEqual(fixes, [
    { id: 'm1', update: { createdByName: 'Uma', attendeeNames: { u1: 'Uma', u4: 'Vic' } }, names: 2 },
    { id: 'm2', update: { attendeeNames: { u4: 'Vic', u2: 'Someone' } }, names: 1 },
  ]);
  assert.deepStrictEqual(planCommentFixes([
    { id: 'c1', data: { authorUid: 'u3', authorName: 'old@name.com' } },
    { id: 'c2', data: { authorUid: 'u1', authorName: 'Uma' } },
  ], profiles), [{ id: 'c1', update: { authorName: 'Anonymous' } }]);
});

// ── No client writes ─────────────────────────────────────────────────

test('no client code writes a like, a meetup or an activity entry', () => {
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
    assert.ok(!/likedBy:\s*(alreadyLiked|liked)?\s*\??\s*array(Union|Remove)/.test(src) && !/likedBy: arrayUnion/.test(src), `${rel} writes a like`);
    assert.ok(!/(setDoc|updateDoc)\(\s*doc\(db, 'meetups'/.test(src), `${rel} writes a meetup`);
    if (rel === path.join('lib', 'meetups.js')) assert.ok(!/\b(setDoc|updateDoc)\b/.test(src), 'lib/meetups.js writes a meetup');
    assert.ok(!/collection\(db, 'userActivity'\)/.test(src), `${rel} touches userActivity`);
  }
});

run('Likes, meetups, activity and upload checks on the server (5.60.38)');
