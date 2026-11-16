/**
 * fixtures/recap-launch/window.json — when "Your 2026 in review" is promoted
 * (5.60.27, Stage 2 C-9). lib/recapLaunch.js is an ES module the web and
 * the Capacitor app bundle; the native app reads the same dates from this
 * fixture, and this test fails if the two disagree.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/recapLaunchFixture.test.js
 * Regenerate after a deliberate change to lib/recapLaunch.js:
 *   UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/recapLaunchFixture.test.js
 */

import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RECAP_YEAR, RECAP_LAUNCH_AT, RECAP_PROMO_ENDS_AT, RECAP_FORCE_LIVE, recapPromoActive, recapHref,
} from '@/lib/recapLaunch';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = path.join(ROOT, 'fixtures', 'recap-launch', 'window.json');
const UPDATE = process.env.UPDATE_FIXTURES === '1';

const fixture = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const actual = {
  ...fixture,
  year: RECAP_YEAR,
  promoStartsAt: new Date(RECAP_LAUNCH_AT).toISOString(),
  promoEndsAt: new Date(RECAP_PROMO_ENDS_AT).toISOString(),
  path: recapHref(),
  cases: fixture.cases.map(([at]) => [at, recapPromoActive(Date.parse(at))]),
};

let failed = 0;
try {
  // A forced-live test build must never write the fixture.
  assert.strictEqual(RECAP_FORCE_LIVE, false, 'RECAP_FORCE_LIVE is on in lib/recapLaunch.js');
  if (UPDATE) fs.writeFileSync(FILE, `${JSON.stringify(actual, null, 2)}\n`);
  else assert.deepStrictEqual(actual, fixture);
} catch (e) {
  failed = 1;
  console.error(`✗ recap-launch/window.json\n  ${e.message}`);
}
console.log(`\nrecap launch fixture: ${1 - failed} passed, ${failed} failed${UPDATE ? ' (fixture updated)' : ''}`);
if (failed) process.exit(1);
