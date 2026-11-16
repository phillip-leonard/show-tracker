/**
 * The 5.59.7 server-side moves, end to end against an in-memory Firestore:
 *   - friends.js: accept, claimInvites, referral (signed and bare uid),
 *     referralLink, lookupByEmail — who may make whom a friend (S-04),
 *     and lookup returning no address (S-01)
 *   - lib/referralToken.js: signing and verifying referral links
 *   - lib/accountEmails.js: addresses from Auth when profiles have none
 *   - send-email's invite and tag-by-email links are signed referrals
 *   - 5.60.28 (Stage 3, 2a): request, decline, cancel, invite,
 *     resendInvite, cancelInvite and lookupByHandle, so no client writes a
 *     friend request or an invite
 *
 *   node tests/security/friends.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');

const friends = require('../../netlify/functions/friends');
const { signReferral, readReferral } = require('../../netlify/functions/lib/referralToken');
const { authorizeEmail } = require('../../netlify/functions/lib/emailAuthorization');
const { emailsForUids, withAccountEmails } = require('../../netlify/functions/lib/accountEmails');
const { __setTestTransport } = require('../../netlify/functions/lib/outgoingEmail');
const { utcDay } = require('../../netlify/functions/lib/rateLimit');

const ADMIN = { uid: 'adminUid000001', email: 'phillip.leonard@gmail.com', email_verified: true };
const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com', metadata: { creationTime: new Date().toUTCString() } };
const BOB = { uid: 'bobUid00000001', email: 'bob@example.com', metadata: { creationTime: new Date(Date.now() - 90 * 864e5).toUTCString() } };
const MALLORY = { uid: 'malloryUid0001', email: 'mallory@example.com', metadata: { creationTime: new Date().toUTCString() } };

function setup() {
  const db = createFakeDb();
  const auth = createFakeAuth({
    tokens: { 'admin-token': ADMIN, 'alice-token': ALICE, 'bob-token': BOB, 'mallory-token': MALLORY },
    users: [ADMIN, ALICE, BOB, MALLORY],
  });
  __setTestFirebase({ db, auth });
  db._put(`userProfiles/${ALICE.uid}`, { displayName: 'Alice' });
  db._put(`userProfiles/${BOB.uid}`, { displayName: 'Bob' });
  db._put(`userProfiles/${MALLORY.uid}`, { displayName: 'Mallory' });
  return { db, auth };
}

const call = (token, body, method = 'POST') => friends.handler({
  httpMethod: method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: body === undefined ? undefined : JSON.stringify(body),
});
const json = (res) => JSON.parse(res.body);
const areFriends = (db, a, b) => !!db._get(`users/${a}/friends/${b}`) && !!db._get(`users/${b}/friends/${a}`);

// ── referral tokens ──────────────────────────────────────────────────

test('referral token: signed tokens verify; tampered and foreign ones do not', () => {
  const t = signReferral(BOB.uid);
  assert.deepStrictEqual(readReferral(t), { uid: BOB.uid, signed: true });
  assert.deepStrictEqual(readReferral(BOB.uid), { uid: BOB.uid, signed: false });
  assert.strictEqual(readReferral(`${ALICE.uid}.${t.split('.')[1]}`), null, 'a signature is bound to its uid');
  assert.strictEqual(readReferral(`${BOB.uid}.AAAAAAAAAAAAAAAAAAAAAA`), null);
  assert.strictEqual(readReferral('../etc'), null);
  assert.strictEqual(readReferral(''), null);
});

// ── friends.js ───────────────────────────────────────────────────────

test('friends: 401 signed out, 400 for an unknown action', async () => {
  setup();
  assert.strictEqual((await call(null, { action: 'accept', requestId: 'r' })).statusCode, 401);
  assert.strictEqual((await call('alice-token', { action: 'makeFriends' })).statusCode, 400);
});

test('accept: only the recipient of a pending request; writes both sides', async () => {
  const { db } = setup();
  db._put('friendRequests/r1', { from: BOB.uid, to: ALICE.uid, status: 'pending' });
  assert.strictEqual((await call('mallory-token', { action: 'accept', requestId: 'r1' })).statusCode, 403);
  assert.strictEqual((await call('bob-token', { action: 'accept', requestId: 'r1' })).statusCode, 403, 'not the sender either');
  const res = await call('alice-token', { action: 'accept', requestId: 'r1' });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(areFriends(db, ALICE.uid, BOB.uid));
  assert.strictEqual(db._get('friendRequests/r1').status, 'accepted');
  assert.strictEqual(db._get(`users/${ALICE.uid}/friends/${BOB.uid}`).friendName, 'Bob');
  assert.strictEqual((await call('alice-token', { action: 'accept', requestId: 'r1' })).statusCode, 409, 'once');
});

test('accept: refused across a block', async () => {
  const { db } = setup();
  db._put('friendRequests/r2', { from: MALLORY.uid, to: ALICE.uid, status: 'pending' });
  db._put(`userBlocks/${ALICE.uid}`, { blockedUserIds: [MALLORY.uid] });
  assert.strictEqual((await call('alice-token', { action: 'accept', requestId: 'r2' })).statusCode, 403);
  assert.ok(!db._get(`users/${MALLORY.uid}/friends/${ALICE.uid}`));
});

test('referral: a signed link makes friends and records the inviter on a new account', async () => {
  const { db } = setup();
  const res = json(await call('alice-token', { action: 'referral', ref: signReferral(BOB.uid) }));
  assert.strictEqual(res.result, 'friends');
  assert.ok(areFriends(db, ALICE.uid, BOB.uid));
  assert.strictEqual(db._get(`userProfiles/${ALICE.uid}`).invitedByUid, BOB.uid);
  assert.strictEqual(db._get(`userProfiles/${ALICE.uid}`).invitedByEmail, undefined, 'no address on the profile');
});

test('referral: an old bare-uid link only sends the referrer a request (S-04)', async () => {
  const { db } = setup();
  const res = json(await call('mallory-token', { action: 'referral', ref: ALICE.uid }));
  assert.strictEqual(res.result, 'requested');
  assert.ok(!areFriends(db, MALLORY.uid, ALICE.uid));
  const reqs = db._list('friendRequests');
  assert.strictEqual(reqs.length, 1);
  assert.deepStrictEqual([reqs[0].from, reqs[0].to, reqs[0].status], [MALLORY.uid, ALICE.uid, 'pending']);
  assert.strictEqual(reqs[0].fromEmail, undefined);
  assert.strictEqual(json(await call('mallory-token', { action: 'referral', ref: ALICE.uid })).result, 'already-requested');
});

test('referral: a forged signature or your own link does nothing', async () => {
  const { db } = setup();
  const forged = `${ALICE.uid}.${signReferral(MALLORY.uid).split('.')[1]}`;
  assert.strictEqual(json(await call('mallory-token', { action: 'referral', ref: forged })).result, 'ignored');
  assert.strictEqual(json(await call('alice-token', { action: 'referral', ref: signReferral(ALICE.uid) })).result, 'ignored');
  assert.strictEqual(db._list('friendRequests').length, 0);
  assert.ok(!db._get(`users/${MALLORY.uid}/friends/${ALICE.uid}`));
});

test('referral: an existing account befriends but is not marked invited', async () => {
  const { db } = setup();
  await call('bob-token', { action: 'referral', ref: signReferral(ALICE.uid) });
  assert.ok(areFriends(db, ALICE.uid, BOB.uid));
  assert.strictEqual(db._get(`userProfiles/${BOB.uid}`).invitedByUid, undefined);
});

test('referralLink: the caller’s own signed link', async () => {
  setup();
  const { url } = json(await call('bob-token', { action: 'referralLink' }));
  const ref = decodeURIComponent(url.split('?ref=')[1]);
  assert.deepStrictEqual(readReferral(ref), { uid: BOB.uid, signed: true });
});

test('claimInvites: an invite to the caller’s own address befriends the inviter', async () => {
  const { db } = setup();
  db._put('invites/i1', { inviterUid: BOB.uid, inviteeEmail: ALICE.email, status: 'pending', createdAt: new Date() });
  db._put('invites/i2', { inviterUid: MALLORY.uid, inviteeEmail: 'someone@else.com', status: 'pending' });
  const res = json(await call('alice-token', { action: 'claimInvites' }));
  assert.deepStrictEqual([res.claimed, res.newFriend, res.inviterUid, res.inviterName], [true, true, BOB.uid, 'Bob']);
  assert.ok(areFriends(db, ALICE.uid, BOB.uid));
  assert.strictEqual(db._get('invites/i1').status, 'accepted');
  assert.strictEqual(db._get('invites/i2').status, 'pending', 'someone else’s invite untouched');
  assert.ok(!db._get(`users/${ALICE.uid}/friends/${MALLORY.uid}`));
  // What send-email's friend_joined reads to find the inviter.
  assert.strictEqual(db._get(`userProfiles/${ALICE.uid}`).invitedByUid, BOB.uid);
});

test('claimInvites: nothing to claim is a quiet no', async () => {
  setup();
  assert.strictEqual(json(await call('mallory-token', { action: 'claimInvites' })).claimed, false);
});

test('lookupByEmail: uid and name, never an address; limited per day', async () => {
  setup();
  const hit = json(await call('alice-token', { action: 'lookupByEmail', email: ' Bob@Example.com ' }));
  assert.deepStrictEqual(hit, { success: true, found: true, uid: BOB.uid, displayName: 'Bob' });
  assert.strictEqual(json(await call('alice-token', { action: 'lookupByEmail', email: 'nobody@example.com' })).found, false);
  assert.strictEqual(json(await call('alice-token', { action: 'lookupByEmail', email: ALICE.email })).self, true);
  assert.strictEqual((await call('alice-token', { action: 'lookupByEmail', email: 'nope' })).statusCode, 400);
  let last;
  for (let i = 0; i < friends.LOOKUPS_PER_DAY; i++) last = await call('mallory-token', { action: 'lookupByEmail', email: `x${i}@example.com` });
  assert.strictEqual(last.statusCode, 200);
  assert.strictEqual((await call('mallory-token', { action: 'lookupByEmail', email: 'y@example.com' })).statusCode, 429);
});

// ── send-email's referral links ──────────────────────────────────────

test('send-email: invite and tag-by-email links are signed referrals', async () => {
  const { db, auth } = setup();
  db._put('invites/i9', { inviterUid: BOB.uid, inviteeEmail: 'new@example.com', status: 'pending' });
  db._put('pendingEmailTags/p9', { fromUid: BOB.uid, toEmail: 'new@example.com', status: 'pending', showData: { artist: 'Goose' }, createdAt: new Date() });
  const caller = { uid: BOB.uid, email: BOB.email, isAdmin: false };
  const ctx = { db, auth, now: Date.now() };
  for (const body of [{ type: 'invite', inviteId: 'i9' }, { type: 'tag_email', pendingTagId: 'p9' }]) {
    const r = await authorizeEmail(ctx, caller, body);
    assert.ok(r.ok, `${body.type} authorized`);
    const ref = decodeURIComponent(r.email.html.match(/\?ref=([^"&]+)/)[1]);
    assert.deepStrictEqual(readReferral(ref), { uid: BOB.uid, signed: true }, body.type);
  }
});

// ── accountEmails ────────────────────────────────────────────────────

test('accountEmails: Auth fills addresses profiles no longer carry', async () => {
  const { auth } = setup();
  const m = await emailsForUids(auth, [ALICE.uid, BOB.uid, 'gone']);
  assert.deepStrictEqual([...m.entries()], [[ALICE.uid, ALICE.email], [BOB.uid, BOB.email]]);
  const rows = await withAccountEmails(auth, [{ uid: ALICE.uid }, { uid: BOB.uid, email: 'legacy@example.com' }, { uid: 'gone' }]);
  assert.deepStrictEqual(rows.map((r) => r.email), [ALICE.email, 'legacy@example.com', '']);
});

// ── blocking on the server (5.60.27, Stage 2 C-7) ─────────────────────

const blockList = (db, uid) => (db._get(`userBlocks/${uid}`) || {}).blockedUserIds || [];

function seedBetween(db) {
  db._put(`users/${ALICE.uid}/friends/${BOB.uid}`, { friendUid: BOB.uid });
  db._put(`users/${BOB.uid}/friends/${ALICE.uid}`, { friendUid: ALICE.uid });
  db._put(`users/${ALICE.uid}/friends/${MALLORY.uid}`, { friendUid: MALLORY.uid });
  db._put(`users/${MALLORY.uid}/friends/${ALICE.uid}`, { friendUid: ALICE.uid });
  db._put('friendRequests/r1', { from: BOB.uid, to: ALICE.uid, status: 'pending' });
  db._put('friendRequests/r2', { from: ALICE.uid, to: BOB.uid, status: 'declined' });
  db._put('friendRequests/r3', { from: MALLORY.uid, to: ALICE.uid, status: 'pending' });
  db._put('showTags/t1', { fromUid: BOB.uid, toUid: ALICE.uid, status: 'pending' });
  db._put('showTags/t2', { fromUid: ALICE.uid, toUid: BOB.uid, status: 'accepted' });
  db._put('showTags/t3', { fromUid: MALLORY.uid, toUid: ALICE.uid, status: 'pending' });
  db._put(`users/${ALICE.uid}/upcomingShows/u1`, { artist: 'Goose', taggedFriendUids: [BOB.uid, MALLORY.uid] });
  db._put(`users/${ALICE.uid}/upcomingShows/u2`, { artist: 'Phish', taggedFriendUids: [MALLORY.uid] });
}

test('block: the list, both sides of the friendship, requests and tags either way; nobody else', async () => {
  const { db } = setup();
  seedBetween(db);
  const res = await call('alice-token', { action: 'block', targetUid: BOB.uid });
  assert.strictEqual(res.statusCode, 200, res.body);
  const body = json(res);
  assert.deepStrictEqual(body.removed, { friendship: true, friendRequests: 2, showTags: 2, upcomingShows: 1 });
  assert.deepStrictEqual(db._get(`users/${ALICE.uid}/upcomingShows/u1`).taggedFriendUids, [MALLORY.uid], "off Alice's who's-going list");
  assert.deepStrictEqual(db._get(`users/${ALICE.uid}/upcomingShows/u2`).taggedFriendUids, [MALLORY.uid]);
  assert.deepStrictEqual(blockList(db, ALICE.uid), [BOB.uid]);
  assert.strictEqual(db._get(`userBlocks/${ALICE.uid}`).userId, ALICE.uid);
  assert.ok(!db._get(`users/${ALICE.uid}/friends/${BOB.uid}`) && !db._get(`users/${BOB.uid}/friends/${ALICE.uid}`), 'both sides gone');
  assert.ok(!db._get('friendRequests/r1') && !db._get('friendRequests/r2') && !db._get('showTags/t1') && !db._get('showTags/t2'));
  assert.ok(areFriends(db, ALICE.uid, MALLORY.uid), "Alice's other friendships stay");
  assert.ok(db._get('friendRequests/r3') && db._get('showTags/t3'), "other people's requests and tags stay");
  assert.deepStrictEqual(blockList(db, BOB.uid), [], 'the blocked user gets no block list and is told nothing');
});

test('block: recorded once for the moderation queue; a repeat block keeps one entry and one report', async () => {
  const { db } = setup();
  const first = json(await call('alice-token', { action: 'block', targetUid: BOB.uid }));
  assert.strictEqual(first.notified, true);
  const report = db._get(`reports/block_${ALICE.uid}_${BOB.uid}`);
  assert.strictEqual(report.reason, 'blocked');
  assert.strictEqual(report.reportedUserId, BOB.uid);
  assert.strictEqual(report.contentPath, null);
  const again = json(await call('alice-token', { action: 'block', targetUid: BOB.uid }));
  assert.strictEqual(again.notified, false, 'no second email for the same pair');
  assert.deepStrictEqual(blockList(db, ALICE.uid), [BOB.uid]);
});

test('block: a friend request sent after a block is refused; accepting an old one is refused', async () => {
  const { db } = setup();
  db._put('friendRequests/old', { from: BOB.uid, to: ALICE.uid, status: 'pending' });
  await call('alice-token', { action: 'block', targetUid: BOB.uid });
  db._put('friendRequests/late', { from: BOB.uid, to: ALICE.uid, status: 'pending' });
  const res = await call('alice-token', { action: 'accept', requestId: 'late' });
  assert.strictEqual(res.statusCode, 403);
  assert.ok(!areFriends(db, ALICE.uid, BOB.uid));
});

test('unblock: off the list; the friendship is not restored', async () => {
  const { db } = setup();
  seedBetween(db);
  await call('alice-token', { action: 'block', targetUid: BOB.uid });
  await call('alice-token', { action: 'block', targetUid: MALLORY.uid });
  const res = await call('alice-token', { action: 'unblock', targetUid: BOB.uid });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.deepStrictEqual(blockList(db, ALICE.uid), [MALLORY.uid]);
  assert.ok(!areFriends(db, ALICE.uid, BOB.uid));
  assert.strictEqual(json(await call('alice-token', { action: 'unblock', targetUid: BOB.uid })).blocked, false, 'unblocking twice is fine');
});

test('block and unblock: a uid other than your own, signed in', async () => {
  setup();
  for (const targetUid of [ALICE.uid, '', 'a/b', undefined]) {
    assert.strictEqual((await call('alice-token', { action: 'block', targetUid })).statusCode, 400, String(targetUid));
    assert.strictEqual((await call('alice-token', { action: 'unblock', targetUid })).statusCode, 400, String(targetUid));
  }
  assert.strictEqual((await call(null, { action: 'block', targetUid: BOB.uid })).statusCode, 401);
});

test('the web blocks through the server: lib/moderation.js writes no friends, requests or tags itself', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../lib/moderation.js'), 'utf8');
  assert.ok(src.includes("callFriends('block'") && src.includes("callFriends('unblock'"), 'calls friends block and unblock');
  for (const banned of ["'friends'", "'friendRequests'", "'showTags'", 'notify-block', 'deleteDoc(']) {
    assert.ok(!src.includes(banned), `lib/moderation.js still uses ${banned}`);
  }
});

// ── Requests (5.60.28) ───────────────────────────────────────────────

const GUEST = { uid: 'guestUid000001', providerData: [] };
const quiet = async (fn) => { const l = console.log; const e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };

function setupWithEmail() {
  const ctx = setup();
  const sent = [];
  __setTestTransport((path, payload) => { sent.push(payload); return { status: 200, body: '{"id":"x"}' }; });
  return { ...ctx, sent };
}

test('request: writes a pending request with both names, once', async () => {
  const { db } = setup();
  const res = json(await call('alice-token', { action: 'request', toUid: BOB.uid }));
  assert.strictEqual(res.result, 'requested');
  const reqs = db._list('friendRequests');
  assert.strictEqual(reqs.length, 1);
  assert.deepStrictEqual([reqs[0].from, reqs[0].to, reqs[0].status, reqs[0].fromName, reqs[0].toName], [ALICE.uid, BOB.uid, 'pending', 'Alice', 'Bob']);
  assert.strictEqual(json(await call('alice-token', { action: 'request', toUid: BOB.uid })).result, 'already-requested');
  assert.strictEqual(db._list('friendRequests').length, 1);
});

test('request: if they already asked, theirs is accepted instead', async () => {
  const { db } = setup();
  db._put('friendRequests/theirs', { from: BOB.uid, to: ALICE.uid, status: 'pending' });
  const res = json(await call('alice-token', { action: 'request', toUid: BOB.uid }));
  assert.strictEqual(res.result, 'friends');
  assert.ok(areFriends(db, ALICE.uid, BOB.uid));
  assert.strictEqual(db._get('friendRequests/theirs').status, 'accepted');
  assert.strictEqual(db._list('friendRequests').length, 1, 'no second request');
  assert.strictEqual(json(await call('alice-token', { action: 'request', toUid: BOB.uid })).result, 'already-friends');
});

test('request: across a block it looks sent but writes nothing, either direction', async () => {
  const { db } = setup();
  db._put(`userBlocks/${ALICE.uid}`, { blockedUserIds: [MALLORY.uid] });
  assert.strictEqual(json(await call('mallory-token', { action: 'request', toUid: ALICE.uid })).result, 'requested', 'the blocked person can’t tell');
  assert.strictEqual(json(await call('alice-token', { action: 'request', toUid: MALLORY.uid })).result, 'requested');
  assert.strictEqual(db._list('friendRequests').length, 0);
});

test('request: not to yourself, a guest, a missing account or a bad id', async () => {
  const { db } = setup();
  // A guest (anonymous auth: no provider linked) can't have friends.
  const auth = createFakeAuth({ tokens: { 'alice-token': ALICE }, users: [ALICE, BOB, GUEST] });
  __setTestFirebase({ db, auth });
  assert.strictEqual((await call('alice-token', { action: 'request', toUid: GUEST.uid })).statusCode, 404, 'a guest');
  assert.strictEqual((await call('alice-token', { action: 'request', toUid: ALICE.uid })).statusCode, 400, 'yourself');
  assert.strictEqual((await call('alice-token', { action: 'request', toUid: 'nobodyUid00001' })).statusCode, 404, 'no account');
  for (const toUid of ['', 'a/b', undefined]) {
    assert.strictEqual((await call('alice-token', { action: 'request', toUid })).statusCode, 400, String(toUid));
  }
  assert.strictEqual(db._list('friendRequests').length, 0);
});

test('request: a daily limit per sender', async () => {
  const { db } = setup();
  const limit = friends.REQUESTS_PER_DAY;
  db._put(`rateLimits/friend_request_${ALICE.uid}_${utcDay()}`, { count: limit, uid: ALICE.uid });
  const res = await call('alice-token', { action: 'request', toUid: BOB.uid });
  assert.strictEqual(res.statusCode, 429, res.body);
  assert.strictEqual(db._list('friendRequests').length, 0);
  assert.strictEqual(json(await call('bob-token', { action: 'request', toUid: ALICE.uid })).result, 'requested', 'per sender');
});

test('decline: only the recipient, only while pending', async () => {
  const { db } = setup();
  db._put('friendRequests/d1', { from: BOB.uid, to: ALICE.uid, status: 'pending' });
  assert.strictEqual((await call('bob-token', { action: 'decline', requestId: 'd1' })).statusCode, 403, 'not the sender');
  assert.strictEqual((await call('mallory-token', { action: 'decline', requestId: 'd1' })).statusCode, 403);
  assert.strictEqual((await call('alice-token', { action: 'decline', requestId: 'd1' })).statusCode, 200);
  assert.strictEqual(db._get('friendRequests/d1').status, 'declined');
  assert.strictEqual((await call('alice-token', { action: 'decline', requestId: 'd1' })).statusCode, 409);
  assert.strictEqual((await call('alice-token', { action: 'decline', requestId: 'missing' })).statusCode, 404);
  assert.ok(!areFriends(db, ALICE.uid, BOB.uid));
});

test('cancel: only the sender; a request already gone is fine', async () => {
  const { db } = setup();
  db._put('friendRequests/c1', { from: ALICE.uid, to: BOB.uid, status: 'pending' });
  assert.strictEqual((await call('bob-token', { action: 'cancel', requestId: 'c1' })).statusCode, 403, 'not the recipient');
  assert.strictEqual((await call('alice-token', { action: 'cancel', requestId: 'c1' })).statusCode, 200);
  assert.strictEqual(db._get('friendRequests/c1'), undefined);
  assert.strictEqual(json(await call('alice-token', { action: 'cancel', requestId: 'c1' })).cancelled, true);
});

// ── Invites (5.60.28) ────────────────────────────────────────────────

test('invite: writes the invite and emails a signed referral, as send-email would', async () => {
  const { db, sent } = setupWithEmail();
  const res = json(await quiet(() => call('alice-token', { action: 'invite', email: ' New.Person@Example.com ' })));
  assert.strictEqual(res.emailed, 'sent');
  const invite = db._get(`invites/${res.inviteId}`);
  assert.deepStrictEqual([invite.inviterUid, invite.inviteeEmail, invite.status, invite.inviterName], [ALICE.uid, 'new.person@example.com', 'pending', 'Alice']);
  assert.ok(invite.lastSentAt, 'stamped when sent');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, 'new.person@example.com');
  const refs = [...sent[0].html.matchAll(/\?ref=([^"&<\s]+)/g)].map((m) => decodeURIComponent(m[1]));
  assert.ok(refs.length && refs.every((r) => readReferral(r)?.signed && readReferral(r).uid === ALICE.uid), 'signed referral link');
});

test('invite: one pending invite per address; not yourself; a valid address', async () => {
  const { sent } = setupWithEmail();
  await quiet(() => call('alice-token', { action: 'invite', email: 'friend@example.com' }));
  assert.strictEqual((await quiet(() => call('alice-token', { action: 'invite', email: 'FRIEND@example.com' }))).statusCode, 409);
  assert.strictEqual((await call('alice-token', { action: 'invite', email: ALICE.email })).statusCode, 400);
  assert.strictEqual((await call('alice-token', { action: 'invite', email: 'not-an-address' })).statusCode, 400);
  assert.strictEqual(sent.length, 1);
});

test('resendInvite: the fix for the refused update; once a day per address; only your own', async () => {
  const { db, sent } = setupWithEmail();
  db._put('invites/i1', { inviterUid: ALICE.uid, inviterName: 'Alice', inviteeEmail: 'friend@example.com', status: 'pending', createdAt: new Date(Date.now() - 3 * 864e5) });
  assert.strictEqual((await call('mallory-token', { action: 'resendInvite', inviteId: 'i1' })).statusCode, 403);
  const first = json(await quiet(() => call('alice-token', { action: 'resendInvite', inviteId: 'i1' })));
  assert.strictEqual(first.resent, true);
  assert.ok(db._get('invites/i1').lastSentAt, 'lastSentAt written by the server');
  assert.strictEqual(sent.length, 1);
  const again = json(await quiet(() => call('alice-token', { action: 'resendInvite', inviteId: 'i1' })));
  assert.deepStrictEqual([again.resent, again.reason], [false, 'already sent']);
  assert.strictEqual(sent.length, 1, 'not twice in a day');
  db._put('invites/i2', { inviterUid: ALICE.uid, inviteeEmail: 'x@example.com', status: 'accepted' });
  assert.strictEqual((await call('alice-token', { action: 'resendInvite', inviteId: 'i2' })).statusCode, 409);
});

test('cancelInvite: only your own', async () => {
  const { db } = setup();
  db._put('invites/i3', { inviterUid: ALICE.uid, inviteeEmail: 'friend@example.com', status: 'pending' });
  assert.strictEqual((await call('mallory-token', { action: 'cancelInvite', inviteId: 'i3' })).statusCode, 403);
  assert.ok(db._get('invites/i3'));
  assert.strictEqual((await call('alice-token', { action: 'cancelInvite', inviteId: 'i3' })).statusCode, 200);
  assert.strictEqual(db._get('invites/i3'), undefined);
});

// ── lookupByHandle (5.60.28, C-6) ────────────────────────────────────

test('lookupByHandle: an exact claimed handle, any case, with or without @', async () => {
  const { db } = setup();
  db._put('handles/bob_rocks', { uid: BOB.uid });
  db._put(`userProfiles/${BOB.uid}`, { displayName: 'Bob', handle: 'Bob_Rocks', handleLower: 'bob_rocks' });
  for (const handle of ['bob_rocks', '@Bob_Rocks', ' BOB_ROCKS ']) {
    const res = json(await call('alice-token', { action: 'lookupByHandle', handle }));
    assert.deepStrictEqual([res.found, res.uid, res.displayName, res.handle], [true, BOB.uid, 'Bob', 'Bob_Rocks'], handle);
    assert.strictEqual(res.email, undefined, 'no address');
  }
  assert.strictEqual(json(await call('alice-token', { action: 'lookupByHandle', handle: 'bob_rock' })).found, false, 'exact only');
  assert.strictEqual(json(await call('alice-token', { action: 'lookupByHandle', handle: 'bob' })).found, false);
});

test('lookupByHandle: not a half-claimed handle, yourself, or across a block; a valid handle only', async () => {
  const { db } = setup();
  db._put('handles/ghost_claim', { uid: MALLORY.uid }); // no handle on the profile
  assert.strictEqual(json(await call('alice-token', { action: 'lookupByHandle', handle: 'ghost_claim' })).found, false);
  db._put('handles/alice_a', { uid: ALICE.uid });
  db._put(`userProfiles/${ALICE.uid}`, { displayName: 'Alice', handle: 'alice_a', handleLower: 'alice_a' });
  assert.strictEqual(json(await call('alice-token', { action: 'lookupByHandle', handle: 'alice_a' })).self, true);
  db._put('handles/mal_m', { uid: MALLORY.uid });
  db._put(`userProfiles/${MALLORY.uid}`, { displayName: 'Mallory', handle: 'mal_m', handleLower: 'mal_m' });
  db._put(`userBlocks/${MALLORY.uid}`, { blockedUserIds: [ALICE.uid] });
  assert.strictEqual(json(await call('alice-token', { action: 'lookupByHandle', handle: 'mal_m' })).found, false);
  for (const handle of ['', 'ab', 'has space', 'x'.repeat(21), 'a.b']) {
    assert.strictEqual((await call('alice-token', { action: 'lookupByHandle', handle })).statusCode, 400, handle);
  }
});

// ── The web makes none of these writes itself ────────────────────────

test('the web sends requests and invites through the server (5.60.28)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../context/AppContext.jsx'), 'utf8');
  for (const action of ['request', 'decline', 'invite', 'resendInvite', 'cancelInvite']) {
    assert.ok(src.includes(`callFriends('${action}'`), `AppContext calls ${action}`);
  }
  assert.ok(!/addDoc\(collection\(db, 'friendRequests'\)/.test(src), 'no client friend request create');
  assert.ok(!/doc\(db, 'friendRequests', [^)]*\)/.test(src), 'no client friend request update or delete');
  assert.ok(!/addDoc\(collection\(db, 'invites'\)/.test(src), 'no client invite create');
  assert.ok(!/doc\(db, 'invites', [^)]*\)/.test(src), 'no client invite update or delete');
});

run('Friends function, referral tokens and account emails (5.59.7)');
