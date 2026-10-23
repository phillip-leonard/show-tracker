/**
 * Unit tests for lib/setlistfmLocalCache.js — the sweep that keeps
 * setlist.fm responses cached in localStorage from outliving 24 hours.
 *
 * Before 5.47.5 an expired entry was dropped only when its own component
 * read it again, so a tour or catalog nobody reopened stayed on the device
 * indefinitely. setlist.fm's terms allow caching for short periods only.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/setlistfmLocalCache.test.js
 */

import assert from 'assert';
import {
  sweepExpiredSetlistfmCaches, SETLISTFM_LOCAL_CACHE_TTL_MS,
} from '@/lib/setlistfmLocalCache';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// The slice of the Storage API the sweep uses.
function fakeStorage(entries) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    removeItem: (k) => { map.delete(k); },
    keys: () => [...map.keys()].sort(),
  };
}

const NOW = 1_800_000_000_000;
const entry = (age) => JSON.stringify({ data: { x: 1 }, cachedAt: NOW - age });

test('the TTL is 24 hours', () => {
  assert.strictEqual(SETLISTFM_LOCAL_CACHE_TTL_MS, 24 * 60 * 60 * 1000);
});

test('removes expired setlist.fm entries and keeps fresh ones', () => {
  const store = fakeStorage({
    tour_info_a: entry(SETLISTFM_LOCAL_CACHE_TTL_MS + 1),
    song_stats_a: entry(1000),
    wishlist_catalog_a: entry(40 * SETLISTFM_LOCAL_CACHE_TTL_MS),
    wishlist_catalog_b: entry(0),
  });
  assert.strictEqual(sweepExpiredSetlistfmCaches(store, NOW), 2);
  assert.deepStrictEqual(store.keys(), ['song_stats_a', 'wishlist_catalog_b']);
});

test('an entry exactly 24 hours old is expired', () => {
  const store = fakeStorage({ tour_info_a: entry(SETLISTFM_LOCAL_CACHE_TTL_MS) });
  assert.strictEqual(sweepExpiredSetlistfmCaches(store, NOW), 1);
});

test('unreadable or undated entries under these prefixes are removed', () => {
  const store = fakeStorage({ tour_info_a: '{not json', song_stats_b: JSON.stringify({ data: 1 }) });
  assert.strictEqual(sweepExpiredSetlistfmCaches(store, NOW), 2);
  assert.deepStrictEqual(store.keys(), []);
});

test('other keys are never touched', () => {
  const store = fakeStorage({ 'guest-shows': '[]', 'cookie-consent': 'yes', mysetlists_lastVisit: '1' });
  assert.strictEqual(sweepExpiredSetlistfmCaches(store, NOW), 0);
  assert.strictEqual(store.keys().length, 3);
});

test('no storage (server render, private mode) is a no-op', () => {
  assert.strictEqual(sweepExpiredSetlistfmCaches(null, NOW), 0);
  const throwing = { get length() { throw new Error('denied'); } };
  assert.strictEqual(sweepExpiredSetlistfmCaches(throwing, NOW), 0);
});

test('site data blocked: touching window.localStorage throws, and the default store is read safely', () => {
  // Chrome's "Block all site data". In 5.47.5 the default parameter read
  // window.localStorage outside the try and the app showed "Application
  // error" (e2e/smoke/core.smoke.spec.js, "loads with all site storage blocked").
  const hadWindow = 'window' in globalThis;
  const previous = globalThis.window;
  globalThis.window = {};
  Object.defineProperty(globalThis.window, 'localStorage', {
    get() { throw new Error('SecurityError: Access is denied for this document.'); },
  });
  try {
    assert.strictEqual(sweepExpiredSetlistfmCaches(), 0);
    assert.strictEqual(sweepExpiredSetlistfmCaches(undefined, NOW), 0);
  } finally {
    if (hadWindow) globalThis.window = previous; else delete globalThis.window;
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
