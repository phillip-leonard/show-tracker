#!/usr/bin/env node
/**
 * setlist.fm cache rules — netlify/functions/lib/setlistCache.js.
 *
 *   node tests/setlist-cache/setlistCache.test.js
 *
 * Why this test exists: setlist.fm's API terms allow caching "for short
 * periods" only. Until 5.47.5 three functions served expired entries as a
 * fallback and nothing ever deleted one, so the collection held setlist.fm
 * responses going back seven months. These tests pin the two rules that
 * stop that: no entry is written to live longer than 24 hours, and an
 * expired entry is never handed back.
 */

const assert = require('node:assert');
const { Timestamp } = require('firebase-admin/firestore');
const {
  MAX_TTL_HOURS, clampTtlHours, isFresh, readFresh, buildEntry, writeEntry,
} = require('../../netlify/functions/lib/setlistCache');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const HOUR = 3600 * 1000;
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

// A one-collection Firestore stand-in: enough of doc().get()/set()/update().
function fakeDb(docs = {}) {
  const writes = [];
  const updates = [];
  return {
    docs, writes, updates,
    collection(name) {
      assert.strictEqual(name, 'setlistCache');
      return {
        doc(id) {
          const ref = {
            async get() {
              return { exists: id in docs, data: () => docs[id], ref };
            },
            async set(value) { docs[id] = value; writes.push({ id, value }); },
            async update(value) { updates.push({ id, value }); docs[id] = { ...docs[id], ...value }; },
          };
          return ref;
        },
      };
    },
  };
}

test('the maximum TTL is 24 hours', () => {
  assert.strictEqual(MAX_TTL_HOURS, 24);
});

test('a TTL over 24 hours is cut to 24', () => {
  assert.strictEqual(clampTtlHours(168), 24);
  assert.strictEqual(clampTtlHours(25), 24);
});

test('a shorter TTL is kept', () => {
  assert.strictEqual(clampTtlHours(1), 1);
  assert.strictEqual(clampTtlHours(6), 6);
  assert.strictEqual(clampTtlHours(12), 12);
});

test('an unusable TTL gets the maximum, never forever', () => {
  for (const bad of [undefined, null, 0, -5, NaN, 'soon', Infinity]) {
    assert.strictEqual(clampTtlHours(bad), 24, `ttl ${bad}`);
  }
});

test('buildEntry dates the entry and sets expiresAt within 24 hours', () => {
  const entry = buildEntry({ response: '{}', ttlHours: 168, queryParams: { kind: 'x' } }, NOW);
  assert.strictEqual(entry.fetchedAt.toMillis(), NOW);
  assert.strictEqual(entry.expiresAt.toMillis(), NOW + 24 * HOUR);
  assert.strictEqual(entry.ttlHours, 24);
  assert.strictEqual(entry.response, '{}');
  assert.deepStrictEqual(entry.queryParams, { kind: 'x' });
});

test('isFresh: future expiry is fresh, past or missing is not', () => {
  assert.strictEqual(isFresh({ expiresAt: Timestamp.fromMillis(NOW + 1) }, NOW), true);
  assert.strictEqual(isFresh({ expiresAt: Timestamp.fromMillis(NOW) }, NOW), false);
  assert.strictEqual(isFresh({ expiresAt: Timestamp.fromMillis(NOW - HOUR) }, NOW), false);
  assert.strictEqual(isFresh({}, NOW), false);
  assert.strictEqual(isFresh(null, NOW), false);
});

test('readFresh returns a live entry and counts the hit', async () => {
  const db = fakeDb({ k: { response: 'live', expiresAt: Timestamp.fromMillis(NOW + HOUR), hitCount: 2 } });
  const entry = await readFresh(db, 'k', NOW);
  assert.strictEqual(entry.response, 'live');
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(db.updates, [{ id: 'k', value: { hitCount: 3 } }]);
});

test('readFresh never returns an expired entry', async () => {
  const db = fakeDb({ k: { response: 'old', expiresAt: Timestamp.fromMillis(NOW - 1) } });
  assert.strictEqual(await readFresh(db, 'k', NOW), null);
});

test('readFresh treats an entry with no expiresAt as expired', async () => {
  const db = fakeDb({ k: { response: 'undated' } });
  assert.strictEqual(await readFresh(db, 'k', NOW), null);
});

test('readFresh: missing entry, no db, or a read error is a miss', async () => {
  assert.strictEqual(await readFresh(fakeDb(), 'k', NOW), null);
  assert.strictEqual(await readFresh(null, 'k', NOW), null);
  const broken = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('down'); } }) }) };
  const warn = console.warn; console.warn = () => {};
  try { assert.strictEqual(await readFresh(broken, 'k', NOW), null); } finally { console.warn = warn; }
});

test('writeEntry writes a dated, capped entry', async () => {
  const db = fakeDb();
  await writeEntry(db, 'k', { response: 'r', ttlHours: 48 }, NOW);
  assert.strictEqual(db.writes.length, 1);
  assert.strictEqual(db.docs.k.expiresAt.toMillis(), NOW + 24 * HOUR);
});

test('an entry written now is gone from reads once its TTL passes', async () => {
  const db = fakeDb();
  await writeEntry(db, 'k', { response: 'r', ttlHours: 24 }, NOW);
  assert.ok(await readFresh(db, 'k', NOW + 23 * HOUR));
  assert.strictEqual(await readFresh(db, 'k', NOW + 24 * HOUR), null);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
