/**
 * Unit tests for lib/songIndex.js — gap arithmetic, song identity, and
 * missing-set-data handling.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/songIndex.test.js
 *
 * Unlike lib/__tests__/popupManager.test.js, this imports the real ES module
 * (via alias-loader.mjs, which resolves this repo's `@/foo` path alias for
 * plain `node`) instead of re-implementing its logic, so a change to the
 * actual gap/identity math is what these tests catch.
 */

import assert from 'assert';
import { buildSongIndex, songKeyFor } from '@/lib/songIndex';
import { countSongsByShow, buildSongStats } from '@/lib/songCounts';

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

function song(name, overrides = {}) {
  return { id: overrides.id || `${name}-${Math.random()}`, name, ...overrides };
}

function show(id, date, artist, setlist) {
  return { id, date, artist, venue: `Venue ${id}`, city: 'City', setlist };
}

// ── Gap arithmetic: three boundaries ────────────────────────────────────

test('gap boundary: seen at the most recent show → currentGap.shows === 0', () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [song('Sample in a Jar')]),
    show('s2', '2023-06-01', 'Phish', [song('Divided Sky')]),
    show('s3', '2024-01-01', 'Phish', [song('Sample in a Jar')]),
  ];
  const index = buildSongIndex(shows);
  const key = songKeyFor('Phish', 'Sample in a Jar');
  assert.strictEqual(index[key].currentGap.shows, 0);
  assert.strictEqual(index[key].timesSeen, 2);
});

test('gap boundary: seen only once ever, mid-history → currentGap counts subsequent shows, no longestGap', () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [song('Divided Sky')]),
    show('s2', '2023-06-01', 'Phish', [song('Fluffhead')]), // the one-time song
    show('s3', '2024-01-01', 'Phish', [song('Divided Sky')]),
    show('s4', '2024-06-01', 'Phish', [song('Divided Sky')]),
  ];
  const index = buildSongIndex(shows);
  const key = songKeyFor('Phish', 'Fluffhead');
  assert.strictEqual(index[key].timesSeen, 1);
  // 4 total shows, played at index 1 (0-based) -> 2 shows since (indices 2, 3)
  assert.strictEqual(index[key].currentGap.shows, 2);
  assert.strictEqual(index[key].longestGap, null);
});

test("gap boundary: seen at the user's first-ever show for that artist → currentGap counts every show since, no off-by-one", () => {
  const shows = [
    show('s1', '2020-01-01', 'Phish', [song('Wilson')]), // first-ever show, has the song
    show('s2', '2021-01-01', 'Phish', [song('Divided Sky')]),
    show('s3', '2022-01-01', 'Phish', [song('Divided Sky')]),
    show('s4', '2023-01-01', 'Phish', [song('Divided Sky')]),
  ];
  const index = buildSongIndex(shows);
  const key = songKeyFor('Phish', 'Wilson');
  // played at artist-show-index 0 of 4 total shows -> 3 shows since, not 4 and not 2
  assert.strictEqual(index[key].currentGap.shows, 3);
});

test('longestGap is measured between two real performances, not including the open-ended current gap', () => {
  const shows = [
    show('s1', '2020-01-01', 'Phish', [song('Harry Hood')]),
    show('s2', '2021-01-01', 'Phish', [song('Divided Sky')]),
    show('s3', '2022-01-01', 'Phish', [song('Divided Sky')]),
    show('s4', '2023-01-01', 'Phish', [song('Harry Hood')]), // 2 shows between the two Hoods
    show('s5', '2024-01-01', 'Phish', [song('Divided Sky')]),
  ];
  const index = buildSongIndex(shows);
  const key = songKeyFor('Phish', 'Harry Hood');
  assert.strictEqual(index[key].longestGap.shows, 2);
  // current gap since the 2nd Hood (index 3 of 5 shows) is 1 show
  assert.strictEqual(index[key].currentGap.shows, 1);
});

// ── Song identity: spelling merges, artists stay separate ───────────────

test('two spellings of the same song merge into one entry', () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [song('Ashes//Dust')]),
    show('s2', '2023-06-01', 'Phish', [song('Ashes // Dust')]),
  ];
  const index = buildSongIndex(shows);
  const key = songKeyFor('Phish', 'Ashes//Dust');
  assert.strictEqual(Object.keys(index).length, 1);
  assert.strictEqual(index[key].timesSeen, 2);
});

test('same title, two different artists, stay on two separate entries', () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [song('Wilson')]),
    show('s2', '2023-06-01', 'The Allman Brothers Band', [song('Wilson')]),
  ];
  const index = buildSongIndex(shows);
  const phishKey = songKeyFor('Phish', 'Wilson');
  const abbKey = songKeyFor('The Allman Brothers Band', 'Wilson');
  assert.notStrictEqual(phishKey, abbKey);
  assert.strictEqual(index[phishKey].timesSeen, 1);
  assert.strictEqual(index[abbKey].timesSeen, 1);
});

// ── Missing set data ──────────────────────────────────────────────────

test('a performance with no set data anywhere in the show gets setLabel: null, not dropped or mislabeled "Set I"', () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [song('Bathtub Gin')]), // no `set`/`setBreak` field at all
  ];
  const index = buildSongIndex(shows);
  const key = songKeyFor('Phish', 'Bathtub Gin');
  assert.strictEqual(index[key].performances.length, 1);
  assert.strictEqual(index[key].performances[0].setLabel, null);
});

test('a performance that does carry set data keeps its label', () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [
      song('Chalk Dust Torture', { set: 'Set I' }),
      song('Bathtub Gin', { set: 'Set II' }),
    ]),
  ];
  const index = buildSongIndex(shows);
  const key = songKeyFor('Phish', 'Bathtub Gin');
  assert.strictEqual(index[key].performances[0].setLabel, 'Set II');
});

// ── Manually-added songs count identically ──────────────────────────────

test('a manually-added performance counts fully toward timesSeen and gap, same as an imported one', () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [song('Reba')]),
    show('s2', '2023-06-01', 'Phish', [song('Divided Sky')]),
    show('s3', '2024-01-01', 'Phish', [song('Reba', { manuallyAdded: true })]),
  ];
  const index = buildSongIndex(shows);
  const key = songKeyFor('Phish', 'Reba');
  assert.strictEqual(index[key].timesSeen, 2);
  assert.strictEqual(index[key].currentGap.shows, 0);
  assert.strictEqual(index[key].performances.some(p => p.manuallyAdded), true);
});

// ── Performance list: order, completeness, no duplicates ────────────────

test('performances are reverse-chronological, complete, and not duplicated', () => {
  const shows = [
    show('s1', '2022-01-01', 'Phish', [song('Reba')]),
    show('s2', '2023-01-01', 'Phish', [song('Divided Sky')]),
    show('s3', '2024-01-01', 'Phish', [song('Reba')]),
    show('s4', '2024-06-01', 'Phish', [song('Reba')]),
  ];
  const index = buildSongIndex(shows);
  const perfs = index[songKeyFor('Phish', 'Reba')].performances;
  assert.deepStrictEqual(perfs.map(p => p.showId), ['s4', 's3', 's1']);
  assert.strictEqual(new Set(perfs.map(p => p.showId)).size, perfs.length);
});

test('one performance ever still produces a one-row list, never an empty one', () => {
  const shows = [show('s1', '2023-01-01', 'Phish', [song('Fluffhead')])];
  const index = buildSongIndex(shows);
  assert.strictEqual(index[songKeyFor('Phish', 'Fluffhead')].performances.length, 1);
});

test('every indexed song has at least one performance — there is no zero-performance row to render', () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [song('Reba'), song('Wilson')]),
    show('s2', '2023-06-01', 'Goose', [song('Arrow')]),
  ];
  const index = buildSongIndex(shows);
  assert.strictEqual(Object.keys(index).length, 3);
  Object.values(index).forEach(s => assert.ok(s.performances.length >= 1, `${s.key} has no performances`));
});

test('a song played twice in one show keeps both performances but counts as one show seen', () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [
      song('Tweezer', { id: 'a', set: 'Set II' }),
      song('Tweezer Reprise', { id: 'b', set: 'Encore' }),
      song('Tweezer', { id: 'c', set: 'Encore' }),
    ]),
  ];
  const index = buildSongIndex(shows);
  const entry = index[songKeyFor('Phish', 'Tweezer')];
  assert.strictEqual(entry.timesSeen, 1);
  assert.deepStrictEqual(entry.performances.map(p => p.setLabel), ['Set II', 'Encore']);
});

// ── Sandwiches: times seen is distinct shows ────────────────────────────

test('a sandwich (song > other song > song) counts once toward timesSeen', () => {
  // Goose, 2023-07-14: Arcadia > Turned Clouds > Arcadia shape.
  const shows = [
    show('g1', '2023-07-14', 'Goose', [
      song('Arcadia', { id: 'a1', set: 'Set II', tape: true }),
      song('Turned Clouds', { id: 't1', set: 'Set II', tape: true }),
      song('Arcadia', { id: 'a2', set: 'Set II' }),
    ]),
    show('g2', '2023-07-15', 'Goose', [song('Arcadia', { id: 'a3' })]),
  ];
  const entry = buildSongIndex(shows)[songKeyFor('Goose', 'Arcadia')];
  assert.strictEqual(entry.timesSeen, 2);
  assert.strictEqual(entry.performances.length, 3);
});

test('a sandwich never produces a negative longestGap', () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [song('Tweezer'), song('Fee'), song('Tweezer')]),
  ];
  const entry = buildSongIndex(shows)[songKeyFor('Phish', 'Tweezer')];
  assert.strictEqual(entry.longestGap, null);
});

test('gaps are measured between shows, ignoring a repeat within one show', () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [song('Tweezer'), song('Fee'), song('Tweezer')]),
    show('s2', '2023-01-02', 'Phish', [song('Fee')]),
    show('s3', '2023-01-03', 'Phish', [song('Tweezer')]),
  ];
  const entry = buildSongIndex(shows)[songKeyFor('Phish', 'Tweezer')];
  assert.strictEqual(entry.timesSeen, 2);
  assert.strictEqual(entry.longestGap.shows, 1);
  assert.strictEqual(entry.currentGap.shows, 0);
});

test('lib/songCounts: countSongsByShow and buildSongStats count a sandwich once', () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [song('Tweezer'), song('Fee'), song('Tweezer')]),
    show('s2', '2023-01-02', 'Phish', [song('Tweezer')]),
  ];
  const counts = countSongsByShow(shows);
  assert.strictEqual(counts.tweezer, 2);
  assert.strictEqual(counts.fee, 1);
  const stats = buildSongStats(shows);
  const tweezer = stats.find(s => s.name === 'Tweezer');
  assert.strictEqual(tweezer.count, 2);
  // Both halves of the sandwich stay listed as performances.
  assert.strictEqual(tweezer.shows.length, 3);
});

// ── Segues ──────────────────────────────────────────────────────────────

test("a song's segue-out is its own `tape` flag and its segue-in is the previous song's", () => {
  const shows = [
    show('s1', '2023-01-01', 'Phish', [
      song('Mike\'s Song', { id: 'a', set: 'Set II', tape: true }),
      song('I Am Hydrogen', { id: 'b', set: 'Set II', tape: true }),
      song('Weekapaug Groove', { id: 'c', set: 'Set II' }),
    ]),
  ];
  const index = buildSongIndex(shows);
  const mikes = index[songKeyFor('Phish', "Mike's Song")].performances[0];
  const hydrogen = index[songKeyFor('Phish', 'I Am Hydrogen')].performances[0];
  const weekapaug = index[songKeyFor('Phish', 'Weekapaug Groove')].performances[0];

  assert.strictEqual(mikes.segueIn, false);
  assert.strictEqual(mikes.segueOut, true);
  assert.strictEqual(hydrogen.segueIn, true);
  assert.strictEqual(hydrogen.segueOut, true);
  assert.strictEqual(weekapaug.segueIn, true);
  assert.strictEqual(weekapaug.segueOut, false);
});

// ── Summary ─────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
