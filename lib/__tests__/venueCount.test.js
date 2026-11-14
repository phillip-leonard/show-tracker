/**
 * lib/venueCount.js — one venue-count definition for every screen (B-04,
 * 5.59.10).
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/venueCount.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { countVenues, venueCountKey } from '@/lib/venueCount';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const shows = [
  { venue: 'Red Rocks Amphitheatre', city: 'Morrison' },
  { venue: 'red rocks  amphitheatre ', city: 'morrison' }, // same venue, typed differently
  { venue: 'The Fillmore', city: 'San Francisco' },
  { venue: 'The Fillmore', city: 'Denver' },               // same name, other city
  { venue: 'Terminal 5', city: 'New York' },
  { venue: 'Terminal-5', city: 'New York' },               // punctuation is not stripped
  { venue: '', city: 'Austin' },                           // no venue: not counted
  { city: 'Austin' },
];

test('distinct normalized name + city', () => {
  assert.strictEqual(countVenues(shows), 5);
  assert.strictEqual(venueCountKey(shows[0]), venueCountKey(shows[1]));
  assert.notStrictEqual(venueCountKey(shows[2]), venueCountKey(shows[3]));
  assert.strictEqual(venueCountKey(shows[6]), null);
  assert.strictEqual(countVenues([]), 0);
  assert.strictEqual(countVenues(undefined), 0);
});

test('a show with no city still counts, once per name', () => {
  assert.strictEqual(countVenues([{ venue: 'Brooklyn Bowl' }, { venue: 'brooklyn bowl', city: '' }]), 1);
});

test('every screen that shows a venue count uses the shared rule', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const uses = {
    'context/AppContext.jsx': ['const uniqueVenues = countVenues(shows);', 'const key = venueCountKey(show);'],
    'components/profile/ProfileView.js': ['uniqueVenues: countVenues(shows)', 'venueCount: countVenues(shows)'],
    'app/profile/page.jsx': ['venues: countVenues(shows)'],
    'app/stats/page.jsx': ['countVenues(periodShows)'],
    'components/StatsView.jsx': ['const groupKey = venueCountKey(show);'],
    'components/SongHistoryModal.jsx': ['countVenues(performances)'],
    'lib/yearInReviewStats.js': ['venueCountKey({ venue: name, city })'],
    'lib/yearRecap.js': ['const venueKey = (show) => venueCountKey(show);'],
    'lib/myPoster.js': ['const venueKey = (show) => venueCountKey(show);'],
    'netlify/functions/public-profile.js': ['const venueCount = countVenues(shows);'],
  };
  for (const [file, needles] of Object.entries(uses)) {
    const src = read(file);
    for (const n of needles) assert.ok(src.includes(n), `${file} should use: ${n}`);
  }
  // The one name-only count left is the leaderboard's userProfiles.venueCount
  // (B-05, the separate server-side stats PR).
  const ctx = read('context/AppContext.jsx');
  assert.strictEqual((ctx.match(/new Set\(shows\.map\(s => s\.venue\)\)\.size/g) || []).length, 1);
});

for (const t of tests) {
  try { await t.fn(); passed++; } catch (err) { failed++; console.error(`✗ ${t.name}\n  ${err.message}`); }
}
console.log(`\nvenueCount: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
