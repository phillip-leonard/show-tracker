/**
 * Parity tests: netlify/functions/lib/artistSnapshotStats.js must count
 * plays and gaps exactly the way lib/songIndex.js does.
 *
 * WHY THIS FILE EXISTS. The public band and song pages compute times played,
 * first/last played, current gap and longest gap in a Netlify function,
 * which can't import lib/songIndex.js (an ES module whose imports reach the
 * Firebase client SDK). So the arithmetic exists twice, and a "current gap"
 * on a public song page has to mean the same as on a signed-in user's own
 * song page. These tests run both over the same shows and compare every
 * song.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/artistSnapshotStatsParity.test.js
 */

import assert from 'assert';
import { createRequire } from 'module';
import { buildSongIndex } from '@/lib/songIndex';
import { normalizeSongTitle } from '@/lib/utils';

const require = createRequire(import.meta.url);
const { buildArtistStats } = require('../../netlify/functions/lib/artistSnapshotStats.js');

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

// Deterministic pseudo-random, so a failure reproduces.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const POOL = ['Arcadia', 'Hot Tea', 'Madhuvan', 'Tumble', 'Rockdale', 'Jive I', 'Jive II', 'Turned Clouds', 'Dripfield', 'So Ready', 'Echo of a Rose', 'Yeti', 'Butter Rum', 'Silver Rising', 'Flodown'];

function fixture(seed, count) {
  const rand = rng(seed);
  const shows = [];
  const start = Date.UTC(2019, 0, 1);
  for (let i = 0; i < count; i++) {
    const date = new Date(start + i * 3 * 86400000).toISOString().slice(0, 10);
    const n = 3 + Math.floor(rand() * 8);
    const titles = [];
    for (let j = 0; j < n; j++) titles.push(POOL[Math.floor(rand() * rand() * POOL.length)]);
    // A sandwich now and then: the same song twice in one show.
    if (rand() < 0.15) titles.push(titles[0]);
    shows.push({ id: `show-${i}`, date, venue: `Venue ${i}`, city: 'City', titles });
  }
  return shows;
}

function asUserShows(shows) {
  return shows.map((s) => ({
    id: s.id, artist: 'Goose', date: s.date, venue: s.venue, city: s.city,
    setlist: s.titles.map((name, i) => ({ id: `${s.id}-${i}`, name })),
  }));
}

function asSnapshotShows(shows) {
  return shows.map((s) => ({
    id: s.id, date: s.date, venue: s.venue, city: s.city,
    songs: s.titles.map((name) => ({ key: normalizeSongTitle(name), slug: '', name })),
  }));
}

function compare(shows) {
  const index = buildSongIndex(asUserShows(shows));
  const { songs } = buildArtistStats(asSnapshotShows(shows));
  const byKey = new Map(songs.map((s) => [s.key, s]));

  assert.strictEqual(songs.length, Object.keys(index).length, 'same number of songs');
  for (const entry of Object.values(index)) {
    const key = entry.key.split(':').slice(1).join(':');
    const s = byKey.get(key);
    assert.ok(s, `snapshot has ${entry.title}`);
    assert.strictEqual(s.timesPlayed, entry.timesSeen, `${entry.title} times played`);
    assert.strictEqual(s.firstPlayed.date, entry.firstSeen.date, `${entry.title} first played`);
    assert.strictEqual(s.lastPlayed.date, entry.lastSeen.date, `${entry.title} last played`);
    assert.strictEqual(s.currentGap, entry.currentGap.shows, `${entry.title} current gap`);
    // The one deliberate difference: a public longest gap counts the show
    // the song came back at, as phish.net and the Songfish sites do; see
    // artistSnapshotStats.js. Same two shows either side of it.
    assert.strictEqual(s.longestGap, entry.longestGap ? entry.longestGap.shows + 1 : null, `${entry.title} longest gap`);
    assert.strictEqual(s.gapStart ? s.gapStart.date : null, entry.longestGap ? entry.longestGap.fromDate : null, `${entry.title} gap start`);
    assert.strictEqual(s.gapEnd ? s.gapEnd.date : null, entry.longestGap ? entry.longestGap.toDate : null, `${entry.title} gap end`);
  }
}

console.log('\nartistSnapshotStats ↔ songIndex parity');

test('random histories agree song by song', () => {
  for (const seed of [1, 7, 42, 2024, 99991]) compare(fixture(seed, 80));
});

test('a song played once has no longest or average gap', () => {
  const shows = [
    { id: 'a', date: '2024-01-01', venue: 'V', city: 'C', titles: ['Arcadia'] },
    { id: 'b', date: '2024-01-02', venue: 'V', city: 'C', titles: ['Hot Tea'] },
  ];
  compare(shows);
  const { songs } = buildArtistStats(asSnapshotShows(shows));
  const arcadia = songs.find((s) => s.name === 'Arcadia');
  assert.strictEqual(arcadia.longestGap, null);
  assert.strictEqual(arcadia.averageGap, null);
  assert.strictEqual(arcadia.currentGap, 1);
});

test('a sandwich is one show played, not two', () => {
  const shows = [
    { id: 'a', date: '2024-01-01', venue: 'V', city: 'C', titles: ['Tumble', 'Arcadia', 'Tumble'] },
    { id: 'b', date: '2024-01-02', venue: 'V', city: 'C', titles: ['Tumble'] },
  ];
  compare(shows);
  const tumble = buildArtistStats(asSnapshotShows(shows)).songs.find((s) => s.name === 'Tumble');
  assert.strictEqual(tumble.timesPlayed, 2);
  // Played at back-to-back shows: back after 1 show, as phish.net counts it.
  assert.strictEqual(tumble.longestGap, 1);
});

test('input order does not matter', () => {
  const shows = fixture(5, 40);
  const reversed = shows.slice().reverse();
  assert.deepStrictEqual(buildArtistStats(asSnapshotShows(reversed)), buildArtistStats(asSnapshotShows(shows)));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
