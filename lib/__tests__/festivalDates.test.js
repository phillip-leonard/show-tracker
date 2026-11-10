/**
 * lib/festivalDates.js — when a festival happened, for festivals with both
 * dates and for festivals added with only a year (5.58.0).
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/festivalDates.test.js
 */

import assert from 'assert';
import {
  festivalWhenLabel,
  festivalSortKey,
  festivalLastDay,
  festivalWhenFields,
  showFitsFestival,
} from '@/lib/festivalDates';
import { formatDate } from '@/lib/utils';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

const dated = { name: 'Bonnaroo', startDate: '2024-06-13', endDate: '2024-06-16' };
const oneDay = { name: 'Day Trip', startDate: '2024-09-07', endDate: '2024-09-07' };
const yearOnly = { name: 'Bonnaroo', year: 2019 };
const unknown = { name: 'Mystery' };

console.log('\nlib/festivalDates.js\n');

test('the label shows dates, one date, the year, or nothing', () => {
  assert.strictEqual(festivalWhenLabel(dated), `${formatDate('2024-06-13')} – ${formatDate('2024-06-16')}`);
  assert.strictEqual(festivalWhenLabel(oneDay), formatDate('2024-09-07'));
  assert.strictEqual(festivalWhenLabel(yearOnly), '2019');
  assert.strictEqual(festivalWhenLabel(unknown), '');
});

test('a year-only festival sorts after its year\'s dated ones, newest first', () => {
  const list = [
    { name: 'A', startDate: '2018-06-14', endDate: '2018-06-17' },
    yearOnly,
    { name: 'C', startDate: '2019-06-13', endDate: '2019-06-16' },
    { name: 'D', startDate: '2020-01-02', endDate: '2020-01-04' },
  ];
  const sorted = list.slice().sort((a, b) => (festivalSortKey(a) < festivalSortKey(b) ? 1 : -1)).map(f => f.name);
  assert.deepStrictEqual(sorted, ['D', 'C', 'Bonnaroo', 'A']);
});

test('the last day of a year-only festival is 31 December', () => {
  assert.strictEqual(festivalLastDay(dated), '2024-06-16');
  assert.strictEqual(festivalLastDay({ startDate: '2024-06-13' }), '2024-06-13');
  assert.strictEqual(festivalLastDay(yearOnly), '2019-12-31');
  assert.strictEqual(festivalLastDay(unknown), '');
});

test('the written fields are both dates and their year, or only the year', () => {
  assert.deepStrictEqual(festivalWhenFields({ startDate: '2024-06-13', endDate: '2024-06-16' }),
    { startDate: '2024-06-13', endDate: '2024-06-16', year: 2024 });
  assert.deepStrictEqual(festivalWhenFields({ startDate: '2024-06-13' }),
    { startDate: '2024-06-13', endDate: '2024-06-13', year: 2024 });
  assert.deepStrictEqual(festivalWhenFields({ year: '2019' }), { year: 2019 });
  assert.deepStrictEqual(festivalWhenFields({ year: 2019, startDate: '' }), { year: 2019 });
  assert.strictEqual(festivalWhenFields({ year: 1850 }), null);
  assert.strictEqual(festivalWhenFields({ year: '20x9' }), null);
  assert.strictEqual(festivalWhenFields({}), null);
});

test('a show fits a dated festival only inside its dates', () => {
  assert.strictEqual(showFitsFestival('2024-06-13', dated), true);
  assert.strictEqual(showFitsFestival('2024-06-16', dated), true);
  assert.strictEqual(showFitsFestival('2024-06-17', dated), false);
  assert.strictEqual(showFitsFestival('15-06-2024', dated), true, 'dd-MM-yyyy is read too');
});

test('a show fits a year-only festival anywhere in its year', () => {
  assert.strictEqual(showFitsFestival('2019-06-15', yearOnly), true);
  assert.strictEqual(showFitsFestival('2019-01-01', yearOnly), true);
  assert.strictEqual(showFitsFestival('2020-06-15', yearOnly), false);
  assert.strictEqual(showFitsFestival('15-06-2019', yearOnly), true);
});

test('nothing is hidden when either date is unknown', () => {
  assert.strictEqual(showFitsFestival('', dated), true);
  assert.strictEqual(showFitsFestival('2019-06-15', unknown), true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
