/**
 * Unit tests for lib/showFilters.js (the filter shared by My Shows, Stats,
 * Tours and Festivals) and the date in lib/streamingPlatforms.js's links.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/showFilters.test.js
 */

import assert from 'assert';
import { applyShowFilters, availableYearsFor, countActiveShowFilters } from '@/lib/showFilters';
import { getStreamingPlatforms } from '@/lib/streamingPlatforms';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

const shows = [
  { id: 'a', artist: 'Phish', venue: 'MSG', date: '2023-12-31' },
  { id: 'b', artist: 'Goose', venue: 'Radio City', date: '2023-11-01' },
  { id: 'c', artist: 'Phish', venue: "Dick's", date: '2022-09-04' },
  { id: 'd', artist: 'Billy Strings', venue: 'Red Rocks', date: '14-09-2024' },
];
const ids = list => list.map(s => s.id).sort().join(',');

// ── applyShowFilters ────────────────────────────────────────────────────

test('no filters returns every show', () => {
  assert.strictEqual(ids(applyShowFilters(shows)), 'a,b,c,d');
});

test('search matches artist or venue, case-insensitively', () => {
  assert.strictEqual(ids(applyShowFilters(shows, { searchTerm: 'phish' })), 'a,c');
  assert.strictEqual(ids(applyShowFilters(shows, { searchTerm: 'RADIO' })), 'b');
});

test('year filter reads both stored date formats', () => {
  assert.strictEqual(ids(applyShowFilters(shows, { filterYear: '2023' })), 'a,b');
  assert.strictEqual(ids(applyShowFilters(shows, { filterYear: '2024' })), 'd');
});

test('date filter matches the stored date exactly (unchanged My Shows behavior)', () => {
  assert.strictEqual(ids(applyShowFilters(shows, { filterDate: '2023-11-01' })), 'b');
});

test('filters combine', () => {
  assert.strictEqual(ids(applyShowFilters(shows, { searchTerm: 'phish', filterYear: '2022' })), 'c');
});

test('does not mutate or reorder the input', () => {
  const copy = shows.slice();
  applyShowFilters(shows, { searchTerm: 'p' });
  assert.deepStrictEqual(shows, copy);
});

test('a show missing a venue does not throw', () => {
  assert.strictEqual(applyShowFilters([{ id: 'x', artist: 'Phish', date: '2023-01-01' }], { searchTerm: 'x' }).length, 0);
});

test('availableYearsFor is distinct and newest first', () => {
  assert.deepStrictEqual(availableYearsFor(shows), [2024, 2023, 2022]);
});

test('countActiveShowFilters counts only set filters', () => {
  assert.strictEqual(countActiveShowFilters({ searchTerm: '', filterYear: '2023', filterDate: '' }), 1);
});

// ── archive.org link date ───────────────────────────────────────────────

function archiveUrl(date) {
  return getStreamingPlatforms('Phish', date).find(p => p.name === 'archive.org').url;
}

test('archive.org link uses YYYY-MM-DD for a YYYY-MM-DD show', () => {
  assert.ok(archiveUrl('1994-10-31').includes(encodeURIComponent('Phish 1994-10-31')));
});

test("archive.org link converts setlist.fm's DD-MM-YYYY without shifting the day", () => {
  assert.ok(archiveUrl('31-10-1994').includes(encodeURIComponent('Phish 1994-10-31')));
  // New Year's Eve / Day is where a timezone round-trip would slip.
  assert.ok(archiveUrl('31-12-2023').includes(encodeURIComponent('Phish 2023-12-31')));
  assert.ok(archiveUrl('01-01-2024').includes(encodeURIComponent('Phish 2024-01-01')));
});

test('an unreadable date falls back to an artist-only search', () => {
  assert.ok(archiveUrl('TBD').endsWith(`query=Phish&and[]=mediatype%3A%22audio%22`));
});

test('Relisten deep link gets the same normalized date', () => {
  const relisten = getStreamingPlatforms('Phish', '31-10-1994').find(p => p.name === 'relisten.net');
  assert.strictEqual(relisten.url, 'https://relisten.net/phish/1994/10/31');
});

// ── Summary ─────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
