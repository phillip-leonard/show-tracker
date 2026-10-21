/**
 * Unit tests for lib/yearInReviewStats.js: the three headline counts
 * (shows, bands, venues) against a hand-counted account, and which year a
 * show belongs to.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/yearInReview.test.js
 *
 * The test pins its own time zone below, because the bug it guards against
 * (New Year's Day shows counted in the previous year) only shows up west of
 * Greenwich.
 */

process.env.TZ = 'America/New_York';

import assert from 'assert';
import { computeYearInReview, showYear } from '@/lib/yearInReviewStats';

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

// A hand-counted 2025, written out so each count can be checked by eye:
//   Shows:  7 (the two 2024 shows and the 2026 show are not in 2025)
//   Bands:  4 — Phish, Goose, Billy Strings, Trey Anastasio Band
//           ("goose " with a trailing space is still Goose)
//   Venues: 5 — MSG, Red Rocks, Radio City, Dick's, the Beacon
//           ("Madison Square Garden" / "madison square garden" is one venue)
const SHOWS = [
  { id: 'a', artist: 'Phish', venue: 'Madison Square Garden', city: 'New York', date: '2025-01-01', rating: 9 },
  { id: 'b', artist: 'Phish', venue: 'madison square garden', city: 'New York', date: '2024-12-31', rating: 10 },
  { id: 'c', artist: 'Goose', venue: 'Red Rocks Amphitheatre', city: 'Morrison', date: '2025-06-20' },
  { id: 'd', artist: 'goose ', venue: 'Radio City Music Hall', city: 'New York', date: '2025-11-01' },
  { id: 'e', artist: 'Billy Strings', venue: "Dick's Sporting Goods Park", city: 'Commerce City', date: '13-09-2025' },
  { id: 'f', artist: 'Billy Strings', venue: "Dick's Sporting Goods Park", city: 'Commerce City', date: '14-09-2025' },
  { id: 'g', artist: 'Trey Anastasio Band', venue: 'Beacon Theatre', city: 'New York', date: '2025-03-02' },
  { id: 'h', artist: 'Phish', venue: 'Madison Square Garden', city: 'New York', date: '2025-12-31' },
  { id: 'i', artist: 'Phish', venue: 'Madison Square Garden', city: 'New York', date: '2024-12-30' },
  { id: 'j', artist: 'Goose', venue: 'Radio City Music Hall', city: 'New York', date: '2026-01-02' },
  { id: 'k', artist: 'Nobody', venue: 'Nowhere', city: '', date: '' },
];

test('counts shows, bands and venues for the year as hand-counted', () => {
  const r = computeYearInReview(SHOWS, 2025);
  assert.strictEqual(r.totalShows, 7);
  assert.strictEqual(r.totalArtists, 4);
  assert.strictEqual(r.totalVenues, 5);
});

test('a New Year\'s Day show counts in its own year, not the one before', () => {
  assert.strictEqual(showYear({ date: '2025-01-01' }), 2025);
  const r2024 = computeYearInReview(SHOWS, 2024);
  assert.strictEqual(r2024.totalShows, 2);
});

test('DD-MM-YYYY dates with a day above 12 are counted, not dropped', () => {
  assert.strictEqual(showYear({ date: '13-09-2025' }), 2025);
  assert.strictEqual(showYear({ date: '31-12-2025' }), 2025);
});

test('a show with no date belongs to no year', () => {
  assert.strictEqual(showYear({ date: '' }), null);
  assert.strictEqual(showYear({}), null);
});

test('back-to-back DD-MM-YYYY nights make a streak', () => {
  const r = computeYearInReview(SHOWS, 2025);
  assert.strictEqual(r.longestConsecutiveStreak, 2);
});

test('the top band and favorite venue merge differently-typed names', () => {
  const r = computeYearInReview(SHOWS, 2025);
  assert.strictEqual(r.topArtist.name, 'Phish');
  assert.strictEqual(r.topArtist.showCount, 2);
  assert.strictEqual(r.favoriteVenue.name, 'Madison Square Garden');
  assert.strictEqual(r.favoriteVenue.frequency, 2);
});

test('the share line names the same three counts', () => {
  const r = computeYearInReview(SHOWS, 2025);
  assert.strictEqual(r.shareableQuote, 'In 2025 I saw 7 shows by 4 bands at 5 venues.');
});

test('a year with no shows has no review', () => {
  assert.strictEqual(computeYearInReview(SHOWS, 2019), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
