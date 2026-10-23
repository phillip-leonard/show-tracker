#!/usr/bin/env node
/**
 * admin-resync-setlists — who it walks, who it leaves alone, and what a
 * dry run writes (nothing).
 *
 *   node tests/resync/adminResync.test.js
 *
 * Why this test exists: until 5.47.7 the walk listed users with
 * collection('users').get(). In production no `users/{uid}` document exists
 * (only its subcollections), so that query returned nobody and every run
 * scanned zero shows. The fake Firestore here has the same shape: user
 * documents that exist only as parents of `shows`.
 *
 * firebase-admin and the band-setlist HTTP call are replaced in-process;
 * nothing here reaches a network or a real database.
 */

const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const https = require('https');
const { EventEmitter } = require('events');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ── A Firestore with production's shape ────────────────────────────────

function fakeFirestore({ shows, profiles }) {
  const writes = [];
  const showDocs = (uid) => Object.entries(shows[uid] || {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, data]) => ({ id, data: () => data, ref: { update: async (u) => writes.push({ uid, id, u }) } }));
  const showQuery = (uid, after = null) => ({
    orderBy: () => showQuery(uid, after),
    startAfter: (id) => showQuery(uid, id),
    get: async () => ({ docs: showDocs(uid).filter((d) => after == null || d.id > after) }),
  });
  return {
    writes,
    collection(name) {
      if (name === 'users') {
        return {
          // Parents only: no `get()` that would find them, as in production.
          listDocuments: async () => Object.keys(shows).map((id) => ({ id })),
          get: async () => ({ docs: [] }),
          orderBy: () => ({ startAt: () => ({ get: async () => ({ docs: [] }) }), get: async () => ({ docs: [] }) }),
          doc: (uid) => ({
            get: async () => ({ exists: false, id: uid }),
            collection: () => showQuery(uid),
          }),
        };
      }
      if (name === 'userProfiles') {
        return { doc: (uid) => ({ get: async () => ({ exists: !!profiles[uid], data: () => profiles[uid] }) }) };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

function stubModule(id, exports) {
  const resolved = require.resolve(id);
  const m = new Module(resolved);
  m.filename = resolved;
  m.loaded = true;
  m.exports = exports;
  require.cache[resolved] = m;
}

let db;
stubModule('firebase-admin/app', { getApps: () => [{}], initializeApp: () => {}, cert: () => ({}) });
stubModule('firebase-admin/auth', { getAuth: () => ({ verifyIdToken: async () => ({ email: 'phillip.leonard@gmail.com' }) }) });
stubModule('firebase-admin/firestore', { getFirestore: () => db, FieldPath: { documentId: () => '__name__' } });

// ── band-setlist, answered locally ─────────────────────────────────────

let bandSetlistResponses = {};
const asked = [];
https.request = (opts, onResponse) => {
  const url = new URL(`https://x${opts.path}`);
  const date = url.searchParams.get('date');
  asked.push(date);
  const req = new EventEmitter();
  req.setTimeout = () => {};
  req.end = () => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = { 'x-cache': 'MISS' };
    onResponse(res);
    res.emit('data', JSON.stringify(bandSetlistResponses[date] || { ok: true, songs: [], shows: [] }));
    res.emit('end');
  };
  req.destroy = () => {};
  return req;
};

const { handler } = require(path.join(__dirname, '../../netlify/functions/admin-resync-setlists.js'));

const song = (name, set = 'Set I', extra = {}) => ({ id: `id-${name}`, name, set, ...extra });
const run = async (body = {}) => {
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ limit: 1000, delayMs: 0, budgetMs: 60000, ...body }) });
  assert.strictEqual(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
};

function setUp() {
  asked.length = 0;
  bandSetlistResponses = {
    '2026-08-15': { ok: true, songs: [song('Same Old Shenanigans'), song('Arcadia')], selection: 'only', contested: [] },
    '2025-05-25': {
      ok: true, ambiguous: true, selection: 'venue-tie', message: '2 shows on 2025-05-25, 2 of them at "Napa Valley Expo"',
      songs: [song('Rockdale')],
      sourceShowId: 'a',
      candidates: [{ venue: 'Napa Valley Expo', songCount: 1 }, { venue: 'Napa Valley Expo', songCount: 2 }],
      contested: [
        { venue: 'Napa Valley Expo', sourceShowId: 'a', songs: [song('Rockdale')] },
        { venue: 'Napa Valley Expo', sourceShowId: 'b', songs: [song('Animal'), song('Hungersite')] },
      ],
    },
    '2025-06-21': { ok: true, songs: [song('Arcadia')], selection: 'only', contested: [] },
  };
  db = fakeFirestore({
    shows: {
      fan1: {
        '100': { artist: 'Goose', date: '2026-08-15', venue: 'Frost', setlist: [song('SOS', 'Set I', { rating: 8 }), song('Arrow', 'Set I', { rating: 9 }), song('Arcadia')] },
        '200': { artist: 'Goose', date: '25-05-2025', venue: 'Napa Valley Expo', setlist: [song('Animal'), song('Hungersite')] },
        '300': { artist: 'Radiohead', date: '2017-06-20', setlist: [song('Bloom')] },
      },
      fan2: { '400': { artist: 'Goose', date: '2026-08-15', venue: 'Frost', setlist: [] } },
      reviewer: { 'seed-g1-abc': { artist: 'Goose', date: '2025-06-21', venue: 'Red Rocks', setlist: [song('Arrow', 'Set I', { rating: 9 })] } },
      tester: { '500': { artist: 'Goose', date: '2025-06-21', setlist: [] } },
    },
    profiles: {
      fan1: { handle: 'fan1' },
      fan2: { handle: 'fan2' },
      reviewer: { handle: 'alexreviewer', handleLower: 'alexreviewer' },
      tester: { handle: 'qa', isTestUser: true },
    },
  });
}

test('finds users that exist only as parents of their shows', async () => {
  setUp();
  const r = await run({ source: 'elgoose' });
  assert.strictEqual(r.dryRun, true);
  assert.deepStrictEqual(r.shows.map((s) => s.showId).sort(), ['100', '200', '400']);
});

test('a dry run writes nothing', async () => {
  setUp();
  const r = await run({ source: 'elgoose' });
  assert.ok(r.wouldChange > 0);
  assert.deepStrictEqual(db.writes, []);
});

test('App Review accounts, isTestUser and seed fixtures are excluded by default and reported', async () => {
  setUp();
  const r = await run({ source: 'elgoose' });
  assert.deepStrictEqual(r.excluded.users.map((u) => [u.userId, u.reason]).sort(), [
    ['reviewer', 'App Review account (@alexreviewer)'],
    ['tester', 'isTestUser'],
  ]);
  assert.ok(!asked.includes('2025-06-21'), 'nothing is fetched for them');
});

test('includeTestAccounts brings the accounts and their seed shows back', async () => {
  setUp();
  const r = await run({ source: 'elgoose', includeTestAccounts: true });
  assert.deepStrictEqual(r.excluded.users, []);
  assert.ok(r.shows.some((s) => s.showId === 'seed-g1-abc'));
});

test('excludeUserIds and skipShowIds', async () => {
  setUp();
  const r = await run({ source: 'elgoose', excludeUserIds: ['fan2'], skipShowIds: ['200'] });
  assert.deepStrictEqual(r.shows.map((s) => s.showId), ['100']);
  assert.ok(r.excluded.users.some((u) => u.userId === 'fan2' && u.reason === 'excludeUserIds'));
  assert.deepStrictEqual(r.excluded.shows.map((s) => [s.showId, s.reason]), [['200', 'skipShowIds']]);
});

test('ratings survive: an alias carries one, a song the source lacks is kept', async () => {
  setUp();
  const r = await run({ source: 'elgoose' });
  const row = r.shows.find((s) => s.showId === '100');
  assert.deepStrictEqual(row.userNotes.rated, 2);
  assert.strictEqual(row.userNotes.ratingsCarried, 1, 'SOS -> Same Old Shenanigans');
  assert.deepStrictEqual(row.userNotes.keptNotInSource, ['Arrow']);
  assert.deepStrictEqual(row.summary.removed, []);
});

test('two shows at one venue: the existing setlist chooses by overlap', async () => {
  setUp();
  const r = await run({ source: 'elgoose' });
  const row = r.shows.find((s) => s.showId === '200');
  assert.strictEqual(row.selection, 'venue-tie');
  assert.strictEqual(row.incomingSongCount, 2);
  assert.strictEqual(row.summary.candidates.reason, 'overlap');
  assert.deepStrictEqual(row.summary.removed, []);
  assert.match(row.note, /100% song overlap/);
});

test('two shows at one venue and no existing setlist: skipped, not guessed', async () => {
  setUp();
  db = fakeFirestore({ shows: { fan3: { '600': { artist: 'Goose', date: '2025-05-25', venue: 'Napa Valley Expo', setlist: [] } } }, profiles: { fan3: {} } });
  const r = await run({ source: 'elgoose' });
  assert.strictEqual(r.wouldChange, 0);
  assert.strictEqual(r.ambiguousDates.length, 1);
  assert.strictEqual(r.sourceReturnedNothing.length, 0);
  assert.match(r.shows[0].note, /more than one show/);
});

test('a live run leaves an already up-to-date show alone, and still writes one whose source fields lag', async () => {
  setUp();
  const upToDate = [song('Same Old Shenanigans'), song('Arcadia')];
  const elgooseFields = { setlistSource: 'elgoose', sourceShowId: '', sourcePermalink: '', setlistNotes: '', isManual: false };
  db = fakeFirestore({
    shows: {
      fan1: {
        '700': { artist: 'Goose', date: '2026-08-15', venue: 'Frost', setlist: upToDate, ...elgooseFields, setlistFetchedAt: 'then' },
        '800': { artist: 'Goose', date: '2026-08-15', venue: 'Frost', setlist: upToDate, setlistSource: 'setlistfm' },
      },
    },
    profiles: { fan1: {} },
  });

  const r = await run({ source: 'elgoose', dryRun: false });
  assert.strictEqual(r.unchanged, 1);
  assert.strictEqual(r.changed, 1);
  assert.match(r.shows.find((s) => s.showId === '700').note, /^unchanged/);
  assert.deepStrictEqual(db.writes.map((w) => w.id), ['800'], 'only the show whose setlistSource changes is written');
  assert.strictEqual(db.writes[0].u.setlistSource, 'elgoose');
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.stack}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
