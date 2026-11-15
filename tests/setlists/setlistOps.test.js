/**
 * Setlist operations on the server (5.60.7, pre-native server moves Part
 * 2): propose-setlist, accept-proposal, reject-proposal, resync-show,
 * scan-missing-setlists, end to end against the in-memory Firestore, and
 * the admin resync's write.
 *
 * Above all: every way a resync could drop a rating before 5.60.7 is
 * reproduced here, and each one now keeps it.
 *   1. The app merged against the copy of the show it had loaded, not the
 *      stored one (AppContext.applySetlistProposal): a rating made since,
 *      on another device or another tab, was written over.
 *   2. The app's setlist.fm scan wrote songs over a show it had listed as
 *      having none, without looking again (scanForMissingSetlists).
 *   3. The admin resync's band-source write had no guard and no
 *      transaction: a rating made while the walk ran was written over.
 *   4. A renamed song (the band's title alias) and a rated song the source
 *      doesn't list: the merge carries / keeps them; checked through the
 *      endpoints, so the server path is the one exercised.
 * The ratings guard itself (lib/setlistNotes.js lostNotes) is tested in
 * tests/security/adminShowWrites.test.js.
 *
 *   node tests/setlists/setlistOps.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestDeps } = require('../../netlify/functions/lib/setlistOpsHandler');
const { mergeSourceSetlist } = require('../../lib/bandSetlistRules');
const { lostNotes, userNoteCounts } = require('../../lib/setlistNotes');
const ops = require('../../netlify/functions/lib/setlistOps');

const fn = (name) => require(`../../netlify/functions/${name}`);
const propose = fn('propose-setlist');
const accept = fn('accept-proposal');
const reject = fn('reject-proposal');
const resync = fn('resync-show');
const scan = fn('scan-missing-setlists');
const { _writeMerged } = fn('admin-resync-setlists');

const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com' };
const BOB = { uid: 'bobUid00000001', email: 'bob@example.com' };

const song = (name, set = 'Set I', extra = {}) => ({ id: `id-${name}`, name, set, ...extra });

// El Goose for 2024-06-21: "Same Old Shenanigans" is what setlist.fm calls "SOS".
const ELGOOSE = {
  ok: true,
  songs: [song('Arcadia'), song('Same Old Shenanigans'), song('Hot Tea'), song('Madhuvan', 'Encore')].map((s, i) => ({ ...s, id: `eg${i}`, transitionMark: i === 0 ? '>' : '' })),
  sourceShowId: '1717', sourcePermalink: 'https://elgoose.net/setlists/x', setlistNotes: '', tour: 'Summer Tour',
};
const PHISH_SETLIST = {
  id: '63de4613', eventDate: '31-12-2024', url: 'https://www.setlist.fm/setlist/63de4613.html',
  artist: { name: 'Phish' }, venue: { name: 'MSG', city: { name: 'New York', country: { name: 'United States' } } },
  sets: { set: [{ song: [{ name: 'Tweezer' }, { name: 'Ghost' }] }] },
};

let db;
const asked = [];
function setup() {
  db = createFakeDb();
  const auth = createFakeAuth({ tokens: { 'alice-token': ALICE, 'bob-token': BOB }, users: [ALICE, BOB] });
  __setTestFirebase({ db, auth });
  asked.length = 0;
  __setTestDeps({
    bandSetlist: async (params) => { asked.push(['band', params.source]); return params.source === 'elgoose' && params.date === '2024-06-21' ? ELGOOSE : { ok: false, songs: [], shows: [] }; },
    searchSetlists: async (params) => { asked.push(['setlistfm', params.artistName]); return params.artistName === 'Phish' && params.year === '2024' ? { setlist: [PHISH_SETLIST] } : { setlist: [] }; },
  });
}

const call = (handler, token, body) => handler.handler({
  httpMethod: 'POST',
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: 'https://mysetlists.net' },
  body: JSON.stringify(body),
});
const json = (res) => JSON.parse(res.body);
const showPath = (id, uid = ALICE.uid) => `users/${uid}/shows/${id}`;

// A Goose show logged from setlist.fm, rated.
function gooseShow(setlist) {
  db._put(showPath('g1'), {
    artist: 'Goose', venue: 'Red Rocks Amphitheatre', date: '2024-06-21', setlistSource: 'setlistfm', setlistfmId: 'sf1', isManual: false,
    setlist: setlist || [song('Arcadia', 'Set I', { rating: 9 }), song('SOS', 'Set I', { rating: 8, comment: 'huge' }), song('Hot Tea')],
  });
}

test('signed out: 401; no showId: 400', async () => {
  setup();
  assert.strictEqual((await call(propose, null, { showId: 'g1' })).statusCode, 401);
  assert.strictEqual((await call(resync, 'alice-token', {})).statusCode, 400);
});

test('only the caller’s own shows', async () => {
  setup();
  gooseShow();
  const res = json(await call(resync, 'bob-token', { showId: 'g1' }));
  assert.deepStrictEqual([res.ok, res.reason], [false, 'show-not-found']);
});

test('propose-setlist: the merge, in memory; nothing written', async () => {
  setup();
  gooseShow();
  const before = db._get(showPath('g1'));
  const res = json(await call(propose, 'alice-token', { showId: 'g1' }));
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.source.id, 'elgoose');
  assert.deepStrictEqual(res.setlist.map((x) => x.name), ['Arcadia', 'Same Old Shenanigans', 'Hot Tea', 'Madhuvan']);
  assert.deepStrictEqual(db._get(showPath('g1')), before);
});

test('case 4: resync-show carries a rating across the band’s rename (SOS → Same Old Shenanigans)', async () => {
  setup();
  gooseShow();
  const res = json(await call(resync, 'alice-token', { showId: 'g1' }));
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  const show = db._get(showPath('g1'));
  assert.strictEqual(show.setlistSource, 'elgoose');
  const sos = show.setlist.find((x) => x.name === 'Same Old Shenanigans');
  assert.deepStrictEqual([sos.rating, sos.comment], [8, 'huge']);
  assert.strictEqual(show.setlist.find((x) => x.name === 'Arcadia').rating, 9);
  assert.deepStrictEqual(res.fields.setlist, show.setlist, 'the answer carries what was written');
});

test('case 4: a rated song the source doesn’t list is kept, flagged, with its rating', async () => {
  setup();
  gooseShow([song('Arcadia', 'Set I', { rating: 9 }), song('Tumble', 'Set I', { rating: 7 })]);
  const res = json(await call(resync, 'alice-token', { showId: 'g1' }));
  assert.strictEqual(res.ok, true);
  const tumble = db._get(showPath('g1')).setlist.find((x) => x.name === 'Tumble');
  assert.deepStrictEqual([tumble.rating, tumble.notInSource], [7, true]);
  assert.deepStrictEqual(userNoteCounts(db._get(showPath('g1')).setlist), { rated: 2, commented: 0 });
});

test('case 1: a rating made after the proposal was fetched survives accepting it', async () => {
  setup();
  gooseShow();
  const proposal = json(await call(propose, 'alice-token', { showId: 'g1' }));
  // Meanwhile, on another device: Hot Tea gets rated.
  const stored = db._get(showPath('g1'));
  db._put(showPath('g1'), { ...stored, setlist: stored.setlist.map((x) => (x.name === 'Hot Tea' ? { ...x, rating: 10, comment: 'peak' } : x)) });
  // What the app did before 5.60.7: merge against its stale copy and write.
  const stale = mergeSourceSetlist(stored.setlist, ELGOOSE).setlist;
  assert.ok(lostNotes(db._get(showPath('g1')).setlist, stale), 'the old way would have lost the new rating');
  // Now: the server re-merges against the stored show.
  const res = json(await call(accept, 'alice-token', { showId: 'g1', result: proposal.result }));
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  const hotTea = db._get(showPath('g1')).setlist.find((x) => x.name === 'Hot Tea');
  assert.deepStrictEqual([hotTea.rating, hotTea.comment], [10, 'peak']);
  assert.deepStrictEqual(userNoteCounts(db._get(showPath('g1')).setlist), { rated: 3, commented: 2 });
});

test('accept-proposal onlyIfEmpty: a show that has gained a setlist is left alone', async () => {
  setup();
  gooseShow([song('Arcadia', 'Set I', { rating: 6 })]);
  const before = db._get(showPath('g1'));
  const res = json(await call(accept, 'alice-token', { showId: 'g1', result: { ...ELGOOSE, source: 'elgoose', bandKey: 'goose' }, onlyIfEmpty: true }));
  assert.deepStrictEqual([res.ok, res.reason], [false, 'has-setlist']);
  assert.deepStrictEqual(db._get(showPath('g1')), before);
});

test('resync-show never writes an Internet Archive setlist unreviewed', async () => {
  setup();
  db._put(showPath('gd'), { artist: 'Grateful Dead', venue: 'Barton Hall', date: '1977-05-08', setlist: [song('Scarlet Begonias', 'Set II', { rating: 10 })] });
  __setTestDeps({ bandSetlist: async () => ({ ok: true, songs: [song('Scarlet Begonias', 'Set II')], confidence: 'explicit-sets' }), searchSetlists: async () => null });
  const res = json(await call(resync, 'alice-token', { showId: 'gd' }));
  if (res.source && res.source.id === 'archive') {
    assert.deepStrictEqual([res.ok, res.reason], [false, 'needs-review']);
  } else {
    assert.strictEqual(res.ok, false, 'with the Archive switched off, Grateful Dead is not a band source');
  }
  assert.strictEqual(db._get(showPath('gd')).setlist[0].rating, 10);
});

test('stored proposals: accept writes it and records the decision; reject records only the decision', async () => {
  setup();
  const proposal = { source: 'elgoose', status: 'pending', songs: ELGOOSE.songs, sourceShowId: '1717' };
  gooseShow();
  db._put(showPath('g1'), { ...db._get(showPath('g1')), setlistProposal: proposal });
  const res = json(await call(accept, 'alice-token', { showId: 'g1' }));
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  const show = db._get(showPath('g1'));
  assert.strictEqual(show.setlistProposal.status, 'accepted');
  assert.ok(show.setlistProposal.decidedAt);
  assert.strictEqual(show.setlist.find((x) => x.name === 'Same Old Shenanigans').rating, 8);
  assert.deepStrictEqual(json(await call(accept, 'alice-token', { showId: 'g1' })).reason, 'no-proposal', 'once');

  gooseShow();
  db._put(showPath('g1'), { ...db._get(showPath('g1')), setlistProposal: proposal });
  const before = db._get(showPath('g1')).setlist;
  const declined = json(await call(reject, 'alice-token', { showId: 'g1' }));
  assert.strictEqual(declined.ok, true);
  assert.strictEqual(db._get(showPath('g1')).setlistProposal.status, 'declined');
  assert.deepStrictEqual(db._get(showPath('g1')).setlist, before, 'the setlist is untouched');
});

test('scan-missing-setlists: setlist.fm for a show with none, the band source for a band, the rest reported', async () => {
  setup();
  db._put(showPath('p1'), { artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlist: [] });
  db._put(showPath('g2'), { artist: 'Goose', venue: 'Red Rocks Amphitheatre', date: '2024-06-21', setlist: [] });
  db._put(showPath('x1'), { artist: 'Nobody Knows', venue: 'A Bar', date: '2024-01-01', setlist: [] });
  db._put(showPath('h1'), { artist: 'Phish', date: '2024-12-30', setlist: [song('Ghost', 'Set I', { rating: 5 })] });
  const res = json(await call(scan, 'alice-token', {}));
  assert.deepStrictEqual([res.scanned, res.found, res.remaining], [3, 2, []]);
  const byId = Object.fromEntries(res.results.map((r) => [r.showId, r]));
  assert.deepStrictEqual([byId.p1.status, byId.p1.via, byId.g2.status, byId.g2.via, byId.x1.status], ['found', 'setlistfm', 'found', 'elgoose', 'none']);
  assert.deepStrictEqual(db._get(showPath('p1')).setlist.map((x) => x.name), ['Tweezer', 'Ghost']);
  assert.strictEqual(db._get(showPath('p1')).setlistfmId, '63de4613');
  assert.strictEqual(db._get(showPath('g2')).setlistSource, 'elgoose');
  assert.strictEqual(db._get(showPath('h1')).setlist[0].rating, 5, 'a show with a setlist is not scanned');
});

test('case 2: a show that gains a setlist while the scan runs is not written over', async () => {
  setup();
  db._put(showPath('p1'), { artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlist: [] });
  // The user adds and rates a song between the scan's lookup and its write.
  const realTx = db.runTransaction.bind(db);
  db.runTransaction = async (f) => {
    db._put(showPath('p1'), { ...db._get(showPath('p1')), setlist: [song('Carini', 'Set I', { rating: 9, manuallyAdded: true })] });
    return realTx(f);
  };
  const res = json(await call(scan, 'alice-token', { showIds: ['p1'] }));
  assert.strictEqual(res.results[0].status, 'has-setlist');
  assert.deepStrictEqual(db._get(showPath('p1')).setlist.map((x) => [x.name, x.rating]), [['Carini', 9]]);
});

test('scan-missing-setlists dryRun writes nothing', async () => {
  setup();
  db._put(showPath('p1'), { artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlist: [] });
  const res = json(await call(scan, 'alice-token', { dryRun: true }));
  assert.strictEqual(res.results[0].status, 'would-find');
  assert.deepStrictEqual(db._get(showPath('p1')).setlist, []);
});

test('case 3: the admin resync’s write re-merges against the stored show (a rating made during the walk survives)', async () => {
  setup();
  gooseShow();
  const ref = db.collection('users').doc(ALICE.uid).collection('shows').doc('g1');
  // The walk read the show earlier; since then Hot Tea was rated.
  const stored = db._get(showPath('g1'));
  db._put(showPath('g1'), { ...stored, setlist: stored.setlist.map((x) => (x.name === 'Hot Tea' ? { ...x, rating: 10 } : x)) });
  const done = await _writeMerged(db, ref, ELGOOSE.songs, { aliases: { SOS: 'Same Old Shenanigans' } }, (current, setlist) => ({ setlist, setlistSource: 'elgoose' }));
  assert.strictEqual(done.ok, true);
  const show = db._get(showPath('g1'));
  assert.strictEqual(show.setlist.find((x) => x.name === 'Hot Tea').rating, 10);
  assert.strictEqual(show.setlist.find((x) => x.name === 'Same Old Shenanigans').rating, 8);
});

test('scheduled scan: the longest unchecked first, review accounts and seed shows left out, each marked', async () => {
  setup();
  db._put('userProfiles/rev', { handle: 'alexreviewer' });
  db._put(showPath('p1'), { artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlist: [] });
  db._put(showPath('seed-1'), { artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlist: [] });
  db._put('users/rev/shows/r1', { artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlist: [] });
  db._put(showPath('recent'), { artist: 'Nobody', date: '2024-01-01', setlist: [], setlistScanAt: new Date().toISOString() });
  const deps = { bandSetlist: async () => null, searchSetlists: async (p) => (p.artistName === 'Phish' ? { setlist: [PHISH_SETLIST] } : { setlist: [] }) };
  const out = await ops.scheduledScan(db, deps, { budgetMs: 60000, pause: async () => {} });
  assert.deepStrictEqual([out.candidates, out.scanned, out.found, out.excludedUsers], [1, 1, 1, 1]);
  assert.ok(db._get(showPath('p1')).setlistScanAt);
  assert.deepStrictEqual(db._get('users/rev/shows/r1').setlist, [], 'the App Review account is untouched');
  assert.deepStrictEqual(db._get(showPath('seed-1')).setlist, []);
  assert.strictEqual((await ops.scheduledScan(db, deps, { budgetMs: 60000, pause: async () => {} })).candidates, 0, 'marked shows wait 30 days');
});

test('a failed setlist.fm search is an error, not "no setlist": the show is not marked and is tried again', async () => {
  setup();
  db._put(showPath('p1'), { artist: 'Phish', venue: 'MSG', date: '2024-12-31', setlist: [] });
  const deps = { bandSetlist: async () => null, searchSetlists: async () => null };
  const out = await ops.scheduledScan(db, deps, { budgetMs: 60000, pause: async () => {} });
  assert.deepStrictEqual(out.byStatus, { error: 1 });
  assert.strictEqual(db._get(showPath('p1')).setlistScanAt, undefined);
  assert.strictEqual((await ops.scheduledScan(db, deps, { budgetMs: 60000, pause: async () => {} })).candidates, 1, 'still a candidate');
});

run('Setlist operations (5.60.7)');
