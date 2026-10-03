/**
 * Unit tests for lib/setlistSearch.js: the artist-optional search on
 * /search and its "Add all" (every page, grouped by venue for review).
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/setlistSearch.test.js
 */

import assert from 'assert';
import {
  hasSearchTarget, setlistToShowData, fetchAllSetlistPages, groupShowsByVenue,
} from '@/lib/setlistSearch';

let passed = 0;
let failed = 0;
const pending = [];

function test(name, fn) {
  pending.push((async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${e.message}`);
    }
  })());
}

function setlist(id, { artist = 'Goose', venue = 'Red Rocks Amphitheatre', city = 'Morrison', date = '20-06-2024' } = {}) {
  return {
    id,
    eventDate: date,
    artist: { name: artist },
    venue: { name: venue, city: { name: city, country: { name: 'United States' } } },
    sets: { set: [{ song: [{ name: 'Arcadia' }] }] },
  };
}

// ── hasSearchTarget ─────────────────────────────────────────────────────

test('an artist alone is a search', () => {
  assert.strictEqual(hasSearchTarget({ artist: 'Goose' }), true);
});

test('a venue or a city without an artist is a search', () => {
  assert.strictEqual(hasSearchTarget({ venueName: 'Red Rocks' }), true);
  assert.strictEqual(hasSearchTarget({ cityName: 'Morrison' }), true);
});

test('a year alone, or blanks, is not', () => {
  assert.strictEqual(hasSearchTarget({ artist: '  ', venueName: '', cityName: ' ' }), false);
  assert.strictEqual(hasSearchTarget({}), false);
});

// ── setlistToShowData ───────────────────────────────────────────────────

test('builds the same show shape the single Add Show button always has', () => {
  const show = setlistToShowData(
    { ...setlist('abc'), tour: { name: 'Summer Tour' } },
    sl => sl.sets.set[0].song.map(s => ({ name: s.name }))
  );
  assert.deepStrictEqual(show, {
    artist: 'Goose',
    venue: 'Red Rocks Amphitheatre',
    city: 'Morrison',
    country: 'United States',
    date: '2024-06-20',
    setlist: [{ name: 'Arcadia' }],
    setlistfmId: 'abc',
    tour: 'Summer Tour',
  });
});

// ── fetchAllSetlistPages ────────────────────────────────────────────────

function pagedSource(totalShows, perPage = 20) {
  const all = Array.from({ length: totalShows }, (_, i) => setlist(`s${i}`));
  const calls = [];
  const fetchPage = async (n) => {
    calls.push(n);
    const slice = all.slice((n - 1) * perPage, n * perPage);
    return slice.length ? { setlist: slice, total: totalShows, itemsPerPage: perPage } : null;
  };
  return { fetchPage, calls };
}

const noSleep = { sleep: async () => {}, delayMs: 0 };

test('walks every page and stops at the last one', async () => {
  const { fetchPage, calls } = pagedSource(45);
  const out = await fetchAllSetlistPages(fetchPage, noSleep);
  assert.strictEqual(out.setlists.length, 45);
  assert.deepStrictEqual(calls, [1, 2, 3]);
  assert.strictEqual(out.truncated, false);
});

test('a single page makes one request', async () => {
  const { fetchPage, calls } = pagedSource(7);
  const out = await fetchAllSetlistPages(fetchPage, noSleep);
  assert.strictEqual(out.setlists.length, 7);
  assert.deepStrictEqual(calls, [1]);
});

test('caps the walk and reports truncation', async () => {
  const { fetchPage, calls } = pagedSource(250);
  const out = await fetchAllSetlistPages(fetchPage, { ...noSleep, maxPages: 10 });
  assert.strictEqual(calls.length, 10);
  assert.strictEqual(out.setlists.length, 200);
  assert.strictEqual(out.total, 250);
  assert.strictEqual(out.truncated, true);
});

test('waits between pages, not before the first', async () => {
  const { fetchPage } = pagedSource(41);
  const sleeps = [];
  await fetchAllSetlistPages(fetchPage, { delayMs: 600, sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepStrictEqual(sleeps, [600, 600]);
});

test('no results returns an empty list', async () => {
  const out = await fetchAllSetlistPages(async () => null, noSleep);
  assert.deepStrictEqual(out, { setlists: [], total: 0, truncated: false });
});

test('a page error propagates instead of returning a short list', async () => {
  const fetchPage = async (n) => {
    if (n === 2) throw new Error('setlist.fm search failed (429)');
    return { setlist: [setlist('a')], total: 30, itemsPerPage: 20 };
  };
  await assert.rejects(() => fetchAllSetlistPages(fetchPage, noSleep), /429/);
});

test('a setlist repeated across pages is kept once', async () => {
  const fetchPage = async (n) => (n === 1
    ? { setlist: [setlist('a'), setlist('b')], total: 3, itemsPerPage: 2 }
    : { setlist: [setlist('b'), setlist('c')], total: 3, itemsPerPage: 2 });
  const out = await fetchAllSetlistPages(fetchPage, noSleep);
  assert.deepStrictEqual(out.setlists.map(s => s.id), ['a', 'b', 'c']);
});

// ── groupShowsByVenue ───────────────────────────────────────────────────

test('groups by venue and city, largest first', () => {
  const groups = groupShowsByVenue([
    { venue: 'Madison Square Garden', city: 'New York' },
    { venue: 'Hulu Theater at Madison Square Garden', city: 'New York' },
    { venue: 'madison square garden', city: 'New York' },
  ]);
  assert.deepStrictEqual(groups.map(g => [g.venue, g.shows.length]), [
    ['Madison Square Garden', 2],
    ['Hulu Theater at Madison Square Garden', 1],
  ]);
});

// ── Summary ─────────────────────────────────────────
Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});
