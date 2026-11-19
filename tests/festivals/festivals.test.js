/**
 * netlify/functions/festivals.js (5.60.36, Stage 5 Part 2): create, join,
 * leave and update, against the in-memory Firestore. Who may, what each
 * writes, that the shared festival is never deleted, and that no client
 * code writes the canonical festival or joins, creates or leaves one
 * itself any more.
 *
 *   node tests/festivals/festivals.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const festivals = require('../../netlify/functions/festivals');
const { CREATES_PER_DAY } = require('../../netlify/functions/lib/festivalActions');

const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com' };
const BOB = { uid: 'bobUid00000001', email: 'bob@example.com' };
const ADMIN = { uid: 'adminUid000001', email: 'admin@example.com', admin: true };
const GUEST = { uid: 'guestUid000001', firebase: { sign_in_provider: 'anonymous' } };

let db;
function setup() {
  db = createFakeDb();
  __setTestFirebase({ db, auth: createFakeAuth({ tokens: { alice: ALICE, bob: BOB, admin: ADMIN, guest: GUEST }, users: [ALICE, BOB, ADMIN] }) });
  db._put('festivals/bon25', {
    name: 'Bonnaroo', nameNormalized: 'bonnaroo', startDate: '2025-06-12', endDate: '2025-06-15', year: 2025,
    location: 'Manchester, TN', edition: '', createdBy: ALICE.uid, lineup: ['Goose'], lineupSource: 'ticketmaster', lineupUrl: 'https://tm.example',
  });
  db._put('festivals/seeded', {
    name: 'Hardly Strictly', nameNormalized: 'hardly strictly', startDate: '2025-10-03', endDate: '2025-10-05',
    location: 'San Francisco', createdBy: 'system:seed', source: 'seed', status: 'cut_short', notes: 'Rain.',
  });
  db._put(`users/${ALICE.uid}/festivals/aliceBon`, { festivalId: 'bon25', notes: 'muddy', rating: null, myLineup: ['Goose', 'Phish'] });
}

const call = (token, body) => festivals.handler({
  httpMethod: 'POST',
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: 'https://mysetlists.net' },
  body: JSON.stringify(body),
});
const json = (res) => JSON.parse(res.body);

// ── Who may ──────────────────────────────────────────────────────────

test('signed in, accounts only, known actions only', async () => {
  setup();
  assert.strictEqual((await call(null, { action: 'join', festivalId: 'bon25', attendanceId: 'aaaaaa1' })).statusCode, 401);
  const guest = await call('guest', { action: 'create', attendanceId: 'guestFest1', name: 'Mine', year: 2025 });
  assert.strictEqual(guest.statusCode, 403);
  assert.strictEqual(json(guest).code, 'account_required');
  assert.strictEqual(db._list(`users/${GUEST.uid}/festivals`).length, 0);
  assert.strictEqual((await call('alice', { action: 'delete', attendanceId: 'aliceBon' })).statusCode, 400);
});

// ── create ───────────────────────────────────────────────────────────

test('create: the shared festival and the record, together; answers the joined festival', async () => {
  setup();
  const res = await call('bob', {
    action: 'create', attendanceId: 'bobFest0001', name: '  The Big Fest 2026 ', startDate: '2026-07-10', endDate: '2026-07-12',
    location: ' Austin, TX ', notes: ' first one ',
  });
  assert.strictEqual(res.statusCode, 200, res.body);
  const { festival, already } = json(res);
  assert.strictEqual(already, false);
  const record = db._get(`users/${BOB.uid}/festivals/bobFest0001`);
  assert.strictEqual(record.notes, 'first one');
  const canonical = db._get(`festivals/${record.festivalId}`);
  assert.strictEqual(canonical.name, 'The Big Fest 2026');
  assert.strictEqual(canonical.nameNormalized, 'big fest');
  assert.strictEqual(canonical.createdBy, BOB.uid);
  assert.deepStrictEqual([canonical.startDate, canonical.endDate, canonical.year], ['2026-07-10', '2026-07-12', 2026]);
  assert.strictEqual(canonical.location, 'Austin, TX');
  assert.deepStrictEqual(festival, {
    id: 'bobFest0001', festivalId: record.festivalId, name: 'The Big Fest 2026', startDate: '2026-07-10', endDate: '2026-07-12', year: 2026,
    location: 'Austin, TX', edition: '', isCreator: true, isSeeded: false, catalogStatus: null, catalogNote: null,
    notes: 'first one', rating: null, myLineup: [], lineup: [], lineupSource: null, lineupUrl: null,
  });
});

test('create: year only writes no date fields', async () => {
  setup();
  const res = json(await call('bob', { action: 'create', attendanceId: 'bobFest0002', name: 'Outside Lands', year: 2019 }));
  const canonical = db._get(`festivals/${res.festival.festivalId}`);
  assert.strictEqual(canonical.year, 2019);
  assert.ok(!('startDate' in canonical) && !('endDate' in canonical));
  assert.ok(!('startDate' in res.festival));
});

test('create: a retry with the same attendance id makes nothing new', async () => {
  setup();
  const body = { action: 'create', attendanceId: 'bobFest0003', name: 'Retry Fest', year: 2024 };
  const first = json(await call('bob', body));
  const again = json(await call('bob', body));
  assert.strictEqual(again.already, true);
  assert.strictEqual(again.festival.festivalId, first.festival.festivalId);
  assert.strictEqual(db._list('festivals').filter((f) => f.name === 'Retry Fest').length, 1);
});

test('create: bad names, dates and ids are refused, naming the field, and write nothing', async () => {
  setup();
  const before = db._list('festivals').length;
  const cases = [
    [{ name: '', year: 2025 }, 'name'],
    [{ name: 'x'.repeat(121), year: 2025 }, 'name'],
    [{ name: 'Fest' }, 'dates'],
    [{ name: 'Fest', year: 1850 }, 'dates'],
    [{ name: 'Fest', startDate: '2025-06-15', endDate: '2025-06-12' }, 'dates'],
    [{ name: 'Fest', startDate: '15-06-2025' }, 'dates'],
  ];
  for (const [fields, field] of cases) {
    const res = await call('bob', { action: 'create', attendanceId: 'bobFestBad1', ...fields });
    assert.strictEqual(res.statusCode, 400, JSON.stringify(fields));
    assert.strictEqual(json(res).field, field, JSON.stringify(fields));
  }
  assert.strictEqual((await call('bob', { action: 'create', attendanceId: 'a/b', name: 'Fest', year: 2025 })).statusCode, 400);
  assert.strictEqual(db._list('festivals').length, before);
  assert.strictEqual(db._list(`users/${BOB.uid}/festivals`).length, 0);
});

test('create: someone else’s id already on the caller’s record is a conflict', async () => {
  setup();
  db._put(`users/${BOB.uid}/festivals/bobJoined1`, { festivalId: 'bon25', notes: '' });
  const res = await call('bob', { action: 'create', attendanceId: 'bobJoined1', name: 'Other', year: 2025 });
  assert.strictEqual(res.statusCode, 409);
});

test(`create: at most ${CREATES_PER_DAY} a day`, async () => {
  setup();
  for (let i = 0; i < CREATES_PER_DAY; i++) {
    assert.strictEqual((await call('bob', { action: 'create', attendanceId: `bobQuota${i}0`, name: `Fest ${i}`, year: 2025 })).statusCode, 200);
  }
  assert.strictEqual((await call('bob', { action: 'create', attendanceId: 'bobQuotaOver', name: 'One more', year: 2025 })).statusCode, 429);
});

// ── join ─────────────────────────────────────────────────────────────

test('join: writes only the caller’s record; the shared festival is untouched', async () => {
  setup();
  const before = db._get('festivals/bon25');
  const res = await call('bob', { action: 'join', festivalId: 'bon25', attendanceId: 'bobBon0001' });
  assert.strictEqual(res.statusCode, 200, res.body);
  const { festival, already } = json(res);
  assert.strictEqual(already, false);
  assert.strictEqual(festival.isCreator, false);
  assert.strictEqual(festival.name, 'Bonnaroo');
  assert.deepStrictEqual(festival.lineup, ['Goose']);
  assert.strictEqual(festival.notes, '');
  assert.deepStrictEqual(db._get(`users/${BOB.uid}/festivals/bobBon0001`).festivalId, 'bon25');
  assert.deepStrictEqual(db._get('festivals/bon25'), before);
});

test('join: twice answers the first record; an unknown festival is 404', async () => {
  setup();
  await call('bob', { action: 'join', festivalId: 'bon25', attendanceId: 'bobBon0001' });
  const again = json(await call('bob', { action: 'join', festivalId: 'bon25', attendanceId: 'bobBon0002' }));
  assert.strictEqual(again.already, true);
  assert.strictEqual(again.festival.id, 'bobBon0001');
  assert.strictEqual(db._list(`users/${BOB.uid}/festivals`).length, 1);
  assert.strictEqual((await call('bob', { action: 'join', festivalId: 'nopeFest', attendanceId: 'bobBon0003' })).statusCode, 404);
});

test('join: a catalog festival carries its catalog fields', async () => {
  setup();
  const { festival } = json(await call('bob', { action: 'join', festivalId: 'seeded', attendanceId: 'bobSeed001' }));
  assert.strictEqual(festival.isSeeded, true);
  assert.strictEqual(festival.catalogStatus, 'cut_short');
  assert.strictEqual(festival.catalogNote, 'Rain.');
});

// ── leave ────────────────────────────────────────────────────────────

test('leave: every attached show is kept and detached, the record goes, the festival stays (even for its creator)', async () => {
  setup();
  db._put(`users/${ALICE.uid}/shows/s1`, { artist: 'Goose', date: '2025-06-13', festivalId: 'aliceBon', rating: 9 });
  db._put(`users/${ALICE.uid}/shows/s2`, { artist: 'Phish', date: '2025-06-14', festivalId: 'aliceBon' });
  db._put(`users/${ALICE.uid}/shows/s3`, { artist: 'Other', date: '2025-01-01', festivalId: 'elsewhere' });
  db._put(`users/${BOB.uid}/festivals/bobBon0001`, { festivalId: 'bon25', notes: 'bob' });
  db._put(`users/${BOB.uid}/shows/b1`, { artist: 'Goose', date: '2025-06-13', festivalId: 'aliceBon' });
  const res = await call('alice', { action: 'leave', attendanceId: 'aliceBon' });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.strictEqual(json(res).detached, 2);
  assert.strictEqual(db._get(`users/${ALICE.uid}/shows/s1`).festivalId, null);
  assert.strictEqual(db._get(`users/${ALICE.uid}/shows/s1`).rating, 9, 'nothing else on the show changes');
  assert.strictEqual(db._get(`users/${ALICE.uid}/shows/s2`).festivalId, null);
  assert.strictEqual(db._get(`users/${ALICE.uid}/shows/s3`).festivalId, 'elsewhere');
  assert.strictEqual(db._get(`users/${ALICE.uid}/festivals/aliceBon`), undefined);
  assert.ok(db._get('festivals/bon25'), 'the shared festival stays');
  assert.ok(db._get(`users/${BOB.uid}/festivals/bobBon0001`), 'nobody else’s record is touched');
  assert.strictEqual(db._get(`users/${BOB.uid}/shows/b1`).festivalId, 'aliceBon', 'nobody else’s shows are touched');
});

test('leave: again is harmless', async () => {
  setup();
  await call('alice', { action: 'leave', attendanceId: 'aliceBon' });
  const res = await call('alice', { action: 'leave', attendanceId: 'aliceBon' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(json(res).detached, 0);
});

// ── update ───────────────────────────────────────────────────────────

test('update: the creator changes the details; joiners see it; lineup and creator carried over', async () => {
  setup();
  db._put(`users/${BOB.uid}/festivals/bobBon0001`, { festivalId: 'bon25', notes: 'bob' });
  const res = await call('alice', { action: 'update', attendanceId: 'aliceBon', name: 'Bonnaroo Music & Arts', location: 'Manchester, Tennessee' });
  assert.strictEqual(res.statusCode, 200, res.body);
  const canonical = db._get('festivals/bon25');
  assert.strictEqual(canonical.name, 'Bonnaroo Music & Arts');
  assert.strictEqual(canonical.nameNormalized, 'bonnaroo music and arts');
  assert.strictEqual(canonical.location, 'Manchester, Tennessee');
  assert.deepStrictEqual(canonical.lineup, ['Goose']);
  assert.strictEqual(canonical.createdBy, ALICE.uid);
  assert.strictEqual(json(res).festival.notes, 'muddy', 'the caller’s own notes come back with it');
  const bobs = json(await call('bob', { action: 'join', festivalId: 'bon25', attendanceId: 'whatever01' })).festival;
  assert.strictEqual(bobs.name, 'Bonnaroo Music & Arts');
});

test('update: dates to year only drops both dates, and back', async () => {
  setup();
  await call('alice', { action: 'update', attendanceId: 'aliceBon', startDate: '', endDate: '', year: 2025 });
  let c = db._get('festivals/bon25');
  assert.ok(!('startDate' in c) && !('endDate' in c));
  assert.strictEqual(c.year, 2025);
  await call('alice', { action: 'update', attendanceId: 'aliceBon', startDate: '2025-06-12', endDate: '2025-06-15' });
  c = db._get('festivals/bon25');
  assert.deepStrictEqual([c.startDate, c.endDate, c.year], ['2025-06-12', '2025-06-15', 2025]);
});

test('update: not the creator, or a catalog festival, is refused; the admin may', async () => {
  setup();
  db._put(`users/${BOB.uid}/festivals/bobBon0001`, { festivalId: 'bon25' });
  db._put(`users/${BOB.uid}/festivals/bobSeed001`, { festivalId: 'seeded' });
  db._put(`users/${ADMIN.uid}/festivals/admSeed001`, { festivalId: 'seeded' });
  const notMine = await call('bob', { action: 'update', attendanceId: 'bobBon0001', name: 'Hijacked' });
  assert.strictEqual(notMine.statusCode, 403);
  assert.match(json(notMine).error, /Only the person who created/);
  const seeded = await call('bob', { action: 'update', attendanceId: 'bobSeed001', name: 'Hijacked' });
  assert.strictEqual(seeded.statusCode, 403);
  assert.match(json(seeded).error, /catalog/);
  assert.strictEqual(db._get('festivals/bon25').name, 'Bonnaroo');
  const admin = await call('admin', { action: 'update', attendanceId: 'admSeed001', location: 'Golden Gate Park' });
  assert.strictEqual(admin.statusCode, 200, admin.body);
  assert.strictEqual(db._get('festivals/seeded').location, 'Golden Gate Park');
  assert.strictEqual(db._get('festivals/seeded').source, 'seed');
});

test('update: a record from before 5.30.0 is edited in place; no shared festival is made', async () => {
  setup();
  db._put(`users/${BOB.uid}/festivals/oldOne001`, { name: 'Old Fest', startDate: '2019-06-01', endDate: '2019-06-02', notes: 'kept' });
  const before = db._list('festivals').length;
  const res = json(await call('bob', { action: 'update', attendanceId: 'oldOne001', name: 'Old Fest Renamed' }));
  assert.strictEqual(res.festival.unmigrated, true);
  assert.strictEqual(db._get(`users/${BOB.uid}/festivals/oldOne001`).name, 'Old Fest Renamed');
  assert.strictEqual(db._get(`users/${BOB.uid}/festivals/oldOne001`).notes, 'kept');
  assert.strictEqual(db._list('festivals').length, before);
});

// ── No client writes ─────────────────────────────────────────────────

test('no client code writes the shared festival, or creates, joins or leaves one itself', () => {
  const root = path.join(__dirname, '..', '..');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(rel); } else if (/\.(js|jsx|mjs)$/.test(e.name)) files.push(rel);
    }
  };
  ['app', 'components', 'context', 'hooks', 'lib'].forEach(walk);
  const offenders = files.filter((f) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    return /collection\(\s*db\s*,\s*['"]festivals['"]\s*\)/.test(src)
      || /doc\(\s*db\s*,\s*['"]festivals['"]\s*,[^)]*\)\s*,/.test(src)
      || /(setDoc|deleteDoc)\(\s*doc\(\s*db\s*,\s*['"]users['"][^)]*['"]festivals['"]/.test(src)
      || /(setDoc|deleteDoc)\([^)]*attendanceRef/.test(src);
  });
  assert.deepStrictEqual(offenders, []);
});

run();
