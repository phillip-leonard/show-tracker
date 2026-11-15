/**
 * The upcoming-show golden fixtures (5.60.22, native Stage 1):
 * fixtures/upcoming-shows/. The web writes these documents through
 * AppContext with lib/upcomingShows.js; the native app writes the same ones
 * directly (docs/ios-native/DECISIONS.md, "Stage 1"), and its tests read
 * the same files. A change here is a change to what both apps store.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/upcomingFixtures.test.js
 * Regenerate `expected` after a deliberate change (then read the diff):
 *   UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/upcomingFixtures.test.js
 */

import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  newUpcomingRecord, upcomingUpdate, validateUpcomingInput, findDuplicateUpcoming, isValidIsoDate,
} from '@/lib/upcomingShows';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
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

const json = (v) => JSON.parse(JSON.stringify(v));

function runFile(name, compute) {
  const file = path.join(ROOT, 'fixtures/upcoming-shows', `${name}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = false;
  for (const c of data.cases) {
    const actual = json(compute(c, data));
    test(`${name}.json: ${c.name}`, () => {
      if (UPDATE) {
        if (JSON.stringify(c.expected) !== JSON.stringify(actual)) { c.expected = actual; changed = true; }
      } else {
        assert.deepStrictEqual(c.expected, actual);
      }
    });
  }
  if (UPDATE && changed) {
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`  (updated ${name}.json)`);
  }
  return data;
}

console.log('\nUpcoming-show fixtures (fixtures/upcoming-shows)');

const DOC_KEYS = ['artist', 'venue', 'city', 'date', 'time', 'notes', 'source', 'sourceEventId', 'ticketUrl',
  'taggedFriendUids', 'taggedBy', 'taggedByUid', 'originUpcomingId', 'createdAt', 'updatedAt'].sort();

const created = runFile('create', (c, d) => newUpcomingRecord(c.input, c.extra, d.now));
runFile('update', (c, d) => upcomingUpdate(c.input, d.now));
runFile('validate', (c, d) => validateUpcomingInput(c.input, d.today));
runFile('duplicate', (c, d) => findDuplicateUpcoming(d.existing, c.input)?.id || null);

test('every new document has exactly the documented fields, every optional one explicit', () => {
  for (const c of created.cases) {
    assert.deepStrictEqual(Object.keys(c.expected).sort(), DOC_KEYS, c.name);
    for (const k of ['time', 'sourceEventId', 'ticketUrl', 'taggedBy', 'taggedByUid', 'originUpcomingId']) {
      assert.ok(c.expected[k] === null || typeof c.expected[k] === 'string', `${c.name}: ${k}`);
    }
    assert.ok(['manual', 'ticketmaster', 'seatgeek'].includes(c.expected.source), c.name);
    assert.ok(isValidIsoDate(c.expected.date), `${c.name}: date is an ISO day`);
    assert.ok(c.expected.notes.length <= 1000, c.name);
  }
});

test('an edit writes no tag fields and no createdAt', () => {
  const file = path.join(ROOT, 'fixtures/upcoming-shows/update.json');
  for (const c of JSON.parse(fs.readFileSync(file, 'utf8')).cases) {
    for (const k of ['taggedFriendUids', 'taggedBy', 'taggedByUid', 'originUpcomingId', 'createdAt']) {
      assert.ok(!(k in c.expected), `${c.name}: ${k}`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
