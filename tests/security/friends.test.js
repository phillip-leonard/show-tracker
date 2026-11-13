/**
 * The 5.59.7 server-side moves, end to end against an in-memory Firestore:
 *   - friends.js: accept, claimInvites, referral (signed and bare uid),
 *     referralLink, lookupByEmail — who may make whom a friend (S-04),
 *     and lookup returning no address (S-01)
 *   - lib/referralToken.js: signing and verifying referral links
 *   - lib/accountEmails.js: addresses from Auth when profiles have none
 *   - send-email's invite and tag-by-email links are signed referrals
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

const ADMIN = { uid: 'adminUid000001', email: 'phillip.leonard@gmail.com' };
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

run('Friends function, referral tokens and account emails (5.59.7)');
