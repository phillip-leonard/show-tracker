/**
 * Festival matching on the server (5.60.8, pre-native server moves Part
 * 3): match-festivals (the create form's "is this one of these?") and the
 * festival suggestion normalize-show returns for a new show, against the
 * in-memory Firestore. The rule itself is lib/__tests__/festivalMatch.test.js.
 *
 *   node tests/festivals/matchFestivals.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestDeps } = require('../../netlify/functions/lib/normalizeShowServer');
const { festivalsForShow } = require('../../lib/festivalMatch');
const matchFestivals = require('../../netlify/functions/match-festivals');
const normalizeShow = require('../../netlify/functions/normalize-show');

const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com' };

let db;
function setup() {
  db = createFakeDb();
  __setTestFirebase({ db, auth: createFakeAuth({ tokens: { 'alice-token': ALICE }, users: [ALICE] }) });
  __setTestDeps(() => ({ bandSetlist: async () => ({ ok: false, songs: [], shows: [] }), setlistfmSetlist: async () => null }));
  const fest = (id, data) => db._put(`festivals/${id}`, data);
  fest('bon25', { name: 'Bonnaroo Music & Arts Festival', nameNormalized: 'bonnaroo music and arts festival', startDate: '2025-06-12', endDate: '2025-06-15', location: 'Manchester, TN', lineup: ['Goose', 'Tyler Childers'], source: 'seed', createdBy: 'system' });
  fest('bon26', { name: 'Bonnaroo', nameNormalized: 'bonnaroo', startDate: '2026-06-11', endDate: '2026-06-14', location: 'Manchester, TN', createdBy: 'someone' });
  fest('roo', { name: 'The Roo Fest', nameNormalized: 'roo fest', startDate: '2025-06-13', endDate: '2025-06-14', location: 'Nashville, TN', createdBy: 'someone' });
  fest('coach', { name: 'Coachella', nameNormalized: 'coachella', startDate: '2025-06-12', endDate: '2025-06-15', location: 'Indio, CA', createdBy: 'someone' });
  fest('ol25', { name: 'Outside Lands', nameNormalized: 'outside lands', year: 2025, location: 'San Francisco', createdBy: 'someone' });
}

const post = (fn, token, body) => fn.handler({
  httpMethod: 'POST',
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: 'https://mysetlists.net' },
  body: JSON.stringify(body),
});
const json = (res) => JSON.parse(res.body);

// ── match-festivals ───────────────────────────────────────────────────

test('signed in only', async () => {
  setup();
  assert.strictEqual((await post(matchFestivals, null, { name: 'Bonnaroo', startDate: '2025-06-12' })).statusCode, 401);
});

test('the same edition matches, by name prefix; another year’s never does', async () => {
  setup();
  const res = json(await post(matchFestivals, 'alice-token', { name: 'Bonnaroo', startDate: '2025-06-12', endDate: '2025-06-15', location: 'Manchester' }));
  assert.deepStrictEqual(res.matches.map((m) => m.festival.id), ['bon25']);
  const [m] = res.matches;
  assert.strictEqual(m.sameLocation, true);
  assert.ok(m.similarity > 0);
  // The fields the form and joinFestival read, and nothing else.
  assert.deepStrictEqual(Object.keys(m.festival).sort(), ['createdBy', 'endDate', 'id', 'location', 'name', 'source', 'startDate']);
});

test('a festival the user already joined is not offered', async () => {
  setup();
  db._put(`users/${ALICE.uid}/festivals/att1`, { festivalId: 'bon25' });
  const res = json(await post(matchFestivals, 'alice-token', { name: 'Bonnaroo', startDate: '2025-06-12' }));
  assert.deepStrictEqual(res.matches, []);
});

test('a year-only draft matches by name within its year', async () => {
  setup();
  const res = json(await post(matchFestivals, 'alice-token', { name: 'Outside Lands', year: 2025 }));
  assert.deepStrictEqual(res.matches.map((m) => m.festival.id), ['ol25']);
  assert.deepStrictEqual(json(await post(matchFestivals, 'alice-token', { name: 'Outside Lands', year: 2024 })).matches, []);
});

test('no name, or neither dates nor year: no lookup, no matches', async () => {
  setup();
  assert.deepStrictEqual(json(await post(matchFestivals, 'alice-token', { name: '', startDate: '2025-06-12' })).matches, []);
  assert.deepStrictEqual(json(await post(matchFestivals, 'alice-token', { name: 'Bonnaroo' })).matches, []);
});

// ── The festival a show may belong to ─────────────────────────────────

test('festivalsForShow: inside the dates, and on the lineup or in the city; lineup first', () => {
  const cat = [
    { id: 'city', name: 'Local Fest', startDate: '2025-06-12', endDate: '2025-06-15', location: 'Manchester, TN' },
    { id: 'lineup', name: 'Big Fest', startDate: '2025-06-12', endDate: '2025-06-15', location: 'Elsewhere', lineup: ['Goose'] },
    { id: 'other', name: 'Other Fest', startDate: '2025-06-12', endDate: '2025-06-15', location: 'Indio, CA' },
    { id: 'yearonly', name: 'Year Fest', year: 2025, location: 'Manchester' },
  ];
  assert.deepStrictEqual(festivalsForShow({ artist: 'goose (US)', date: '14-06-2025', city: 'Manchester' }, cat).map((x) => [x.festival.id, x.why]), [['lineup', 'lineup'], ['city', 'city']]);
  assert.deepStrictEqual(festivalsForShow({ artist: 'Phish', date: '2025-06-16', city: 'Manchester' }, cat), [], 'the day after');
  assert.deepStrictEqual(festivalsForShow({ artist: 'Phish', date: '2025-06-13', city: 'Somewhere' }, cat), [], 'same weekend, another city, not on the lineup');
});

test('normalize-show suggests the festival a new show may belong to (never writes it)', async () => {
  setup();
  const res = json(await post(normalizeShow, 'alice-token', { mode: 'commit', input: { kind: 'manual', artist: 'Goose', venue: 'What Stage', city: 'Somewhere', date: '2025-06-14' } }));
  assert.strictEqual(res.created, true, JSON.stringify(res));
  assert.deepStrictEqual(res.festivalMatches.map((f) => [f.id, f.why]), [['bon25', 'lineup']]);
  assert.strictEqual(db._list(`users/${ALICE.uid}/shows`)[0].festivalId, undefined, 'a suggestion only');
});

test('a show already attached to a festival gets no suggestion; nothing nearby, none', async () => {
  setup();
  const attached = json(await post(normalizeShow, 'alice-token', { mode: 'preview', input: { kind: 'festival-row', festivalId: 'bon25', row: { artist: 'Goose', venue: 'What Stage', city: 'Manchester', date: '2025-06-14', setlistfmId: 'x1', sets: { set: [] } } } }));
  assert.deepStrictEqual(attached.festivalMatches, []);
  const none = json(await post(normalizeShow, 'alice-token', { mode: 'preview', input: { kind: 'manual', artist: 'Goose', venue: 'Red Rocks', city: 'Morrison', date: '2025-08-01' } }));
  assert.deepStrictEqual(none.festivalMatches, []);
});

run('Festival matching (5.60.8)');
