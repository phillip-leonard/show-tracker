/**
 * Stage 6, Part 2c (5.60.41), against an in-memory Firestore:
 *   - year-recap (call D): the stored recap or one computed from the
 *     caller's shows, the rarity loaded per archive band, the show buddy
 *     from the caller's accepted tags and friends, blocked people left out;
 *     accounts only; the daily count
 *   - my-poster's `record` and `artist` (call G): the record built from the
 *     caller's stored shows with lib/myPoster.js, eligibility, the image and
 *     the share drawn from it; the old `record` body still works
 *
 *   node tests/security/yearRecapPoster.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const Module = require('module');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');

let db;
let auth;
let blobs;
const fakeModules = {
  'firebase-admin/app': { getApps: () => [{}], initializeApp: () => ({}), cert: () => ({}) },
  'firebase-admin/auth': { getAuth: () => auth },
  'firebase-admin/firestore': { getFirestore: () => db, FieldValue: { serverTimestamp: () => new Date() } },
  '@netlify/blobs': {
    connectLambda: () => {},
    getStore: () => ({
      get: async (k) => (blobs.has(k) ? blobs.get(k) : null),
      set: async (k, v) => { blobs.set(k, v); },
      setJSON: async (k, v) => { blobs.set(k, JSON.stringify(v)); },
      getWithMetadata: async (k) => (blobs.has(k) ? { data: blobs.get(k), metadata: {} } : null),
    }),
  },
};
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (fakeModules[request]) return fakeModules[request];
  return realLoad.call(this, request, parent, isMain);
};

const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const yearRecap = require('../../netlify/functions/year-recap');
const myPoster = require('../../netlify/functions/my-poster');
const { buildMyPoster } = require('../../lib/myPoster');

const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com', name: 'Alice' };
const BOB = { uid: 'bobUid00000001', email: 'bob@example.com', name: 'Bob Builder' };
const CAROL = { uid: 'carolUid000001', email: 'carol@example.com', name: 'Carol' };
const GUEST = { uid: 'guestUid000001', firebase: { sign_in_provider: 'anonymous' } };

const show = (artist, date, venue, songs = []) => ({
  artist, date, venue, city: 'City', setlist: songs.map((name, i) => ({ id: `s${i}`, name, set: 'Set I' })),
});

let archiveCalls;
function setup() {
  db = createFakeDb();
  auth = createFakeAuth({
    tokens: { alice: ALICE, bob: BOB, guest: GUEST },
    users: [ALICE, BOB, CAROL, { uid: GUEST.uid, providerData: [] }],
  });
  __setTestFirebase({ db, auth });
  blobs = new Map();
  archiveCalls = [];
  yearRecap.__setTestDeps({ loadArchive: async (slug) => { archiveCalls.push(slug); return null; } });
  for (const u of [ALICE, BOB, CAROL]) db._put(`userProfiles/${u.uid}`, { displayName: u.name });
  // Alice and Bob, Alice and Carol are friends; Alice blocked Carol since.
  for (const [a, b] of [[ALICE, BOB], [ALICE, CAROL]]) {
    db._put(`users/${a.uid}/friends/${b.uid}`, { friendUid: b.uid, friendName: b.name });
    db._put(`users/${b.uid}/friends/${a.uid}`, { friendUid: a.uid, friendName: a.name });
  }
  db._put(`userBlocks/${ALICE.uid}`, { userId: ALICE.uid, blockedUserIds: [CAROL.uid] });
  // 2026: two Goose nights Bob was tagged at (accepted), one Carol tagged Alice at, twice.
  db._put(`users/${ALICE.uid}/shows/g1`, { ...show('Goose', '2026-06-01', 'Forest Hills Stadium', ['Arcadia', 'Hungersite']), taggedFriendUids: [BOB.uid] });
  db._put(`users/${ALICE.uid}/shows/g2`, { ...show('Goose', '2026-06-02', 'Forest Hills Stadium', ['Arcadia', 'Tumble']), taggedFriendUids: [BOB.uid], taggedByUid: CAROL.uid });
  db._put(`users/${ALICE.uid}/shows/g3`, { ...show('Goose', '2026-07-31', 'Red Rocks Amphitheatre'), taggedByUid: CAROL.uid });
  db._put(`users/${ALICE.uid}/shows/p1`, show('Phish', '2025-12-31', 'Madison Square Garden', ['Tweezer']));
  for (const [id, date, venue] of [['t1', '2026-06-01', 'Forest Hills Stadium'], ['t2', '2026-06-02', 'Forest Hills Stadium']]) {
    db._put(`showTags/${id}`, { fromUid: ALICE.uid, toUid: BOB.uid, status: 'accepted', showData: { artist: 'Goose', date, venue } });
  }
}

const call = (handler) => (token, body) => handler({
  httpMethod: 'POST',
  headers: token ? { authorization: `Bearer ${token}`, origin: 'https://mysetlists.net' } : { origin: 'https://mysetlists.net' },
  body: JSON.stringify(body),
});
const callRecap = call(yearRecap.handler);
const callPoster = call(myPoster.handler);
const json = (res) => JSON.parse(res.body);

// ── year-recap ────────────────────────────────────────────────────────

test('year-recap: computed recap, the buddy from accepted tags, no blocked friend', async () => {
  setup();
  const res = await callRecap('alice', { year: 2026 });
  assert.strictEqual(res.statusCode, 200, res.body);
  const r = json(res);
  assert.strictEqual(r.year, 2026);
  assert.strictEqual(r.recap.totalShows, 3, 'computed from the stored shows: no review document');
  assert.strictEqual(r.recap.topBands[0].name, 'Goose');
  // Carol was at more shows (two) by her own tags, but she's blocked.
  assert.deepStrictEqual(r.buddy, { uid: BOB.uid, name: 'Bob Builder', firstName: 'Bob', shows: 2 });
  assert.deepStrictEqual(r.rarity, { rarest: null, bustOuts: [] }, 'an archive that can\'t be loaded is left out');
  assert.deepStrictEqual(archiveCalls, ['goose'], 'one load per archive band seen that year');
});

test('year-recap: the stored recap wins; a year with no shows has none', async () => {
  setup();
  db._put(`yearInReviews/${ALICE.uid}_2026`, { recap: { year: 2026, totalShows: 99 } });
  assert.strictEqual(json(await callRecap('alice', { year: 2026 })).recap.totalShows, 99);
  archiveCalls.length = 0;
  const empty = json(await callRecap('alice', { year: 2019 }));
  assert.deepStrictEqual(empty, { year: 2019, recap: null, rarity: { rarest: null, bustOuts: [] }, buddy: null });
  assert.deepStrictEqual(archiveCalls, [], 'nothing loaded for a year with no shows');
});

test('year-recap: rarity comes from the loaded archive', async () => {
  setup();
  const loaded = [];
  yearRecap.__setTestDeps({ loadArchive: async (slug) => { loaded.push(slug); return { ok: true, shows: [] }; } });
  const r = json(await callRecap('alice', { year: 2026 }));
  assert.deepStrictEqual(loaded, ['goose']);
  assert.deepStrictEqual(r.rarity, { rarest: null, bustOuts: [] }, 'no archive show matched: nothing to say');
});

test('year-recap: accounts only, a real year, and a daily count', async () => {
  setup();
  assert.strictEqual((await callRecap(null, { year: 2026 })).statusCode, 401);
  const guest = await callRecap('guest', { year: 2026 });
  assert.strictEqual(guest.statusCode, 403);
  assert.strictEqual(json(guest).code, 'account_required');
  assert.strictEqual((await callRecap('alice', { year: 'last' })).statusCode, 400);
  for (let i = 1; i < yearRecap.PER_DAY; i++) await callRecap('alice', { year: 2019 });
  assert.strictEqual((await callRecap('alice', { year: 2019 })).statusCode, 200, 'the last one allowed');
  const over = await callRecap('alice', { year: 2019 });
  assert.strictEqual(over.statusCode, 429);
});

// ── my-poster record and artist ───────────────────────────────────────

test('my-poster record: built from the caller\'s stored shows, as lib/myPoster.js builds it', async () => {
  setup();
  const res = await callPoster('alice', { action: 'record', artist: 'goose' });
  assert.strictEqual(res.statusCode, 200, res.body);
  const r = json(res);
  assert.strictEqual(r.eligible, true, 'two shows with a setlist');
  assert.strictEqual(r.name, 'Goose');
  assert.strictEqual(r.shows, 3);
  assert.deepStrictEqual(r.noSetlist, [{ id: 'g3', date: '2026-07-31', venue: 'Red Rocks Amphitheatre', city: 'City' }]);
  assert.strictEqual(r.archive && r.archive.slug, 'goose');
  const direct = buildMyPoster([
    { id: 'g1', ...show('Goose', '2026-06-01', 'Forest Hills Stadium', ['Arcadia', 'Hungersite']) },
    { id: 'g2', ...show('Goose', '2026-06-02', 'Forest Hills Stadium', ['Arcadia', 'Tumble']) },
    { id: 'g3', ...show('Goose', '2026-07-31', 'Red Rocks Amphitheatre') },
  ], 'Goose').record;
  assert.deepStrictEqual(r.record, direct, 'the same record the web page builds');
  const arcadia = r.record.songs.find((s) => s.name === 'Arcadia');
  assert.strictEqual(arcadia.count, 2);
});

test('my-poster record: one show with a setlist isn\'t enough to draw or share by artist', async () => {
  setup();
  const r = json(await callPoster('alice', { action: 'record', artist: 'Phish' }));
  assert.strictEqual(r.eligible, false);
  const image = await callPoster('alice', { action: 'image', kind: 'feed', artist: 'Phish' });
  assert.strictEqual(image.statusCode, 400);
  assert.strictEqual(json(image).error, 'not_eligible');
  const none = json(await callPoster('alice', { action: 'record', artist: 'Nobody' }));
  assert.strictEqual(none.record, null);
  assert.strictEqual(none.eligible, false);
});

test('my-poster artist: the image and the share are drawn from the stored shows', async () => {
  setup();
  const image = await callPoster('alice', { action: 'image', kind: 'story', artist: 'Goose' });
  assert.strictEqual(image.statusCode, 200, image.body);
  assert.strictEqual(image.headers['Content-Type'], 'image/png');
  assert.ok(Buffer.from(image.body, 'base64').subarray(1, 4).toString() === 'PNG');
  const share = await callPoster('alice', { action: 'share', artist: 'Goose' });
  assert.strictEqual(share.statusCode, 200, share.body);
  const s = json(share);
  assert.ok(s.ok && /^https:\/\/mysetlists\.net\/p\/[A-Za-z0-9_-]+\/?$/.test(s.url), s.url);
  assert.ok([...blobs.values()].some((v) => String(v).includes('Goose')), 'the record stored for /p/');
});

test('my-poster: the old record body still works; record needs an artist; guests can\'t share', async () => {
  setup();
  const record = buildMyPoster([
    { id: 'a', ...show('Goose', '2026-06-01', 'X', ['Arcadia']) },
    { id: 'b', ...show('Goose', '2026-06-02', 'Y', ['Arcadia']) },
  ], 'Goose').record;
  assert.strictEqual((await callPoster('alice', { action: 'image', kind: 'feed', record })).statusCode, 200);
  assert.strictEqual((await callPoster('alice', { action: 'record' })).statusCode, 400);
  assert.strictEqual((await callPoster('guest', { action: 'share', artist: 'Goose' })).statusCode, 403);
  assert.strictEqual((await callPoster(null, { action: 'record', artist: 'Goose' })).statusCode, 401);
});

run('year-recap and my-poster');
