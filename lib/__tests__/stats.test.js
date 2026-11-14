/**
 * lib/stats — golden tests for the numbers people see (5.59.15).
 *
 * A fixture user with every edge case the production data has: legacy
 * DD-MM-YYYY dates, an ambiguous NN-NN-YYYY date, a festival import, a
 * duplicate night, a sandwich, band and venue spellings, an unreadable
 * date, empty setlist entries. Plus parity with the app's own keys, and
 * the rank rules.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/stats.test.js
 */

import assert from 'assert';
import { computeUserStats, publicStats, isRanked, rankUsers } from '@/lib/stats/index';
import { songKey, bandKey } from '@/lib/stats/keys';
import { songTitleKey } from '@/lib/songCounts';
import { artistNameKeyLoose } from '@/lib/setlistSources';

let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const FIXTURE = [
  // ISO date; a sandwich (Arcadia twice) is two performances, one song.
  { artist: 'Goose', venue: 'Red Rocks Amphitheatre', city: 'Morrison', date: '2025-06-01', rating: 9,
    setlist: [{ name: 'Arcadia', rating: 10 }, { name: 'Hungersite' }, { name: 'Arcadia' }] },
  // Legacy DD-MM-YYYY, the same venue spelled differently, the same band in another spelling.
  { artist: 'goose (US)', venue: 'red rocks  amphitheatre ', city: 'morrison', date: '02-06-2025', rating: 7,
    setlist: [{ name: 'Ashes//Dust', rating: 8 }] },
  // Ambiguous NN-NN-YYYY: read day-first, as the app shows it (3 April 2024).
  { artist: 'Phish', venue: 'MSG', city: 'New York', date: '03-04-2024',
    setlist: [{ name: 'Ashes // Dust' }, { name: 'Tweezer' }] },
  // A festival import (built by buildShowDoc like any show).
  { artist: 'The Band', venue: 'Bonnaroo Farm', city: 'Manchester', date: '2023-06-15', festivalId: 'f1', setlistfmId: 'x1',
    setlist: [{ name: 'The Weight - Live' }] },
  // The same night logged twice: two documents, two shows.
  { artist: 'Band', venue: 'Bonnaroo Farm', city: 'Manchester', date: '15-06-2023', setlist: [] },
  // Unreadable date; no venue; empty and missing song names.
  { artist: 'Goose', venue: '', city: 'Austin', date: 'TBA', rating: 11, setlist: [{ name: '' }, {}, { name: 'Hungersite', rating: 6 }] },
];

test('golden: the fixture user', () => {
  assert.deepStrictEqual(computeUserStats(FIXTURE), {
    statsVersion: 1,
    showCount: 6,
    songCount: 10,              // every setlist entry, the sandwich and the empty ones included
    ratedSongCount: 3,
    uniqueSongCount: 5,         // arcadia, hungersite, ashes dust (both spellings), tweezer, the weight
    bandCount: 3,               // goose, phish, band
    venueCount: 3,              // red rocks::morrison, msg::new york, bonnaroo farm::manchester
    yearsActive: 3,
    showsByYear: { 2023: 2, 2024: 1, 2025: 2 },
    firstShowDate: '2023-06-15',
    lastShowDate: '2025-06-02',
    avgShowRating: '8.0',       // 9 and 7; 11 is out of range
    ratedShowCount: 2,
    topBands: [{ name: 'Goose', count: 3 }, { name: 'The Band', count: 2 }, { name: 'Phish', count: 1 }],
    topVenues: [
      { name: 'Bonnaroo Farm, Manchester', count: 2 },
      { name: 'Red Rocks Amphitheatre, Morrison', count: 2 },
      { name: 'MSG, New York', count: 1 },
    ],
  });
});

test('golden: the song keys behind uniqueSongCount', () => {
  const keys = new Set(FIXTURE.flatMap((s) => (s.setlist || []).map((x) => songKey(x && x.name))).filter(Boolean));
  assert.deepStrictEqual([...keys].sort(), ['arcadia', 'ashes dust', 'hungersite', 'the weight', 'tweezer']);
});

test('an empty account', () => {
  const s = computeUserStats([]);
  assert.strictEqual(s.showCount, 0);
  assert.strictEqual(s.avgShowRating, null);
  assert.strictEqual(s.firstShowDate, null);
  assert.deepStrictEqual(s.topBands, []);
  assert.deepStrictEqual(computeUserStats(undefined).showCount, 0);
});

test('the stored date format never changes a number', () => {
  const iso = computeUserStats([{ artist: 'A', venue: 'V', date: '2024-04-03' }]);
  const legacy = computeUserStats([{ artist: 'A', venue: 'V', date: '03-04-2024' }]);
  assert.deepStrictEqual(iso, legacy);
});

test('publicStats: only the four counts and the rank', () => {
  const p = publicStats(computeUserStats(FIXTURE), { rank: 2, of: 30 });
  assert.deepStrictEqual(Object.keys(p).sort(), ['rank', 'rankedOf', 'ratedSongCount', 'showCount', 'songCount', 'statsVersion', 'venueCount']);
  assert.strictEqual(p.rank, 2);
  assert.strictEqual(publicStats(computeUserStats(FIXTURE)).rank, null);
});

test('keys match the app: songKey = songTitleKey, bandKey = artistNameKeyLoose', () => {
  const songs = ['Ashes//Dust', 'Ashes // Dust', 'The Weight - Live', 'Tweezer (Remastered 2009)', '  Arcadia ', '', null, 'Déjà Vu', 'Run Like an Antelope ->'];
  for (const s of songs) assert.strictEqual(songKey(s), songTitleKey(s), String(s));
  const bands = ['Goose', 'goose (US)', 'The Band', 'Band', "Umphrey's McGee", 'King Gizzard & the Lizard Wizard', '[live] Phish', '', null];
  for (const b of bands) assert.strictEqual(bandKey(b), artistNameKeyLoose(b), String(b));
});

test('isRanked: real accounts with shows only', () => {
  const s = { showCount: 3 };
  assert.ok(isRanked({}, s));
  assert.ok(!isRanked({ isTestUser: true }, s));
  assert.ok(!isRanked({ banned: true }, s));
  assert.ok(!isRanked({}, { showCount: 0 }));
  assert.ok(!isRanked({}, null));
});

test('rankUsers: highest first, ties share a rank (1, 2, 2, 4)', () => {
  const r = rankUsers([{ uid: 'a', showCount: 10 }, { uid: 'b', showCount: 7 }, { uid: 'c', showCount: 7 }, { uid: 'd', showCount: 2 }]);
  assert.deepStrictEqual([...r.entries()].map(([u, v]) => [u, v.rank, v.of]), [['a', 1, 4], ['b', 2, 4], ['c', 2, 4], ['d', 4, 4]]);
  assert.strictEqual(rankUsers([]).size, 0);
});

for (const t of tests) {
  try { await t.fn(); passed++; } catch (err) { failed++; console.error(`✗ ${t.name}\n  ${err.message}`); }
}
console.log(`\nstats: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
