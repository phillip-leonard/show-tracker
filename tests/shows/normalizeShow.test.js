/**
 * normalize-show end to end against the in-memory Firestore (5.60.5): who
 * may call it, preview vs commit, the duplicate rules on a write, tags,
 * a show written offline (needsNormalization) normalized in place without
 * losing the user's edits, and the sweep.
 *
 *   node tests/shows/normalizeShow.test.js
 *
 * setlist.fm and the band source are stubbed (normalizeShowServer
 * __setTestDeps); every Firestore read and write is real against the fake.
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestDeps } = require('../../netlify/functions/lib/normalizeShowServer');
const { sweepPending, sweepStored } = require('../../netlify/functions/lib/showSweep');
const normalizeShow = require('../../netlify/functions/normalize-show');

const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com' };
const BOB = { uid: 'bobUid00000001', email: 'bob@example.com' };

const PHISH = {
  id: '63de4613', eventDate: '31-12-2024', url: 'https://www.setlist.fm/setlist/63de4613.html',
  artist: { mbid: 'e01646f2', name: 'Phish' },
  venue: { name: 'Madison Square Garden', city: { name: 'New York', country: { name: 'United States' } } },
  sets: { set: [{ song: [{ name: 'Tweezer' }, { name: 'Ghost' }] }] },
};
const NO_SHOW = { ok: false, songs: [], shows: [] };

function setup({ band = NO_SHOW } = {}) {
  const db = createFakeDb();
  const auth = createFakeAuth({ tokens: { 'alice-token': ALICE, 'bob-token': BOB }, users: [ALICE, BOB] });
  __setTestFirebase({ db, auth });
  __setTestDeps(() => ({
    setlistfmSetlist: async (id) => (id === PHISH.id ? PHISH : null),
    bandSetlist: async () => band,
  }));
  return db;
}

const call = (token, body) => normalizeShow.handler({
  httpMethod: 'POST',
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: 'https://mysetlists.net' },
  body: JSON.stringify(body),
});
const json = (res) => JSON.parse(res.body);
const aliceShows = (db) => db._list(`users/${ALICE.uid}/shows`);
const SHOW_ID = '1763121600000';

test('signed out: 401; bad mode or no input: 400', async () => {
  setup();
  assert.strictEqual((await call(null, { mode: 'preview', input: { kind: 'manual' } })).statusCode, 401);
  assert.strictEqual((await call('alice-token', { mode: 'save', input: { kind: 'manual' } })).statusCode, 400);
  assert.strictEqual((await call('alice-token', { mode: 'preview' })).statusCode, 400);
  assert.strictEqual((await call('alice-token', { mode: 'preview', inputs: Array(26).fill({ kind: 'manual' }) })).statusCode, 400);
});

test('preview returns the document and writes nothing', async () => {
  const db = setup();
  const res = await call('alice-token', { mode: 'preview', input: { kind: 'setlistfm', setlistfmId: PHISH.id } });
  assert.strictEqual(res.statusCode, 200, res.body);
  const body = json(res);
  assert.strictEqual(body.show.date, '2024-12-31');
  assert.strictEqual(body.show.setlistfmId, PHISH.id);
  assert.strictEqual(body.show.setlist.length, 2);
  assert.strictEqual(body.duplicate, null);
  assert.strictEqual(aliceShows(db).length, 0);
});

test('commit creates the document under the client-minted id; a second commit is a duplicate, not a copy', async () => {
  const db = setup();
  const first = json(await call('alice-token', { mode: 'commit', input: { kind: 'setlistfm', setlistfmId: PHISH.id, showId: SHOW_ID } }));
  assert.strictEqual(first.created, true);
  assert.strictEqual(first.showId, SHOW_ID);
  const stored = db._get(`users/${ALICE.uid}/shows/${SHOW_ID}`);
  assert.strictEqual(stored.normalizedVersion, 1);
  assert.strictEqual(stored.id, undefined, 'the id is the document id, not a field');
  const again = json(await call('alice-token', { mode: 'commit', input: { kind: 'setlistfm', setlistfmId: PHISH.id } }));
  assert.strictEqual(again.written, false);
  assert.deepStrictEqual(again.duplicate, { showId: SHOW_ID, rule: 'setlistfm-id' });
  assert.strictEqual(aliceShows(db).length, 1);
});

test('a possible duplicate is only a question: nothing written until the user confirms', async () => {
  const db = setup();
  db._put(`users/${ALICE.uid}/shows/1700000000001`, { artist: 'Goose', venue: "Dick's Sporting Goods Park", date: '2024-08-31', setlist: [] });
  const input = { kind: 'manual', artist: 'Goose', venue: 'DSG Park', city: 'Commerce City', date: '2024-08-31' };
  const asked = json(await call('alice-token', { mode: 'commit', input }));
  assert.strictEqual(asked.needsConfirmation, true);
  assert.strictEqual(asked.duplicate.rule, 'possible');
  assert.strictEqual(aliceShows(db).length, 1);
  const confirmed = json(await call('alice-token', { mode: 'commit', input: { ...input, confirmPossible: true } }));
  assert.strictEqual(confirmed.created, true);
  assert.strictEqual(aliceShows(db).length, 2);
});

test('tag: only a pending tag addressed to the caller; accepting marks it and adds the show', async () => {
  const db = setup();
  db._put('showTags/t1', { fromUid: BOB.uid, fromName: 'Bob', toUid: ALICE.uid, status: 'pending', showData: { artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlist: [{ id: 'x', name: 'Tweezer', rating: 10 }] } });
  const stolen = await call('bob-token', { mode: 'commit', input: { kind: 'tag', tagId: 't1' } });
  assert.strictEqual(stolen.statusCode, 400);
  assert.strictEqual(json(stolen).error.code, 'tag-not-found');
  const res = json(await call('alice-token', { mode: 'commit', input: { kind: 'tag', tagId: 't1' } }));
  assert.strictEqual(res.created, true);
  const [show] = aliceShows(db);
  assert.strictEqual(show.taggedByUid, BOB.uid);
  assert.strictEqual(show.setlist[0].rating, undefined, 'never the tagger’s notes');
  assert.strictEqual(db._get('showTags/t1').status, 'accepted');
  assert.strictEqual(json(await call('alice-token', { mode: 'commit', input: { kind: 'tag', tagId: 't1' } })).error.code, 'tag-not-found', 'once');
});

test('a tag for a show already logged credits the friend on the existing show', async () => {
  const db = setup();
  db._put(`users/${ALICE.uid}/shows/1700000000001`, { artist: 'Phish', venue: 'MSG', date: '31-12-2024', setlist: [] });
  db._put('showTags/t2', { fromUid: BOB.uid, fromName: 'Bob', toUid: ALICE.uid, status: 'pending', showData: { artist: 'Phish', venue: 'MSG', date: '2024-12-31' } });
  const res = json(await call('alice-token', { mode: 'commit', input: { kind: 'tag', tagId: 't2' } }));
  assert.strictEqual(res.mergedInto, '1700000000001');
  assert.strictEqual(aliceShows(db).length, 1);
  assert.strictEqual(db._get(`users/${ALICE.uid}/shows/1700000000001`).taggedBy, 'Bob');
  assert.strictEqual(db._get('showTags/t2').status, 'accepted');
});

test('email tag: only one sent to the caller’s own address', async () => {
  const db = setup();
  db._put('pendingEmailTags/e1', { fromUid: BOB.uid, fromName: 'Bob', toEmail: 'alice@example.com', status: 'pending', showData: { artist: 'Goose', venue: 'Red Rocks', date: '2024-06-21' } });
  assert.strictEqual(json(await call('bob-token', { mode: 'preview', input: { kind: 'email-tag', pendingEmailTagId: 'e1' } })).error.code, 'tag-not-found');
  const res = json(await call('alice-token', { mode: 'commit', input: { kind: 'email-tag', pendingEmailTagId: 'e1' } }));
  assert.strictEqual(res.created, true);
  assert.strictEqual(db._get('pendingEmailTags/e1').status, 'accepted');
});

test('upcoming: only the caller’s own upcoming show', async () => {
  const db = setup();
  db._put(`users/${BOB.uid}/upcomingShows/u1`, { artist: 'Phish', venue: 'MSG', date: '2024-12-31' });
  assert.strictEqual(json(await call('alice-token', { mode: 'preview', input: { kind: 'upcoming', upcomingId: 'u1' } })).error.code, 'upcoming-not-found');
});

test('a show written offline is normalized in place, keeping the user’s rating, comment and song notes', async () => {
  const db = setup({ band: { ok: true, songs: [{ id: 'eg1', name: 'Arcadia', set: 'Set I' }, { id: 'eg2', name: 'Hot Tea', set: 'Set I' }], sourceShowId: '1717', sourcePermalink: 'https://elgoose.net/x' } });
  const input = { kind: 'manual', artist: ' Goose ', venue: 'Red Rocks', city: 'Morrison', date: '21-06-2024' };
  db._put(`users/${ALICE.uid}/shows/${SHOW_ID}`, {
    ...input, setlist: [{ id: 'mine', name: 'Arcadia', rating: 9, comment: 'opener!' }], rating: 8, comment: 'rained', taggedFriendUids: ['f1'],
    needsNormalization: true, normalizationInput: input, createdAt: 'device',
  });
  const res = json(await call('alice-token', { mode: 'commit', input: { ...input, showId: SHOW_ID } }));
  assert.strictEqual(res.updated, true, JSON.stringify(res));
  const show = db._get(`users/${ALICE.uid}/shows/${SHOW_ID}`);
  assert.strictEqual(show.artist, 'Goose');
  assert.strictEqual(show.date, '2024-06-21');
  assert.strictEqual(show.setlistSource, 'elgoose');
  assert.deepStrictEqual([show.rating, show.comment, show.taggedFriendUids, show.createdAt], [8, 'rained', ['f1'], 'device']);
  const arcadia = show.setlist.find((s) => s.name === 'Arcadia');
  assert.deepStrictEqual([arcadia.rating, arcadia.comment], [9, 'opener!']);
  assert.strictEqual(show.setlist.length, 2);
  assert.deepStrictEqual([show.needsNormalization, show.normalizationInput], [false, null]);
  const again = json(await call('alice-token', { mode: 'commit', input: { ...input, showId: SHOW_ID } }));
  assert.strictEqual(again.alreadyNormalized, true);
});

test('batch: results in order, one bad input doesn’t stop the others', async () => {
  setup();
  const res = json(await call('alice-token', { mode: 'preview', inputs: [{ kind: 'manual', artist: 'A', venue: 'V', date: '2024-01-01' }, { kind: 'manual', artist: '', date: '2024-01-01' }, { kind: 'nope' }] }));
  assert.strictEqual(res.results.length, 3);
  assert.ok(res.results[0].show);
  assert.strictEqual(res.results[1].error.code, 'bad-input');
  assert.strictEqual(res.results[2].error.code, 'bad-kind');
});

test('sweep: a pending show is normalized from its saved input; one with no input only gets the stored fixes', async () => {
  const db = setup();
  const input = { kind: 'setlistfm', setlistfmId: PHISH.id };
  db._put(`users/${ALICE.uid}/shows/${SHOW_ID}`, { artist: 'Phish', date: '31-12-2024', setlist: [], needsNormalization: true, normalizationInput: input });
  db._put(`users/${ALICE.uid}/shows/1700000000009`, { artist: 'Goose', date: '21-06-2024', isManual: false, needsNormalization: true });
  const dry = await sweepPending(db, { write: false });
  assert.deepStrictEqual([dry.found, dry.wouldNormalize, dry.noInput, dry.normalized], [2, 1, 1, 0]);
  assert.strictEqual(db._get(`users/${ALICE.uid}/shows/${SHOW_ID}`).needsNormalization, true, 'the dry run wrote nothing');
  const done = await sweepPending(db, { write: true });
  assert.deepStrictEqual([done.normalized, done.noInput], [1, 1]);
  const show = db._get(`users/${ALICE.uid}/shows/${SHOW_ID}`);
  assert.deepStrictEqual([show.date, show.setlist.length, show.needsNormalization], ['2024-12-31', 2, false]);
  const bare = db._get(`users/${ALICE.uid}/shows/1700000000009`);
  assert.deepStrictEqual([bare.date, bare.isManual, bare.needsNormalization], ['2024-06-21', true, false]);
  assert.strictEqual((await sweepPending(db, { write: true })).found, 0, 'idempotent');
});

test('sweep: the stored pass fixes only the date, isManual and a missing setlist, and is idempotent', async () => {
  const db = setup();
  db._put(`users/${ALICE.uid}/shows/1`, { artist: ' Phish ', venue: '', date: '31-12-2024', isManual: true, setlistfmId: 'x', tour: '', rating: 9, setlist: [{ name: '' }] });
  db._put(`users/${ALICE.uid}/shows/2`, { artist: 'Goose', date: '2024-06-21', isManual: true, setlist: [] });
  db._put(`users/${ALICE.uid}/upcomingShows/3`, { artist: 'Not a show', date: '31-12-2030' });
  const dry = await sweepStored(db, { write: false });
  assert.deepStrictEqual(dry, { scanned: 2, changed: 1, byField: { date: 1, isManual: 1 } });
  await sweepStored(db, { write: true });
  const fixed = db._get(`users/${ALICE.uid}/shows/1`);
  assert.deepStrictEqual([fixed.date, fixed.isManual, fixed.artist, fixed.tour, fixed.rating, fixed.setlist], ['2024-12-31', false, ' Phish ', '', 9, [{ name: '' }]]);
  assert.strictEqual((await sweepStored(db, { write: false })).changed, 0);
});

run('normalize-show (5.60.5)');
