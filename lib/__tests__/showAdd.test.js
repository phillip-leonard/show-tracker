/**
 * The app's half of adding a show (lib/showAdd.js, 5.60.6): the outbox,
 * the request to normalize-show, and the offline contract end to end:
 *
 *   offline   the app builds the show itself (lib/normalizeShow.js, no
 *             band source), writes deviceShowWrite's fields with
 *             needsNormalization, and keeps the outbox entry
 *   meanwhile the user rates a song on the saved show
 *   online    the outbox entry goes to the real normalize-show handler
 *             (against the in-memory Firestore), which normalizes the
 *             document in place under the same id, band source and all,
 *             keeping the rating
 *   never     a device that never reconnects: the sweep finishes the show
 *             from the stored input instead
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/showAdd.test.js
 */

import assert from 'assert';
import { createRequire } from 'node:module';

// A browser's localStorage, before lib/storage.js is loaded.
const store = new Map();
globalThis.window = globalThis.window || {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  commitShowInputs, OfflineError, readOutbox, addToOutbox, removeFromOutbox, deviceShowWrite,
  storedInput, possibleDuplicateQuestion, MAX_INPUTS_PER_REQUEST,
} = await import('@/lib/showAdd');
const { normalizeShowInput } = await import('@/lib/normalizeShow');

const require = createRequire(import.meta.url);
const { createFakeDb, createFakeAuth } = require('../../tests/email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestDeps } = require('../../netlify/functions/lib/normalizeShowServer');
const { sweepPending } = require('../../netlify/functions/lib/showSweep');
const normalizeShowFn = require('../../netlify/functions/normalize-show');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.stack || e.message}`);
  }
}

const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com' };
const ELGOOSE = {
  ok: true,
  songs: [{ id: 'eg1', name: 'Arcadia', set: 'Set I', transitionMark: '>' }, { id: 'eg2', name: 'Hot Tea', set: 'Set I' }, { id: 'eg3', name: 'Madhuvan', set: 'Encore' }],
  sourceShowId: '1717', sourcePermalink: 'https://elgoose.net/setlists/x', setlistNotes: '', tour: 'Summer Tour',
};

// ── The outbox ────────────────────────────────────────────────────────

await test('outbox: per user, one entry per show, removable', () => {
  store.clear();
  addToOutbox('u1', { showId: '1', input: { kind: 'manual', artist: 'A' } });
  addToOutbox('u1', { showId: '2', input: { kind: 'manual', artist: 'B' } });
  addToOutbox('u1', { showId: '1', input: { kind: 'manual', artist: 'A2' } });
  addToOutbox('u2', { showId: '9', input: { kind: 'manual', artist: 'Z' } });
  assert.deepStrictEqual(readOutbox('u1').map((e) => [e.showId, e.input.artist]), [['2', 'B'], ['1', 'A2']]);
  assert.strictEqual(readOutbox('u2').length, 1);
  removeFromOutbox('u1', ['1', '2']);
  assert.deepStrictEqual(readOutbox('u1'), []);
  assert.strictEqual(readOutbox(null).length, 0);
});

await test('outbox: unreadable or malformed storage reads as empty', () => {
  store.set('mysetlists_show_outbox:u3', '{not json');
  assert.deepStrictEqual(readOutbox('u3'), []);
  store.set('mysetlists_show_outbox:u3', JSON.stringify([{ showId: '1' }, { showId: '2', input: { kind: 'manual' } }]));
  assert.deepStrictEqual(readOutbox('u3').map((e) => e.showId), ['2']);
});

await test('deviceShowWrite: the stored input never carries the show id, and a possible duplicate is already settled', () => {
  const w = deviceShowWrite({ id: '1763121600000', artist: 'Goose', date: '2024-06-21' }, { kind: 'manual', artist: 'Goose', showId: '1763121600000' });
  assert.strictEqual(w.id, '1763121600000');
  assert.strictEqual(w.fields.id, undefined);
  assert.deepStrictEqual(w.fields.normalizationInput, { kind: 'manual', artist: 'Goose', confirmPossible: true });
  assert.strictEqual(w.fields.needsNormalization, true);
  assert.deepStrictEqual(w.outboxEntry, { showId: '1763121600000', input: w.fields.normalizationInput });
  assert.deepStrictEqual(storedInput({ showId: 'x', kind: 'tag' }), { kind: 'tag' });
});

await test('possibleDuplicateQuestion names both venues', () => {
  const q = possibleDuplicateQuestion({ artist: 'Goose', venue: "Dick's", city: 'Commerce City' }, { artist: 'Goose', venue: 'DSG Park', date: '2024-08-31' });
  assert.match(q, /Dick's, Commerce City/);
  assert.match(q, /Add DSG Park as a separate show\?/);
});

// ── The request ───────────────────────────────────────────────────────

await test('commitShowInputs: 25 inputs per request, in order', async () => {
  const bodies = [];
  const fetchImpl = async (path, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return { ok: true, json: async () => ({ ok: true, results: body.inputs.map((i) => ({ echo: i.n })) }) };
  };
  const inputs = Array.from({ length: 60 }, (_, n) => ({ kind: 'manual', n }));
  const results = await commitShowInputs(inputs, { fetchImpl });
  assert.deepStrictEqual(bodies.map((b) => b.inputs.length), [MAX_INPUTS_PER_REQUEST, MAX_INPUTS_PER_REQUEST, 10]);
  assert.strictEqual(bodies[0].mode, 'commit');
  assert.deepStrictEqual(results.map((r) => r.echo), inputs.map((i) => i.n));
});

await test('commitShowInputs: a network failure, a timeout and a 5xx/429/401 are OfflineError, carrying what was done', async () => {
  let calls = 0;
  const flaky = async (path, init) => {
    calls++;
    if (calls === 2) throw new TypeError('Failed to fetch');
    const body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ results: body.inputs.map(() => ({ created: true })) }) };
  };
  await assert.rejects(commitShowInputs(Array(30).fill({ kind: 'manual' }), { fetchImpl: flaky }), (err) => err instanceof OfflineError && err.done.length === 25);
  for (const status of [500, 503, 429, 401]) {
    await assert.rejects(commitShowInputs([{ kind: 'manual' }], { fetchImpl: async () => ({ ok: false, status }) }), (err) => err instanceof OfflineError && err.status === status);
  }
  await assert.rejects(commitShowInputs([{ kind: 'manual' }], { fetchImpl: () => new Promise(() => {}), timeoutMs: 20 }), OfflineError);
});

// ── Offline, end to end ───────────────────────────────────────────────

function server(db) {
  const auth = createFakeAuth({ tokens: { 'alice-token': ALICE }, users: [ALICE] });
  __setTestFirebase({ db, auth });
  __setTestDeps(() => ({ setlistfmSetlist: async () => null, bandSetlist: async () => ELGOOSE }));
  // What authedFetch does, against the handler instead of the network.
  return async (path, init) => {
    const res = await normalizeShowFn.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer alice-token', origin: 'https://mysetlists.net' }, body: init.body });
    return { ok: res.statusCode < 400, status: res.statusCode, json: async () => JSON.parse(res.body) };
  };
}

// What AppContext.addShowOnDevice does: build here without the band
// source, write deviceShowWrite's fields, keep the outbox entry.
async function addOffline(db, input, existingShows = []) {
  const built = await normalizeShowInput({ ...input, showId: '1763121600000' }, {
    deps: { bandSetlist: async () => null, setlistfmSetlist: async () => null },
    existingShows,
  });
  const write = deviceShowWrite(built.show, input);
  db._put(`users/${ALICE.uid}/shows/${write.id}`, { ...write.fields, createdAt: 'device-time' });
  addToOutbox(ALICE.uid, write.outboxEntry);
  return write;
}

await test('offline add, a rating meanwhile, then back online: normalized in place, the rating kept', async () => {
  store.clear();
  const db = createFakeDb();
  const fetchImpl = server(db);
  const input = { kind: 'manual', artist: 'Goose ', venue: 'Red Rocks Amphitheatre', city: 'Morrison', date: '2024-06-21' };
  const { id } = await addOffline(db, input);

  const saved = db._get(`users/${ALICE.uid}/shows/${id}`);
  assert.deepStrictEqual([saved.artist, saved.setlistSource, saved.setlist.length, saved.needsNormalization], ['Goose', 'setlistfm', 0, true]);

  // Still offline: the user adds a song by hand and rates it, and rates the show.
  db._put(`users/${ALICE.uid}/shows/${id}`, { ...saved, rating: 9, setlist: [{ id: 'mine', name: 'Arcadia', rating: 10, comment: 'opener', manuallyAdded: true }] });

  // Back online: the outbox goes to normalize-show (AppContext.flushOutbox).
  const entries = readOutbox(ALICE.uid);
  const results = await commitShowInputs(entries.map((e) => ({ ...e.input, showId: e.showId, confirmPossible: true })), { fetchImpl });
  assert.strictEqual(results[0].updated, true, JSON.stringify(results[0]));
  removeFromOutbox(ALICE.uid, entries.map((e) => e.showId));

  const show = db._get(`users/${ALICE.uid}/shows/${id}`);
  assert.deepStrictEqual([show.setlistSource, show.needsNormalization, show.normalizationInput, show.createdAt], ['elgoose', false, null, 'device-time']);
  assert.deepStrictEqual(show.setlist.map((s) => s.name), ['Arcadia', 'Hot Tea', 'Madhuvan']);
  const arcadia = show.setlist[0];
  assert.deepStrictEqual([arcadia.rating, arcadia.comment, arcadia.transitionMark], [10, 'opener', '>']);
  assert.strictEqual(show.rating, 9);
  assert.strictEqual(db._list(`users/${ALICE.uid}/shows`).length, 1, 'one document, not two');
  assert.deepStrictEqual(readOutbox(ALICE.uid), []);

  // A second flush (another tab, a retry) changes nothing.
  const again = await commitShowInputs([{ ...input, showId: id, confirmPossible: true }], { fetchImpl });
  assert.strictEqual(again[0].alreadyNormalized, true);
});

await test('a device that never comes back: the sweep finishes the show from its stored input', async () => {
  store.clear();
  const db = createFakeDb();
  server(db);
  const { id } = await addOffline(db, { kind: 'manual', artist: 'Goose', venue: 'Red Rocks Amphitheatre', city: 'Morrison', date: '21-06-2024' });
  const counts = await sweepPending(db, { write: true });
  assert.strictEqual(counts.normalized, 1);
  const show = db._get(`users/${ALICE.uid}/shows/${id}`);
  assert.deepStrictEqual([show.date, show.setlistSource, show.setlist.length, show.needsNormalization], ['2024-06-21', 'elgoose', 3, false]);
});

await test('offline, the same duplicate rule applies before anything is written', async () => {
  const existing = [{ id: '1700000000001', artist: 'Goose', venue: 'Red Rocks Amphitheatre', date: '2024-06-21' }];
  const built = await normalizeShowInput({ kind: 'manual', artist: 'goose', venue: 'Red Rocks Amphitheatre', date: '21-06-2024', showId: '1763121600000' }, {
    deps: { bandSetlist: async () => null }, existingShows: existing,
  });
  assert.deepStrictEqual(built.duplicate, { showId: '1700000000001', rule: 'same-show' });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
