/**
 * Friend features on the server (5.60.11, pre-native server moves Part 6):
 * friends.js remove, showsTogether, showsTogetherCounts and suggestionScan,
 * against the in-memory Firestore, and the check that the app no longer
 * reads a friend's shows or writes into another user's friends list.
 *
 * The rules still allow those direct reads and deletes, because iOS 3.13.26
 * and earlier do them; tightening them is gated on minSupportedIosVersion
 * (docs/ios-native/GATED-CLEANUPS.md).
 *
 *   node tests/security/friendReads.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const friends = require('../../netlify/functions/friends');
const { planBackfill, versionAtLeast } = require('../../scripts/backfill-show-suggestions');
const { suggestionDocId } = require('../../netlify/functions/lib/showSuggestions');

const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com' };
const BOB = { uid: 'bobUid00000001', email: 'bob@example.com' };
const CAROL = { uid: 'carolUid000001', email: 'carol@example.com' };

let db;
function setup() {
  db = createFakeDb();
  __setTestFirebase({ db, auth: createFakeAuth({ tokens: { 'alice-token': ALICE, 'bob-token': BOB, 'carol-token': CAROL }, users: [ALICE, BOB, CAROL] }) });
  db._put(`userProfiles/${ALICE.uid}`, { displayName: 'Alice' });
  db._put(`userProfiles/${BOB.uid}`, { displayName: 'Bob' });
  db._put(`userProfiles/${CAROL.uid}`, { displayName: 'Carol' });
  const friendOf = (a, b, name) => db._put(`users/${a}/friends/${b}`, { friendUid: b, friendName: name });
  friendOf(ALICE.uid, BOB.uid, 'Bob');
  friendOf(BOB.uid, ALICE.uid, 'Alice');
  friendOf(ALICE.uid, CAROL.uid, 'Carol'); // one-sided: Carol never listed Alice
  const show = (uid, id, data) => db._put(`users/${uid}/shows/${id}`, data);
  show(ALICE.uid, 'a1', { artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlistfmId: 'nye', rating: 9, setlist: [] });
  show(ALICE.uid, 'a2', { artist: 'Goose', venue: 'Red Rocks', date: '2024-06-21', setlist: [] });
  show(ALICE.uid, 'a3', { artist: 'Billy Strings', venue: 'Ryman', date: '2025-05-28', setlist: [] });
  show(BOB.uid, 'b1', {
    artist: 'Phish', venue: 'Madison Square Garden', date: '31-12-2024', setlistfmId: 'nye', rating: 10,
    comment: 'Bob’s private-ish note', taggedFriendUids: ['x'], archivalAudioPick: 'r1',
    setlist: [{ id: 's1', name: 'Tweezer', set: 'Set I', rating: 10, comment: 'peak' }],
  });
  show(BOB.uid, 'b2', { artist: 'goose', venue: 'red rocks', date: '21-06-2024', setlist: [] });
  show(BOB.uid, 'b3', { artist: 'Eggy', venue: 'Somewhere', date: '2023-01-01', setlist: [] });
  show(CAROL.uid, 'c1', { artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlistfmId: 'nye', setlist: [] });
}

const call = (token, body) => friends.handler({
  httpMethod: 'POST',
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: 'https://mysetlists.net' },
  body: JSON.stringify(body),
});
const json = (res) => JSON.parse(res.body);

// ── remove ────────────────────────────────────────────────────────────

test('remove: both sides of the friendship, on the server', async () => {
  setup();
  assert.strictEqual((await call(null, { action: 'remove', friendUid: BOB.uid })).statusCode, 401);
  assert.strictEqual((await call('alice-token', { action: 'remove', friendUid: '' })).statusCode, 400);
  assert.strictEqual((await call('alice-token', { action: 'remove', friendUid: ALICE.uid })).statusCode, 400);
  const res = await call('alice-token', { action: 'remove', friendUid: BOB.uid });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.strictEqual(db._get(`users/${ALICE.uid}/friends/${BOB.uid}`), undefined);
  assert.strictEqual(db._get(`users/${BOB.uid}/friends/${ALICE.uid}`), undefined);
});

// ── Shows Together ────────────────────────────────────────────────────

test('showsTogether: only the shared nights, by setlist.fm id or artist + venue + day', async () => {
  setup();
  const res = json(await call('alice-token', { action: 'showsTogether', friendUid: BOB.uid }));
  assert.deepStrictEqual(res.shows.map((s) => [s.id, s.friendShow.id]).sort(), [['a1', 'b1'], ['a2', 'b2']]);
});

test('showsTogether: the friend’s show carries the event, the rating and the songs, nothing else', async () => {
  setup();
  const { shows } = json(await call('alice-token', { action: 'showsTogether', friendUid: BOB.uid }));
  const nye = shows.find((s) => s.id === 'a1').friendShow;
  assert.deepStrictEqual(Object.keys(nye).sort(), ['artist', 'city', 'date', 'id', 'rating', 'setlist', 'setlistfmId', 'venue']);
  assert.strictEqual(nye.rating, 10);
  assert.deepStrictEqual(nye.setlist, [{ id: 's1', name: 'Tweezer', set: 'Set I', rating: 10, comment: 'peak' }]);
});

test('showsTogether: only between mutual friends, and never across a block', async () => {
  setup();
  assert.strictEqual((await call('alice-token', { action: 'showsTogether', friendUid: CAROL.uid })).statusCode, 403, 'Carol never listed Alice');
  assert.strictEqual((await call('carol-token', { action: 'showsTogether', friendUid: ALICE.uid })).statusCode, 403);
  db._put(`userBlocks/${BOB.uid}`, { blockedUserIds: [ALICE.uid] });
  assert.strictEqual((await call('alice-token', { action: 'showsTogether', friendUid: BOB.uid })).statusCode, 403);
});

test('showsTogetherCounts: one request, a count per mutual friend, the length of the Shows Together list', async () => {
  setup();
  // Two of Alice's shows on one night count twice, as in the list.
  db._put(`users/${ALICE.uid}/shows/a4`, { artist: 'Goose', venue: 'Red Rocks', date: '2024-06-21', setlist: [] });
  const list = json(await call('alice-token', { action: 'showsTogether', friendUid: BOB.uid })).shows;
  const res = json(await call('alice-token', { action: 'showsTogetherCounts', friendUids: [BOB.uid, CAROL.uid, 'nobody'] }));
  assert.deepStrictEqual(res.counts, { [BOB.uid]: 3 });
  assert.strictEqual(list.length, 3);
});

// ── Suggestions ───────────────────────────────────────────────────────

test('suggestionScan for one show: a suggestion with each mutual friend who has the night, once', async () => {
  setup();
  const res = json(await call('alice-token', { action: 'suggestionScan', showId: 'a1' }));
  assert.strictEqual(res.created, 1, 'Bob, not Carol (not mutual)');
  const id = suggestionDocId(ALICE.uid, BOB.uid, 'nye');
  const doc = db._get(`showSuggestions/${id}`);
  assert.deepStrictEqual(doc.participants, [ALICE.uid, BOB.uid].sort());
  assert.deepStrictEqual(doc.names, { [ALICE.uid]: 'Alice', [BOB.uid]: 'Bob' });
  assert.deepStrictEqual(doc.responses, { [ALICE.uid]: 'pending', [BOB.uid]: 'pending' });
  assert.deepStrictEqual([doc.showKey, doc.overallStatus, doc.showData.artist], ['nye', 'pending', 'Phish']);
  assert.strictEqual(json(await call('alice-token', { action: 'suggestionScan', showId: 'a1' })).created, 0, 'idempotent');
});

test('suggestionScan for all shows (the retroactive scan): every shared night', async () => {
  setup();
  const res = json(await call('alice-token', { action: 'suggestionScan' }));
  assert.strictEqual(res.created, 2);
  assert.strictEqual(db._list('showSuggestions').length, 2);
});

test('the same suggestion id the app always used, so existing suggestions are found', async () => {
  setup();
  const id = suggestionDocId(BOB.uid, ALICE.uid, 'nye');
  db._put(`showSuggestions/${id}`, { participants: [ALICE.uid, BOB.uid].sort(), overallStatus: 'confirmed' });
  assert.strictEqual(json(await call('alice-token', { action: 'suggestionScan', showId: 'a1' })).created, 0);
  assert.strictEqual(db._get(`showSuggestions/${id}`).overallStatus, 'confirmed', 'not overwritten');
});

// ── The app ───────────────────────────────────────────────────────────

test('the app no longer reads a friend’s shows or writes into another user’s friends list', () => {
  const ctx = fs.readFileSync(path.join(__dirname, '..', '..', 'context', 'AppContext.jsx'), 'utf8');
  assert.ok(!/collection\(db, 'users', (friendUid|friend\.friendUid), 'shows'\)/.test(ctx), 'no read of a friend’s shows');
  assert.ok(!/doc\(db, 'users', friendUid, 'friends', user\.uid\)/.test(ctx), 'no delete from the friend’s list');
  assert.ok(!/collection\(db, 'showSuggestions'\)[\s\S]{0,40}setDoc|doc\(db, 'showSuggestions', docId\)/.test(ctx), 'suggestions are created on the server');
  for (const action of ['remove', 'showsTogether', 'showsTogetherCounts', 'suggestionScan']) {
    assert.ok(ctx.includes(`callFriends('${action}'`), `${action} goes through friends.js`);
  }
  const rules = fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8');
  assert.ok(/exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(userId\)\/friends\/\$\(request\.auth\.uid\)\)/.test(rules),
    'the friends read rule stays until minSupportedIosVersion passes 3.13.26 (GATED-CLEANUPS.md)');
});

test('suggestionScan skips a night the two are already tagged together on', async () => {
  setup();
  db._put(`users/${ALICE.uid}/shows/a1`, { ...db._get(`users/${ALICE.uid}/shows/a1`), taggedFriendUids: [BOB.uid] });
  db._put(`users/${BOB.uid}/shows/b2`, { ...db._get(`users/${BOB.uid}/shows/b2`), taggedByUid: ALICE.uid });
  assert.strictEqual(json(await call('alice-token', { action: 'suggestionScan' })).created, 0);
});

// ── The one-off backfill (scripts/backfill-show-suggestions.js) ───────

test('backfill plan: mutual, unblocked, not App Review, not tagged together; once per pair and night; per-user counts', () => {
  const shows = new Map([
    ['a', [{ id: 'a1', artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlistfmId: 'nye' }, { id: 'a2', artist: 'Goose', venue: 'Red Rocks', date: '2024-06-21', taggedFriendUids: ['b'] }, { id: 'a3', artist: 'Phish', venue: 'MSG', date: '31-12-2024', setlistfmId: 'nye' }]],
    ['b', [{ id: 'b1', artist: 'Phish', venue: 'Madison Square Garden', date: '2024-12-31', setlistfmId: 'nye' }, { id: 'b2', artist: 'goose', venue: 'red rocks', date: '21-06-2024' }]],
    ['c', [{ id: 'c1', artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlistfmId: 'nye' }]],
    ['d', [{ id: 'd1', artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlistfmId: 'nye' }]],
    ['rev', [{ id: 'r1', artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlistfmId: 'nye' }]],
  ]);
  const plan = planBackfill({
    friendEdges: ['a>b', 'b>a', 'a>c', /* c never listed a */ 'a>d', 'd>a', 'a>rev', 'rev>a'],
    blocked: new Set(['d|a']),
    showsByUid: shows,
    excludedUids: new Set(['rev']),
  });
  assert.strictEqual(plan.pairs, 1, 'only a–b: c is one-sided, d blocked, rev an App Review account');
  assert.deepStrictEqual(plan.suggestions.map((x) => x.docId), [suggestionDocId('a', 'b', 'nye')], 'nye once (a has it twice), Goose skipped');
  assert.strictEqual(plan.skippedTagged, 1);
  assert.deepStrictEqual(plan.perUser, { a: 1, b: 1 });
  const again = planBackfill({ friendEdges: ['a>b', 'b>a'], showsByUid: shows, existingIds: new Set([suggestionDocId('a', 'b', 'nye')]) });
  assert.strictEqual(again.suggestions.length, 0, 'idempotent: an existing suggestion is not planned again');
});

test('backfill waits for the live iOS version', () => {
  assert.strictEqual(versionAtLeast('3.13.12', '3.13.27'), false);
  assert.strictEqual(versionAtLeast('3.13.27', '3.13.27'), true);
  assert.strictEqual(versionAtLeast('3.14', '3.13.27'), true);
  assert.strictEqual(versionAtLeast(undefined, '3.13.27'), false);
});

run('Friend reads on the server (5.60.11)');
