/**
 * The 5.60.3 hotfix: two admin functions that wrote show documents.
 *
 *   - admin-bulk-import put the admin's email address on every show it
 *     wrote (`importedByAdmin`), and show documents are readable by the
 *     owner's friends. It now writes `true`; the script
 *     scripts/scrub-show-admin-emails.js replaces the stored copies.
 *   - admin-populate-setlist refused only a hand-made (`isManual`)
 *     setlist, so a setlist.fm show with rated songs could be overwritten,
 *     and a cross-reference copied the donor's ratings and comments. It now
 *     runs the shared ratings guard (lib/setlistNotes.js) inside a
 *     transaction and never copies notes.
 *
 *   node tests/security/adminShowWrites.test.js
 *
 * firebase-admin is replaced in-process with the in-memory Firestore the
 * email tests use; nothing here reaches a network or a real database.
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const Module = require('module');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { userNoteCounts, lostNotes, withoutUserNotes } = require('../../lib/setlistNotes');
const { planScrub } = require('../../scripts/scrub-show-admin-emails');

process.env.SETLISTFM_API_KEY = process.env.SETLISTFM_API_KEY || 'test-key';

const ADMIN = { uid: 'adminUid000001', email: 'admin@example.com', email_verified: true, admin: true };
const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com' };

// ── firebase-admin, replaced ───────────────────────────────────────────
let db;
let auth;
const fakeModules = {
  'firebase-admin/app': { getApps: () => [{}], initializeApp: () => ({}), cert: () => ({}) },
  'firebase-admin/auth': { getAuth: () => auth },
  'firebase-admin/firestore': {
    getFirestore: () => db,
    FieldValue: { serverTimestamp: () => '__serverTimestamp__', delete: () => '__delete__' },
  },
};
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (fakeModules[request]) return fakeModules[request];
  return realLoad.call(this, request, parent, isMain);
};

const bulkImport = require('../../netlify/functions/admin-bulk-import');
const populate = require('../../netlify/functions/admin-populate-setlist');

function setup() {
  db = createFakeDb();
  auth = createFakeAuth({ tokens: { 'admin-token': ADMIN, 'alice-token': ALICE }, users: [ADMIN, ALICE] });
  db._put(`userProfiles/${ALICE.uid}`, { displayName: 'Alice' });
}

const post = (fn, token, body) => fn.handler({
  httpMethod: 'POST',
  headers: { authorization: `Bearer ${token}`, origin: 'https://mysetlists.net' },
  body: JSON.stringify(body),
});
const json = (res) => JSON.parse(res.body);
const showPath = (id) => `users/${ALICE.uid}/shows/${id}`;
const EMAILISH = /[^\s@]+@[^\s@]+\.[^\s@]+/;

// ── lib/setlistNotes.js ───────────────────────────────────────────────

test('userNoteCounts counts ratings and non-blank comments', () => {
  assert.deepStrictEqual(userNoteCounts([{ rating: 8 }, { comment: '  ' }, { comment: 'wow' }, { rating: 0 }, {}]), { rated: 2, commented: 1 });
  assert.deepStrictEqual(userNoteCounts(null), { rated: 0, commented: 0 });
});

test('lostNotes: fewer rated or commented songs is a loss; more or equal is not', () => {
  const rated = [{ name: 'A', rating: 9 }, { name: 'B', comment: 'yes' }];
  assert.strictEqual(lostNotes(rated, [{ name: 'A' }, { name: 'B' }]), true);
  assert.strictEqual(lostNotes(rated, [{ name: 'A', rating: 9 }]), true, 'the comment went');
  assert.strictEqual(lostNotes(rated, [...rated, { name: 'C' }]), false);
  assert.strictEqual(lostNotes([], [{ name: 'A' }]), false);
  assert.strictEqual(lostNotes(undefined, undefined), false);
});

test('withoutUserNotes keeps the song and drops rating and comment', () => {
  assert.deepStrictEqual(withoutUserNotes({ id: 'x', name: 'A', set: 'Set I', rating: 7, comment: 'c' }), { id: 'x', name: 'A', set: 'Set I' });
});

// ── admin-bulk-import ─────────────────────────────────────────────────

test('bulk import: shows carry importedByAdmin: true and no address anywhere', async () => {
  setup();
  const res = await post(bulkImport, 'admin-token', {
    targetUid: ALICE.uid,
    shows: [{ artist: 'Goose', venue: 'Red Rocks', date: '2024-06-21' }, { artist: 'Phish', venue: 'MSG', date: '2023-12-31' }],
  });
  assert.strictEqual(res.statusCode, 200, res.body);
  const shows = db._list(`users/${ALICE.uid}/shows`);
  assert.strictEqual(shows.length, 2);
  for (const show of shows) {
    assert.strictEqual(show.importedByAdmin, true);
    for (const [field, value] of Object.entries(show)) {
      assert.ok(!(typeof value === 'string' && EMAILISH.test(value)), `show field ${field} holds an address`);
    }
  }
});

test('bulk import: still admin-only', async () => {
  setup();
  const res = await post(bulkImport, 'alice-token', { targetUid: ALICE.uid, shows: [{ artist: 'A', venue: 'V', date: '2024-01-01' }] });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(db._list(`users/${ALICE.uid}/shows`).length, 0);
});

test('bulk import: builds shows as every add path does (5.60.5): ISO date, minted ids, the one duplicate rule', async () => {
  setup();
  db._put(`users/${ALICE.uid}/shows/1700000000001`, { artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlist: [] });
  const res = await post(bulkImport, 'admin-token', {
    targetUid: ALICE.uid,
    shows: [
      { artist: 'phish', venue: 'M.S.G.', date: '31-12-2024' },            // the same show: skipped
      { artist: 'Phish', venue: 'Madison Square Garden', date: '2024-12-31' }, // possible: imported, as before
      { artist: ' Goose ', venue: 'Red Rocks', date: '21-06-2024', rating: 8, tour: '' },
      { artist: 'Goose', venue: 'Red Rocks', date: '2024-06-21' },          // repeats a row above: skipped
    ],
  });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.deepStrictEqual([json(res).imported, json(res).duplicatesSkipped], [2, 2]);
  const goose = db._list(`users/${ALICE.uid}/shows`).find((x) => x.artist === 'Goose');
  assert.deepStrictEqual([goose.date, goose.rating, goose.tour, goose.isManual, goose.setlistSource, goose.normalizedVersion], ['2024-06-21', 8, null, true, 'setlistfm', 1]);
  assert.match(goose.id, /^\d{13}$/);
});

// ── scripts/scrub-show-admin-emails.js ────────────────────────────────

test('scrub plan: finds address-valued importedByAdmin, counts flagged ones, reports other fields', () => {
  const doc = (data) => ({ data: () => data });
  const plan = planScrub([
    doc({ importedByAdmin: 'admin@example.com' }),
    doc({ importedByAdmin: true }),
    doc({ artist: 'A' }),
    doc({ comment: 'met bob@example.com there' }),
  ]);
  assert.strictEqual(plan.scanned, 4);
  assert.strictEqual(plan.toFix.length, 1);
  assert.strictEqual(plan.alreadyFlagged, 1);
  assert.deepStrictEqual(plan.otherFields, { comment: 1 });
});

test('scrub plan: idempotent — a fixed document is not planned again', () => {
  const plan = planScrub([{ data: () => ({ importedByAdmin: true }) }]);
  assert.strictEqual(plan.toFix.length, 0);
});

// ── admin-populate-setlist ────────────────────────────────────────────

const incoming = { songs: [{ id: 's1', name: 'Arcadia', set: 'Set I' }, { id: 's2', name: 'Hot Tea', set: 'Set I' }], setlistfmId: 'abc', populatedFrom: 'test' };

test('populate: fills an empty setlist', async () => {
  setup();
  db._put(showPath('1'), { artist: 'Goose', date: '2024-06-21', setlist: [], isManual: true });
  const res = await post(populate, 'admin-token', { userId: ALICE.uid, showId: '1', setlistData: incoming });
  assert.strictEqual(res.statusCode, 200, res.body);
  const show = db._get(showPath('1'));
  assert.strictEqual(show.setlist.length, 2);
  assert.strictEqual(show.isManual, false);
  assert.strictEqual(show.setlistfmId, 'abc');
});

test('populate: refuses a setlist.fm show with rated songs (isManual false), writing nothing', async () => {
  setup();
  const setlist = [{ id: 'a', name: 'Arcadia', rating: 9 }, { id: 'b', name: 'Hot Tea', comment: 'best ever' }];
  db._put(showPath('2'), { artist: 'Goose', date: '2024-06-21', setlist, isManual: false, setlistfmId: 'old' });
  const writesBefore = db._writes.length;
  const res = await post(populate, 'admin-token', { userId: ALICE.uid, showId: '2', setlistData: incoming });
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(json(res).reason, 'would-lose-notes');
  assert.deepStrictEqual(json(res).before, { rated: 1, commented: 1 });
  assert.deepStrictEqual(db._get(showPath('2')).setlist, setlist);
  assert.strictEqual(db._writes.length, writesBefore, 'nothing written');
});

test('populate: a setlist with no notes can still be replaced', async () => {
  setup();
  db._put(showPath('3'), { artist: 'Goose', date: '2024-06-21', setlist: [{ id: 'z', name: 'Wrong Song' }], isManual: false });
  const res = await post(populate, 'admin-token', { userId: ALICE.uid, showId: '3', setlistData: incoming });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.deepStrictEqual(db._get(showPath('3')).setlist.map((s) => s.name), ['Arcadia', 'Hot Tea']);
});

test('populate: still refuses a hand-made setlist', async () => {
  setup();
  db._put(showPath('4'), { artist: 'Goose', date: '2024-06-21', setlist: [{ id: 'm', name: 'Mine' }], isManual: true });
  const res = await post(populate, 'admin-token', { userId: ALICE.uid, showId: '4', setlistData: incoming });
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(json(res).reason, 'manual-setlist');
});

test('populate: cross-reference copies the songs but never the donor’s ratings or comments', async () => {
  setup();
  db._put(showPath('5'), { artist: 'Goose', date: '2024-06-21', setlist: [], isManual: true });
  db._put('users/donorUid0000001/shows/d1', {
    artist: 'Goose', date: '2024-06-21', setlistfmId: 'don',
    setlist: [{ id: 'd', name: 'Arcadia', set: 'Set I', rating: 10, comment: 'the donor’s note' }],
  });
  const res = await post(populate, 'admin-token', { userId: ALICE.uid, showId: '5', source: 'cross_reference', donorUserId: 'donorUid0000001', donorShowId: 'd1' });
  assert.strictEqual(res.statusCode, 200, res.body);
  const [song] = db._get(showPath('5')).setlist;
  assert.strictEqual(song.name, 'Arcadia');
  assert.strictEqual(song.rating, undefined);
  assert.strictEqual(song.comment, undefined);
});

test('populate: a rating added after the first check is caught inside the transaction', async () => {
  setup();
  db._put(showPath('6'), { artist: 'Goose', date: '2024-06-21', setlist: [{ id: 'a', name: 'Arcadia' }], isManual: false });
  // The user rates a song between the function's first read and its write:
  // wrap the transaction so the rating lands just before it runs.
  const realTx = db.runTransaction.bind(db);
  db.runTransaction = async (fn) => {
    db._put(showPath('6'), { ...db._get(showPath('6')), setlist: [{ id: 'a', name: 'Arcadia', rating: 8 }] });
    return realTx(fn);
  };
  const res = await post(populate, 'admin-token', { userId: ALICE.uid, showId: '6', setlistData: incoming });
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(db._get(showPath('6')).setlist[0].rating, 8);
});

test('populate: still admin-only', async () => {
  setup();
  db._put(showPath('7'), { artist: 'Goose', date: '2024-06-21', setlist: [] });
  const res = await post(populate, 'alice-token', { userId: ALICE.uid, showId: '7', setlistData: incoming });
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(db._get(showPath('7')).setlist, []);
});

run('Admin show writes (5.60.3 hotfix)');
