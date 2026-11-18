/**
 * fixtures/song-index/, fixtures/runs/ and fixtures/user-count/ — the
 * Stage 4 library contract the native app tests against (5.60.32).
 *
 *   song-index/gaps.json   shows in, lib/songIndex.js buildSongIndex out:
 *                          the song page's times seen, first and last,
 *                          current and longest gap, performances.
 *   song-index/keys.json   the song page's identity: artistSlugFromName,
 *                          songSlugFromTitle, songKeyFor, songKeyFromParams.
 *   runs/*.json            shows in, lib/runIndex.js buildRunIndex,
 *                          buildTourIndex and newSongsOnTour out, plus
 *                          lib/showIdentity.js venuesFuzzyMatch pairs.
 *   user-count/threshold.json  lib/userCount.js shouldShowUserCount.
 *
 * Run with:
 *   node lib/__tests__/libraryFixtures.test.js
 * Regenerate after a deliberate change, then read the diff:
 *   UPDATE_FIXTURES=1 node lib/__tests__/libraryFixtures.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildSongIndex, artistSlugFromName, songSlugFromTitle, songKeyFor, songKeyFromParams } = require('../songIndex');
const { buildRunIndex, buildTourIndex, newSongsOnTour } = require('../runIndex');
const { venuesFuzzyMatch } = require('../showIdentity');
const { shouldShowUserCount, USER_COUNT_MIN_USERS } = require('../userCount');

const ROOT = path.join(__dirname, '..', '..');
const UPDATE = process.env.UPDATE_FIXTURES === '1';

let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; } catch (e) { failed += 1; console.error(`✗ ${name}\n  ${e.message}`); }
};

const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', rel), 'utf8'));
const write = (rel, value) => fs.writeFileSync(path.join(ROOT, 'fixtures', rel), `${JSON.stringify(value, null, 2)}\n`);
// The fixture as JSON would carry it: no undefined, Sets and Maps already gone.
const plain = (value) => JSON.parse(JSON.stringify(value));

function check(rel, fixture, actual) {
  if (UPDATE) { write(rel, actual); return; }
  assert.deepStrictEqual(actual, fixture);
}

// ── song-index ─────────────────────────────────────────────────────────

test('song-index/gaps.json', () => {
  const fx = read('song-index/gaps.json');
  check('song-index/gaps.json', fx, { ...fx, expected: plain(buildSongIndex(fx.shows, { today: fx.today })) });
});

test('song-index/keys.json', () => {
  const fx = read('song-index/keys.json');
  check('song-index/keys.json', fx, {
    ...fx,
    artistSlug: fx.artistSlug.map(([name]) => [name, artistSlugFromName(name)]),
    songSlug: fx.songSlug.map(([title]) => [title, songSlugFromTitle(title)]),
    songKey: fx.songKey.map(([artist, title]) => [artist, title, songKeyFor(artist, title)]),
    songKeyFromParams: fx.songKeyFromParams.map(([artistId, slug]) => [artistId, slug, songKeyFromParams(artistId, slug)]),
  });
});

// ── runs ───────────────────────────────────────────────────────────────

const runsDir = path.join(ROOT, 'fixtures', 'runs');
for (const name of fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort()) {
  const rel = `runs/${name}`;
  test(rel, () => {
    const fx = read(rel);
    const songIndex = buildSongIndex(fx.shows, { today: fx.today });
    const tours = buildTourIndex(fx.shows);
    const newSongs = {};
    Object.keys(tours).forEach((key) => { newSongs[key] = newSongsOnTour(tours[key], songIndex); });
    check(rel, fx, {
      ...fx,
      venuePairs: fx.venuePairs.map(([a, b]) => [a, b, venuesFuzzyMatch(a, b)]),
      expected: plain({ runs: buildRunIndex(fx.shows), tours, newSongsOnTour: newSongs }),
    });
  });
}

// ── user-count ─────────────────────────────────────────────────────────

test('user-count/threshold.json', () => {
  const fx = read('user-count/threshold.json');
  check('user-count/threshold.json', fx, {
    ...fx,
    minUsers: USER_COUNT_MIN_USERS,
    cases: fx.cases.map(([total]) => [total, shouldShowUserCount(total)]),
  });
});

console.log(`library fixtures: ${passed} passed, ${failed} failed${UPDATE ? ' (fixtures updated)' : ''}`);
if (failed) process.exit(1);
