/**
 * Unit tests for lib/reliveThisNight.js: which show "Relive this night's
 * magic" offers, and the once-a-day rule.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/reliveThisNight.test.js
 *
 * Pinned to Los Angeles, because the bug it guards against ("today" read
 * as the UTC date, which on a US evening is already tomorrow) only shows
 * up west of Greenwich.
 */

process.env.TZ = 'America/Los_Angeles';

import assert from 'assert';

// lib/storage.js decides at import time whether it is in a browser, so
// the stand-in localStorage has to exist before the module loads.
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const { localIsoDate } = await import('@/lib/utils');
const {
  pickReliveShow, reliveShowFor, dismissReliveShow, resetReliveSession,
} = await import('@/lib/reliveThisNight');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

// Local wall-clock times. Month is 0-indexed.
const OCT_23_2026 = new Date(2026, 9, 23, 9, 0);
const OCT_23_2026_LATE = new Date(2026, 9, 23, 23, 30);

const SHOWS = [
  { id: 'a', artist: 'Phish', date: '2019-10-23' },
  { id: 'b', artist: 'Goose', date: '2022-10-23' },
  { id: 'c', artist: 'Phish', date: '2026-10-23' }, // this year: not history
  { id: 'd', artist: 'Billy Strings', date: '2021-10-24' },
  { id: 'e', artist: 'Phish', date: '2018-10-22' },
];

// ── Matching ──────────────────────────────────────────────────────────

test('an earlier year on today\'s month and day matches', () => {
  assert.strictEqual(pickReliveShow([SHOWS[0]], OCT_23_2026)?.id, 'a');
});

test('several matches: the most recent one', () => {
  assert.strictEqual(pickReliveShow(SHOWS, OCT_23_2026)?.id, 'b');
});

test('a show from the current year does not count', () => {
  assert.strictEqual(pickReliveShow([SHOWS[2]], OCT_23_2026), null);
});

test('no show on today\'s month and day: null', () => {
  assert.strictEqual(pickReliveShow([SHOWS[3], SHOWS[4]], OCT_23_2026), null);
  assert.strictEqual(pickReliveShow([], OCT_23_2026), null);
});

test('DD-MM-YYYY (ticket scanner) dates match like any other', () => {
  const scanned = { id: 's', date: '23-10-2019' };
  assert.strictEqual(pickReliveShow([scanned], OCT_23_2026)?.id, 's');
});

test('DD-MM-YYYY competes with YYYY-MM-DD by its real date', () => {
  const scanned = { id: 's', date: '23-10-2024' };
  assert.strictEqual(pickReliveShow([SHOWS[0], scanned, SHOWS[1]], OCT_23_2026)?.id, 's');
});

test('missing or unreadable dates are skipped', () => {
  const shows = [{ id: 'x' }, { id: 'y', date: '' }, { id: 'z', date: 'sometime' }, SHOWS[0]];
  assert.strictEqual(pickReliveShow(shows, OCT_23_2026)?.id, 'a');
});

test('late evening in Los Angeles is still the local date', () => {
  // 23:30 PDT on Oct 23 is 06:30 UTC on Oct 24.
  assert.strictEqual(OCT_23_2026_LATE.toISOString().slice(0, 10), '2026-10-24');
  assert.strictEqual(localIsoDate(OCT_23_2026_LATE), '2026-10-23');
  assert.strictEqual(pickReliveShow(SHOWS, OCT_23_2026_LATE)?.id, 'b');
  assert.strictEqual(pickReliveShow([SHOWS[3]], OCT_23_2026_LATE), null);
});

test('just after midnight is the new local day', () => {
  assert.strictEqual(pickReliveShow([SHOWS[3]], new Date(2026, 9, 24, 0, 5))?.id, 'd');
});

test('a Feb 29 show matches on Feb 29 only', () => {
  const leap = { id: 'l', date: '2020-02-29' };
  assert.strictEqual(pickReliveShow([leap], new Date(2028, 1, 29, 12))?.id, 'l');
  assert.strictEqual(pickReliveShow([leap], new Date(2027, 1, 28, 12)), null);
  assert.strictEqual(pickReliveShow([leap], new Date(2027, 2, 1, 12)), null);
});

// ── Once a day ────────────────────────────────────────────────────────

function freshDevice() {
  store.clear();
  resetReliveSession();
}

test('first load of the day offers the show and records the date', () => {
  freshDevice();
  assert.strictEqual(reliveShowFor('u1', SHOWS, OCT_23_2026)?.id, 'b');
  assert.strictEqual(store.get('mysetlists_relive_this_night:u1'), '2026-10-23');
});

test('the same page load keeps offering it (back from the detail screen)', () => {
  freshDevice();
  reliveShowFor('u1', SHOWS, OCT_23_2026);
  assert.strictEqual(reliveShowFor('u1', SHOWS, OCT_23_2026_LATE)?.id, 'b');
});

test('a reload later the same day offers nothing', () => {
  freshDevice();
  reliveShowFor('u1', SHOWS, OCT_23_2026);
  resetReliveSession(); // a reload: storage survives, the page load does not
  assert.strictEqual(reliveShowFor('u1', SHOWS, OCT_23_2026_LATE), null);
});

test('the next day starts over', () => {
  freshDevice();
  reliveShowFor('u1', SHOWS, OCT_23_2026);
  resetReliveSession();
  const nextDay = new Date(2026, 9, 24, 9, 0);
  assert.strictEqual(reliveShowFor('u1', SHOWS, nextDay)?.id, 'd');
});

test('dismissing hides it for the rest of the page load', () => {
  freshDevice();
  reliveShowFor('u1', SHOWS, OCT_23_2026);
  dismissReliveShow();
  assert.strictEqual(reliveShowFor('u1', SHOWS, OCT_23_2026), null);
});

test('the flag is per user', () => {
  freshDevice();
  reliveShowFor('u1', SHOWS, OCT_23_2026);
  assert.strictEqual(reliveShowFor('u2', [SHOWS[0]], OCT_23_2026)?.id, 'a');
});

test('no match writes nothing, so a show added later in the day can still appear', () => {
  freshDevice();
  assert.strictEqual(reliveShowFor('u1', [SHOWS[3]], OCT_23_2026), null);
  assert.strictEqual(store.has('mysetlists_relive_this_night:u1'), false);
});

test('a show deleted since is not offered', () => {
  freshDevice();
  reliveShowFor('u1', SHOWS, OCT_23_2026);
  assert.strictEqual(reliveShowFor('u1', SHOWS.filter(s => s.id !== 'b'), OCT_23_2026), null);
});

test('no user, no card', () => {
  freshDevice();
  assert.strictEqual(reliveShowFor(null, SHOWS, OCT_23_2026), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
