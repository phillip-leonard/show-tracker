/**
 * Push alerts, the client's half (5.49.0):
 *   - lib/alertChannels.js reads every saved shape of an alert's prefs the
 *     same way as the job's prefFor (netlify/functions/lib/followedBandAlerts.js)
 *   - switching one channel leaves the other alone and keeps `method` in step
 *   - every link a push can carry opens a screen the app knows
 *     (lib/deepLinks.js), on the route the brief asks for
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/alertChannels.test.js
 */

import assert from 'assert';
import { createRequire } from 'module';
import { alertChannels, withChannel } from '@/lib/alertChannels';
import { deepLinkTarget } from '@/lib/deepLinks';

const require = createRequire(import.meta.url);
const server = require('../../netlify/functions/lib/followedBandAlerts.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

const SHAPES = [
  undefined,
  {},
  { enabled: true },
  { method: 'both' },
  { method: 'push' },
  { method: 'email' },
  { method: 'none' },
  { method: 'both', push: false },
  { method: 'email', push: true, email: false },
  { push: false, email: false },
];

test('client and job read every saved shape the same way', () => {
  for (const pref of SHAPES) {
    const job = server.prefFor({ notificationPrefs: { followedBands: pref } }, 'followedBands');
    assert.deepStrictEqual(alertChannels(pref), { push: job.push, email: job.email }, JSON.stringify(pref));
  }
});

test('switching push off leaves email on, and writes method for older readers', () => {
  const next = withChannel({ enabled: true, method: 'both' }, 'push', false);
  assert.deepStrictEqual(next, { enabled: true, method: 'email', push: false, email: true });
  const neither = withChannel(next, 'email', false);
  assert.strictEqual(neither.method, 'none');
  assert.deepStrictEqual(alertChannels(neither), { push: false, email: false });
  const back = withChannel(neither, 'push', true);
  assert.deepStrictEqual(alertChannels(back), { push: true, email: false });
  assert.strictEqual(back.method, 'push');
});

test('a tour push opens the band screen; others open Notifications', () => {
  const tour = (name) => server.pushFor({
    kind: 'tour', band: { key: name.toLowerCase(), name }, dates: [{ id: 'a', date: '2027-04-01' }],
  }).link;
  assert.strictEqual(deepLinkTarget(tour('Goose')), '/bands/?band=goose');
  assert.strictEqual(deepLinkTarget(tour('Billy Strings')), '/bands/?band=billy-strings');
  assert.strictEqual(deepLinkTarget(tour('A Band With No Screen')), '/notifications/');
  const venue = server.pushFor({
    kind: 'venue', band: { key: 'goose', name: 'Goose' }, event: { id: 'e', date: '2027-06-03', venue: 'Red Rocks' },
  }).link;
  assert.strictEqual(deepLinkTarget(venue), '/notifications/');
});

console.log(`alertChannels: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
