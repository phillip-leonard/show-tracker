/**
 * fixtures/user-stats/ and fixtures/stats-keys/ — the stats contract the
 * native app reads (5.60.27, Stage 2).
 *
 *   user-stats/*.json  shows in, the userStats numbers out (lib/stats
 *                      computeUserStats): what the server writes and the
 *                      Swift UserStats model decodes.
 *   stats-keys/keys.json  the identity keys behind those numbers (one band,
 *                      one song, one venue), which the native app uses to
 *                      list your shows for a band, song or venue.
 *
 * Run with:
 *   node lib/__tests__/statsFixtures.test.js
 * Regenerate after a deliberate change, then read the diff:
 *   UPDATE_FIXTURES=1 node lib/__tests__/statsFixtures.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { computeUserStats } = require('../stats');
const { bandKey, songKey } = require('../stats/keys');
const { venueCountKey } = require('../venueCount');

const ROOT = path.join(__dirname, '..', '..');
const UPDATE = process.env.UPDATE_FIXTURES === '1';

let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; } catch (e) { failed += 1; console.error(`✗ ${name}\n  ${e.message}`); }
};

const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// ── user-stats ─────────────────────────────────────────────────────────

const statsDir = path.join(ROOT, 'fixtures', 'user-stats');
for (const name of fs.readdirSync(statsDir).filter((f) => f.endsWith('.json')).sort()) {
  const file = path.join(statsDir, name);
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  test(`user-stats/${name}`, () => {
    const actual = computeUserStats(fixture.shows);
    if (UPDATE) { write(file, { ...fixture, expected: actual }); return; }
    assert.deepStrictEqual(actual, fixture.expected);
  });
}

// ── stats-keys ─────────────────────────────────────────────────────────

const keysFile = path.join(ROOT, 'fixtures', 'stats-keys', 'keys.json');
const keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
test('stats-keys/keys.json', () => {
  const actual = {
    ...keys,
    band: keys.band.map(([input]) => [input, bandKey(input)]),
    song: keys.song.map(([input]) => [input, songKey(input)]),
    venue: keys.venue.map(([show]) => [show, venueCountKey(show)]),
  };
  if (UPDATE) { write(keysFile, actual); return; }
  assert.deepStrictEqual(actual, keys);
});

console.log(`\nstats fixtures: ${passed} passed, ${failed} failed${UPDATE ? ' (fixtures updated)' : ''}`);
if (failed) process.exit(1);
