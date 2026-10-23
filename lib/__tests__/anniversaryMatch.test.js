// lib/__tests__/anniversaryMatch.test.js
//
// The daily anniversary job matches month-days in
// netlify/functions/lib/anniversaryMatch.js (CommonJS). This checks its
// rule, and that the isoDate it reads dates through agrees with
// lib/utils.js's toIsoDate, which the app uses to display the same dates.
//
//   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/anniversaryMatch.test.js

import assert from 'node:assert';
import { createRequire } from 'node:module';
import { toIsoDate } from '@/lib/utils';

const require = createRequire(import.meta.url);
const { utcIsoDate, anniversaryYearsAgo } = require('../../netlify/functions/lib/anniversaryMatch.js');
const { isoDate } = require('../../netlify/functions/lib/publicPageHtml.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

test('YYYY-MM-DD on today\'s month and day in an earlier year', () => {
  assert.strictEqual(anniversaryYearsAgo('2019-10-23', '2026-10-23'), 7);
});

test('DD-MM-YYYY (ticket scanner) matches too', () => {
  assert.strictEqual(anniversaryYearsAgo('23-10-2019', '2026-10-23'), 7);
});

test('DD-MM-YYYY is not misread as month-day "10-20"', () => {
  // The old .slice(5, 10) read "23-10-2019" as "10-20".
  assert.strictEqual(anniversaryYearsAgo('23-10-2019', '2026-10-20'), null);
});

test('this year\'s show is not an anniversary', () => {
  assert.strictEqual(anniversaryYearsAgo('2026-10-23', '2026-10-23'), null);
  assert.strictEqual(anniversaryYearsAgo('23-10-2026', '2026-10-23'), null);
});

test('other days, missing and unreadable dates: no match', () => {
  assert.strictEqual(anniversaryYearsAgo('2019-10-24', '2026-10-23'), null);
  assert.strictEqual(anniversaryYearsAgo(undefined, '2026-10-23'), null);
  assert.strictEqual(anniversaryYearsAgo('', '2026-10-23'), null);
  assert.strictEqual(anniversaryYearsAgo('Oct 23, 2019', '2026-10-23'), null);
});

test('Feb 29 matches on Feb 29 only', () => {
  assert.strictEqual(anniversaryYearsAgo('2020-02-29', '2028-02-29'), 8);
  assert.strictEqual(anniversaryYearsAgo('2020-02-29', '2027-02-28'), null);
});

test('the job\'s today is the UTC date', () => {
  assert.strictEqual(utcIsoDate(new Date(Date.UTC(2026, 9, 24, 6, 30))), '2026-10-24');
});

test('isoDate agrees with toIsoDate on both stored formats', () => {
  for (const d of ['2019-10-23', '23-10-2019', '2020-02-29', '29-02-2020', '2024-01-01', '01-01-2024']) {
    assert.strictEqual(isoDate(d), toIsoDate(d), d);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
