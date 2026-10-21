// lib/__tests__/heardMatchParity.test.js
//
// The "Songs I've heard" tool matches a user's logged shows to archive
// shows in netlify/functions/lib/heardRecord.js, which runs in a page with
// no build step and so carries its own copy of lib/utils.js's
// venuesFuzzyMatch. This holds the copy to the original.
//
//   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/heardMatchParity.test.js

import assert from 'node:assert';
import { createRequire } from 'node:module';
import { venuesFuzzyMatch } from '@/lib/utils';

const require = createRequire(import.meta.url);
const heard = require('../../netlify/functions/lib/heardRecord.js');

const pairs = [
  ['Red Rocks Amphitheatre', 'Red Rocks Amphitheatre'],
  ["Dick's Sporting Goods Park", 'Dicks Sporting Goods Park'],
  ['Dick’s Sporting Goods Park', "Dick's Sporting Goods Park"],
  ['Madison Square Garden', 'madison square garden, NYC'],
  ['The Capitol Theatre', 'Capitol Theatre'],
  ['Red Rocks Amphitheatre', 'Red Rocks Park and Amphitheater'],
  ['Saenger Theatre', 'Saenger Performing Arts Theater'],
  ['', 'Anything'],
  ['   ', ''],
  ['MSG', 'Madison Square Garden'],
  ['Élysée Montmartre', 'Elysée-Montmartre'],
];

let failed = 0;
for (const [a, b] of pairs) {
  for (const [x, y] of [[a, b], [b, a]]) {
    try {
      assert.strictEqual(heard.venuesFuzzyMatch(x, y), venuesFuzzyMatch(x, y));
    } catch {
      failed++;
      console.log(`  ✗ ${JSON.stringify(x)} vs ${JSON.stringify(y)}: heard ${heard.venuesFuzzyMatch(x, y)}, app ${venuesFuzzyMatch(x, y)}`);
    }
  }
}
console.log(`${pairs.length * 2 - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
