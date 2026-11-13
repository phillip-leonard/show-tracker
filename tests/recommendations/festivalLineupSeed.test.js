/**
 * Announced lineups from data/festival-lineups.json (5.58.0):
 * netlify/functions/lib/festivalLineupSeed.js and
 * netlify/functions/admin-seed-festival-lineups.js, on fixtures.
 *   - the file itself is well formed, and every entry names a catalog festival
 *   - set / replace / unchanged / missing / failed, one action per entry
 *   - a dry run writes nothing; a write touches only the four lineup fields
 *   - writing the same file twice writes nothing the second time
 *   - admin only
 *
 *   node tests/recommendations/festivalLineupSeed.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const S = require('../../netlify/functions/lib/festivalLineupSeed');
const { MAX_LINEUP } = require('../../netlify/functions/lib/festivalLineup');
const { handle } = require('../../netlify/functions/admin-seed-festival-lineups');
const FILE = require('../../data/festival-lineups.json');
const SEED = require('../../data/festival-seed.json');

const TODAY = '2026-11-09';
const UPCOMING = { name: 'Bonnaroo Music & Arts Festival', startDate: '2027-06-10', endDate: '2027-06-13', createdBy: 'system:seed', source: 'seed', seedKey: 'bonnaroo-2027' };
const PAST = { name: 'Bonnaroo Music & Arts Festival', startDate: '2024-06-13', endDate: '2024-06-16', createdBy: 'system:seed', source: 'seed', seedKey: 'bonnaroo-2024' };
const URL = 'https://www.bonnaroo.com/lineup';

const byId = (entries) => new Map(entries);

// ── The file ──────────────────────────────────────────────────────────────

test('the lineup file parses, and every entry is usable and names a catalog festival', () => {
  assert.ok(Array.isArray(FILE.lineups), 'lineups must be a list');
  const seedKeys = new Set(SEED.festivals.map((r) => r.seedKey));
  const ids = new Set();
  for (const entry of FILE.lineups) {
    assert.strictEqual(S.entryProblem(entry), '', JSON.stringify(entry).slice(0, 80));
    if (entry.seedKey) assert.ok(seedKeys.has(entry.seedKey), `no catalog festival ${entry.seedKey}`);
    const id = S.docIdFor(entry);
    assert.ok(!ids.has(id), `${id} is in the file twice`);
    ids.add(id);
  }
});

// ── Entries ───────────────────────────────────────────────────────────────

test('an entry needs exactly one of seedKey or festivalId', () => {
  assert.match(S.entryProblem({ artists: ['Goose'] }), /exactly one/);
  assert.match(S.entryProblem({ seedKey: 'a', festivalId: 'b', artists: ['Goose'] }), /exactly one/);
  assert.strictEqual(S.entryProblem({ seedKey: 'bonnaroo-2027', artists: ['Goose'] }), '');
  assert.strictEqual(S.entryProblem({ festivalId: 'abc123', artists: ['Goose'] }), '');
  assert.match(S.entryProblem({ festivalId: 'a/b', artists: ['Goose'] }), /bad festivalId/);
});

test('artists must be a non-empty list of names, within the cap', () => {
  assert.match(S.entryProblem({ seedKey: 'x', artists: 'Goose' }), /list/);
  assert.match(S.entryProblem({ seedKey: 'x', artists: ['Goose', 7] }), /string/);
  assert.match(S.entryProblem({ seedKey: 'x', artists: ['  ', ''] }), /no artists/);
  const many = Array.from({ length: MAX_LINEUP + 1 }, (_, i) => `Band ${i}`);
  assert.match(S.entryProblem({ seedKey: 'x', artists: many }), /max/);
});

test('sourceUrl is optional, and https only', () => {
  assert.strictEqual(S.entryProblem({ seedKey: 'x', artists: ['Goose'], sourceUrl: URL }), '');
  assert.match(S.entryProblem({ seedKey: 'x', artists: ['Goose'], sourceUrl: 'http://example.com' }), /https/);
  assert.match(S.entryProblem({ seedKey: 'x', artists: ['Goose'], sourceUrl: 'javascript:alert(1)' }), /https/);
});

test('artist names are trimmed, and duplicates dropped ignoring case, keeping order', () => {
  assert.deepStrictEqual(S.cleanArtists(['  Goose ', 'Billy   Strings', 'goose', '', 'Phish']), ['Goose', 'Billy Strings', 'Phish']);
});

test('a seedKey points at its seed_ document', () => {
  assert.strictEqual(S.docIdFor({ seedKey: 'bonnaroo-2027' }), 'seed_bonnaroo-2027');
  assert.strictEqual(S.docIdFor({ festivalId: 'abc123' }), 'abc123');
});

// ── The plan ──────────────────────────────────────────────────────────────

test('each entry lands in exactly one action', () => {
  const entries = [
    { seedKey: 'bonnaroo-2027', artists: ['Goose', 'Phish'], sourceUrl: URL }, // set
    { festivalId: 'tm', artists: ['Goose', 'Phish'] }, // replace (Ticketmaster)
    { festivalId: 'same', artists: ['Goose'], sourceUrl: URL }, // unchanged
    { seedKey: 'nope-2027', artists: ['Goose'] }, // missing
    { seedKey: 'bonnaroo-2027', artists: ['Again'] }, // failed: duplicate
    { artists: ['Nobody'] }, // failed: no id
  ];
  const plan = S.planLineups(entries, byId([
    ['seed_bonnaroo-2027', UPCOMING],
    ['tm', { ...UPCOMING, lineup: ['Goose', 'Somebody'], lineupSource: 'ticketmaster' }],
    ['same', { ...UPCOMING, lineup: ['Goose'], lineupSource: 'seed', lineupUrl: URL }],
  ]), { today: TODAY });
  assert.deepStrictEqual(plan.counts, { set: 1, replace: 1, unchanged: 1, missing: 1, failed: 2 });
  assert.deepStrictEqual(plan.set[0].write, { lineup: ['Goose', 'Phish'], lineupSource: 'seed', lineupUrl: URL });
  assert.strictEqual(plan.replace[0].currentSource, 'ticketmaster');
  assert.strictEqual(plan.replace[0].added, 1);
  assert.strictEqual(plan.replace[0].removed, 1);
  assert.strictEqual(plan.replace[0].write.lineupUrl, null);
});

test('a changed link alone is a replace, not unchanged', () => {
  const plan = S.planLineups([{ festivalId: 'f', artists: ['Goose'], sourceUrl: URL }],
    byId([['f', { ...UPCOMING, lineup: ['Goose'], lineupSource: 'seed', lineupUrl: null }]]), { today: TODAY });
  assert.strictEqual(plan.counts.replace, 1);
});

test('a reordered lineup is a replace', () => {
  const plan = S.planLineups([{ festivalId: 'f', artists: ['Phish', 'Goose'] }],
    byId([['f', { ...UPCOMING, lineup: ['Goose', 'Phish'], lineupSource: 'seed', lineupUrl: null }]]), { today: TODAY });
  assert.strictEqual(plan.counts.replace, 1);
});

test('an entry for a festival that is over is still planned, and marked past', () => {
  const plan = S.planLineups([{ festivalId: 'p', artists: ['Goose'] }], byId([['p', PAST]]), { today: TODAY });
  assert.strictEqual(plan.counts.set, 1);
  assert.strictEqual(plan.set[0].past, true);
  assert.match(S.formatLineupReport(plan), /1 of the lineups to write are for festivals that are already over/);
});

test('the report has a table for every action', () => {
  const plan = S.planLineups([{ seedKey: 'bonnaroo-2027', artists: ['Goose'] }], byId([['seed_bonnaroo-2027', UPCOMING]]), { today: TODAY });
  const report = S.formatLineupReport(plan, { entryCount: 1 });
  for (const heading of ['SET (1)', 'REPLACE (0)', 'UNCHANGED (0)', 'MISSING (0)', 'FAILED (0)']) {
    assert.ok(report.includes(heading), heading);
  }
  assert.ok(report.includes('seed_bonnaroo-2027'));
});

test('lineupDocIds lists each usable entry\'s document once', () => {
  assert.deepStrictEqual(S.lineupDocIds([
    { seedKey: 'a', artists: ['x'] }, { seedKey: 'a', artists: ['y'] }, { artists: ['z'] }, { festivalId: 'b', artists: ['x'] },
  ]), ['seed_a', 'b']);
});

// ── The function ──────────────────────────────────────────────────────────

const ENTRIES = [
  { seedKey: 'bonnaroo-2027', artists: ['Goose', 'Phish'], sourceUrl: URL },
  { festivalId: 'tm', artists: ['Billy Strings'] },
];

function setup() {
  const db = createFakeDb();
  const auth = createFakeAuth({ tokens: {
    admin: { uid: 'admin', email: 'phillip.leonard@gmail.com', email_verified: true },
    bob: { uid: 'bob', email: 'bob@example.com' },
  } });
  __setTestFirebase({ db, auth });
  db._put('festivals/seed_bonnaroo-2027', UPCOMING);
  db._put('festivals/tm', { ...UPCOMING, seedKey: undefined, lineup: ['Goose'], lineupSource: 'ticketmaster', lineupUrl: 'https://www.ticketmaster.com/event/abc' });
  const ev = (token, body = {}) => ({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const opts = { db, entries: ENTRIES, now: () => new Date(`${TODAY}T12:00:00Z`) };
  return { db, ev, opts };
}

test('only the admin can run it', async () => {
  const s = setup();
  assert.strictEqual((await handle({ ...s.ev('x'), headers: {} }, s.opts)).statusCode, 401);
  assert.strictEqual((await handle(s.ev('bob'), s.opts)).statusCode, 403);
  assert.strictEqual((await handle(s.ev('admin'), s.opts)).statusCode, 200);
});

test('a dry run writes nothing', async () => {
  const s = setup();
  const before = s.db._writes.length;
  for (const body of [{}, { commit: 'true' }, { commit: 1 }, { comit: true }]) {
    const res = JSON.parse((await handle(s.ev('admin', body), s.opts)).body);
    assert.strictEqual(res.dryRun, true, JSON.stringify(body));
    assert.deepStrictEqual(res.counts, { set: 1, replace: 1, unchanged: 0, missing: 0, failed: 0 });
  }
  assert.strictEqual(s.db._writes.length, before);
});

test('a write sets only the four lineup fields, and a second write changes nothing', async () => {
  const s = setup();
  const res = JSON.parse((await handle(s.ev('admin', { commit: true }), s.opts)).body);
  assert.strictEqual(res.dryRun, false);
  assert.deepStrictEqual(res.written, { written: 2, failed: [] });

  const bonnaroo = s.db._get('festivals/seed_bonnaroo-2027');
  assert.deepStrictEqual(bonnaroo.lineup, ['Goose', 'Phish']);
  assert.strictEqual(bonnaroo.lineupSource, 'seed');
  assert.strictEqual(bonnaroo.lineupUrl, URL);
  assert.ok(bonnaroo.lineupFetchedAt);
  for (const k of Object.keys(UPCOMING)) {
    assert.deepStrictEqual(bonnaroo[k], UPCOMING[k], `${k} must not change`);
  }
  const tm = s.db._get('festivals/tm');
  assert.deepStrictEqual(tm.lineup, ['Billy Strings']);
  assert.strictEqual(tm.lineupSource, 'seed');
  assert.strictEqual(tm.lineupUrl, null, 'the Ticketmaster link goes with the Ticketmaster lineup');

  const before = s.db._writes.length;
  const again = JSON.parse((await handle(s.ev('admin', { commit: true }), s.opts)).body);
  assert.deepStrictEqual(again.counts, { set: 0, replace: 0, unchanged: 2, missing: 0, failed: 0 });
  assert.strictEqual(s.db._writes.length, before);
});

test('a festival deleted between the read and the write is reported, never recreated', async () => {
  const s = setup();
  const { writeLineups } = require('../../netlify/functions/admin-seed-festival-lineups');
  const rows = [
    { docId: 'seed_bonnaroo-2027', label: 'bonnaroo-2027', write: { lineup: ['Goose'], lineupSource: 'seed', lineupUrl: null } },
    { docId: 'gone', label: 'gone', write: { lineup: ['Goose'], lineupSource: 'seed', lineupUrl: null } },
  ];
  const result = await writeLineups(s.db, rows, () => new Date());
  assert.strictEqual(result.written, 1);
  assert.strictEqual(result.failed.length, 1);
  assert.strictEqual(result.failed[0].docId, 'gone');
  assert.strictEqual(s.db._get('festivals/gone'), undefined);
});

run('festival lineup seed');
