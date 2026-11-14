/**
 * The Year in Review golden fixtures (fixtures/year-in-review/*.json,
 * 5.60.4): each holds a user's shows, a year, and the exact output of both
 * calculators — computeYearInReview (lib/yearInReviewStats.js, the
 * /year-in-review page and the public copy the server writes) and
 * computeYearRecap (lib/yearRecap.js, the 2026 recap, banner and Stats
 * card). The Swift app tests against the same files.
 *
 * Also checked on every fixture:
 *   - the same output in three time zones (a show's day never shifts)
 *   - both calculators agree on shows, bands and venues
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/yearInReviewFixtures.test.js
 *
 * To regenerate after a deliberate change to a calculator (then read the
 * diff — every changed number is a change users see):
 *   UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/yearInReviewFixtures.test.js
 */

import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { computeYearInReview } from '@/lib/yearInReviewStats';
import { computeYearRecap } from '@/lib/yearRecap';

const DIR = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'year-in-review');
const ZONES = ['America/Los_Angeles', 'UTC', 'Pacific/Auckland'];
const UPDATE = process.env.UPDATE_FIXTURES === '1';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

// What both calculators return, through JSON: the fixture files hold JSON,
// and a missing field (a show with no city) is left out, as Firestore and
// a Swift decoder see it.
function compute(fixture) {
  return JSON.parse(JSON.stringify({
    yearInReview: computeYearInReview(fixture.shows, fixture.year),
    recap: computeYearRecap(fixture.shows, fixture.year),
  }));
}

function inZone(zone, fn) {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try { return fn(); } finally { process.env.TZ = before; }
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();

test('there are fixtures to check', () => assert.ok(files.length >= 7, `found ${files.length}`));

for (const file of files) {
  const full = path.join(DIR, file);
  const fixture = JSON.parse(fs.readFileSync(full, 'utf8'));
  const outputs = ZONES.map((zone) => inZone(zone, () => compute(fixture)));

  if (UPDATE) {
    fs.writeFileSync(full, `${JSON.stringify({ ...fixture, expected: outputs[1] }, null, 2)}\n`);
    console.log(`  wrote ${file}`);
    continue;
  }

  test(`${file}: matches the expected output`, () => {
    assert.ok(fixture.expected, 'no `expected` in the fixture (run with UPDATE_FIXTURES=1)');
    assert.deepStrictEqual(outputs[1], fixture.expected);
  });

  test(`${file}: the same in every time zone`, () => {
    ZONES.forEach((zone, i) => assert.deepStrictEqual(outputs[i], outputs[1], zone));
  });

  test(`${file}: both calculators count the same shows, bands and venues`, () => {
    const { yearInReview: yir, recap } = outputs[1];
    if (yir === null || recap === null) {
      assert.strictEqual(yir, recap);
      return;
    }
    assert.strictEqual(yir.totalShows, recap.totalShows, 'shows');
    assert.strictEqual(yir.totalArtists, recap.totalBands, 'bands');
    assert.strictEqual(yir.totalVenues, recap.totalVenues, 'venues');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
