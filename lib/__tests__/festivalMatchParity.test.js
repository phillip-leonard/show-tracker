/**
 * Parity tests: netlify/functions/lib/festivalMatchRule.js must agree with
 * lib/festivalMatch.js on every case, always.
 *
 * WHY THIS FILE EXISTS. The match rule has to exist twice — once as the
 * app's ESM module, once as CommonJS a Netlify function can require without
 * a build step to resolve `@/lib`. Two definitions of one rule is a
 * standing invitation to drift, and drift here is expensive: the bound that
 * stops a mistyped year absorbing unrelated festivals had to be applied by
 * hand to every copy, and a copy that missed it would silently keep
 * mis-merging.
 *
 * So rather than trusting a "keep in step" comment, this runs both
 * implementations over the same inputs and asserts identical answers —
 * including the exact production pair that caused the 2011-into-2008
 * mis-merge, and the Bonnaroo 2025/2026 case the date gate exists for.
 *
 * The two older ports inside admin-migrate-festivals.js and
 * admin-repair-festival-split.js are NOT covered here; they are shipped
 * code with their own inline copies. New functions should require the
 * shared module instead, and this test is what makes that worth doing.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/festivalMatchParity.test.js
 */

import assert from 'assert';
import { createRequire } from 'module';
import * as esm from '@/lib/festivalMatch';

const require = createRequire(import.meta.url);
const cjs = require('../../netlify/functions/lib/festivalMatchRule.js');

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

const fest = (name, startDate, endDate, location = '') => ({ name, startDate, endDate, location });
const startGap = (a, b) => cjs.startGapDays(fest('X', a, ''), fest('X', b, ''));

console.log('\nnetlify/functions/lib/festivalMatchRule.js parity with lib/festivalMatch.js\n');

// ── Constants ─────────────────────────────────────────────────────────

test('shared constants hold the same values', () => {
  for (const key of [
    'MAX_START_DATE_GAP_DAYS',
    'MIN_NAME_SIMILARITY',
    'MIN_NAME_LENGTH',
    'MAX_FESTIVAL_DAYS',
    'MIN_FESTIVAL_YEAR',
    'MAX_FESTIVAL_YEAR',
    'FESTIVAL_NAME_MAX',
  ]) {
    assert.strictEqual(cjs[key], esm[key], `${key} differs: ${cjs[key]} vs ${esm[key]}`);
  }
});

// ── Names ─────────────────────────────────────────────────────────────

const NAMES = [
  '',
  '   ',
  'Bonnaroo',
  '  Bonnaroo!!  Music   Festival ',
  'The Bonnaroo Music & Arts Festival',
  'Bonnaroo 2026',
  'Bonnaroo 1964',
  '1964 Festival',
  'A Summer Camp',
  'An Outside Lands',
  'Outside Lands',
  'Outside Lands Music & Arts Festival',
  'Summer Camp',
  'Summer Solstice',
  'roo',
  'Rock’n’Roll Weekender',
  'Coachella Valley Music and Arts Festival',
  'coachella',
];

test('normalizeFestivalName agrees on every name', () => {
  NAMES.forEach(name => {
    assert.strictEqual(
      cjs.normalizeFestivalName(name),
      esm.normalizeFestivalName(name),
      `normalizeFestivalName(${JSON.stringify(name)})`
    );
  });
});

test('nameSimilarity and namesAreClose agree on every pair', () => {
  NAMES.forEach(a => {
    NAMES.forEach(b => {
      assert.strictEqual(
        cjs.nameSimilarity(a, b),
        esm.nameSimilarity(a, b),
        `nameSimilarity(${JSON.stringify(a)}, ${JSON.stringify(b)})`
      );
      assert.strictEqual(
        cjs.namesAreClose(a, b),
        esm.namesAreClose(a, b),
        `namesAreClose(${JSON.stringify(a)}, ${JSON.stringify(b)})`
      );
    });
  });
});

// ── Dates ─────────────────────────────────────────────────────────────

const WINDOWS = [
  ['2026-06-11', '2026-06-14'],
  ['2026-06-12', '2026-06-15'],
  ['2026-06-15', '2026-06-18'],
  ['2025-06-11', '2025-06-14'],
  ['2026-06-11', ''],
  ['2026-06-11', '2026-06-10'],   // end before start
  ['2026-06-11', '2026-08-30'],   // wider than MAX_FESTIVAL_DAYS
  ['0011-08-12', '2011-08-14'],   // the production typo
  ['2011-08-12', '2011-08-14'],   // what it should have been
  ['2008-08-22', '2008-08-24'],
  ['1899-01-01', '1899-01-02'],   // below MIN_FESTIVAL_YEAR
  ['2101-01-01', '2101-01-02'],   // above MAX_FESTIVAL_YEAR
  ['2025-12-30', '2026-01-02'],   // straddles New Year
  ['2026-01-01', '2026-01-03'],
  ['not-a-date', '2026-06-14'],
  ['', ''],
];

test('datesAreClose agrees on every window pair', () => {
  WINDOWS.forEach(([sa, ea]) => {
    WINDOWS.forEach(([sb, eb]) => {
      const a = fest('X', sa, ea);
      const b = fest('X', sb, eb);
      assert.strictEqual(
        cjs.datesAreClose(a, b),
        esm.datesAreClose(a, b),
        `datesAreClose(${sa}..${ea}, ${sb}..${eb})`
      );
    });
  });
});

// ── Location ──────────────────────────────────────────────────────────

const LOCATIONS = ['', 'Manchester, TN', 'manchester', 'Chicago, IL', 'Berlin', 'Chicago'];

test('normalizeLocation and locationsAgree agree on every pair', () => {
  LOCATIONS.forEach(a => {
    assert.strictEqual(cjs.normalizeLocation(a), esm.normalizeLocation(a), `normalizeLocation(${a})`);
    LOCATIONS.forEach(b => {
      assert.strictEqual(cjs.locationsAgree(a, b), esm.locationsAgree(a, b), `locationsAgree(${a}, ${b})`);
    });
  });
});

// ── The rule itself ───────────────────────────────────────────────────

test('festivalsMatch agrees across the whole name × window grid', () => {
  let compared = 0;
  NAMES.forEach(name => {
    WINDOWS.forEach(([sa, ea]) => {
      WINDOWS.forEach(([sb, eb]) => {
        const a = fest(name, sa, ea);
        const b = fest('Bonnaroo Music and Arts Festival', sb, eb);
        assert.strictEqual(
          cjs.festivalsMatch(a, b),
          esm.festivalsMatch(a, b),
          `festivalsMatch(${JSON.stringify(name)} ${sa}..${ea}, bonnaroo ${sb}..${eb})`
        );
        compared++;
      });
    });
  });
  assert.ok(compared > 4000, `expected a broad grid, compared only ${compared}`);
});

test('null and undefined operands agree', () => {
  assert.strictEqual(cjs.festivalsMatch(null, null), esm.festivalsMatch(null, null));
  assert.strictEqual(cjs.festivalsMatch(undefined, fest('X', '2026-06-11', '2026-06-12')), esm.festivalsMatch(undefined, fest('X', '2026-06-11', '2026-06-12')));
});

// ── The cases that cost real data ─────────────────────────────────────

test('both refuse the 2011-into-2008 mis-merge', () => {
  const typo = fest('Outside Lands', '0011-08-12', '2011-08-14');
  const other = fest('Outside Lands Music & Arts Festival', '2008-08-22', '2008-08-24');
  assert.strictEqual(esm.festivalsMatch(typo, other), false, 'ESM must refuse');
  assert.strictEqual(cjs.festivalsMatch(typo, other), false, 'CommonJS must refuse');
});

test('both still match the 2011 record to its own edition once corrected', () => {
  const fixed = fest('Outside Lands', '2011-08-12', '2011-08-14');
  const same = fest('Outside Lands Music & Arts Festival', '2011-08-12', '2011-08-14');
  assert.strictEqual(esm.festivalsMatch(fixed, same), true, 'ESM must match');
  assert.strictEqual(cjs.festivalsMatch(fixed, same), true, 'CommonJS must match');
});

test('both refuse Bonnaroo 2025 against Bonnaroo 2026', () => {
  const y25 = fest('Bonnaroo', '2025-06-11', '2025-06-14');
  const y26 = fest('Bonnaroo', '2026-06-11', '2026-06-14');
  assert.strictEqual(esm.festivalsMatch(y25, y26), false, 'ESM must refuse');
  assert.strictEqual(cjs.festivalsMatch(y25, y26), false, 'CommonJS must refuse');
});

// ── startGapDays (CommonJS only — used by the merge edition guard) ─────

test('startGapDays measures whole days, and refuses implausible dates', () => {
  assert.strictEqual(startGap('2026-06-11', '2026-06-11'), 0);
  assert.strictEqual(startGap('2026-06-11', '2026-06-14'), 3);
  assert.strictEqual(startGap('2025-06-11', '2026-06-11'), 365);
  assert.strictEqual(startGap('0011-08-12', '2011-08-12'), null, 'year 11 is not a date');
  assert.strictEqual(startGap('not-a-date', '2026-06-11'), null);
  assert.strictEqual(cjs.startGapDays(null, fest('X', '2026-06-11', '')), null);
});

test('a pair straddling New Year is days apart, not a year apart', () => {
  // The case a calendar-year comparison would get wrong: these start in
  // 2025 and 2026 respectively, but they are two days apart and obviously
  // the same festival. The merge guard measures days for this reason.
  const gap = startGap('2025-12-30', '2026-01-01');
  assert.strictEqual(gap, 2);
  assert.ok(gap <= 60, 'must fall inside the manual-merge window, not outside it');
});

test('two editions of an annual festival are far outside the manual-merge window', () => {
  assert.ok(startGap('2025-06-11', '2026-06-11') > 60);
});

// ── Year-only festivals (5.58.0) ──────────────────────────────────────

const YEAR_ONLY = [
  { name: 'Bonnaroo', year: 2024 },
  { name: 'Bonnaroo', year: 2025 },
  { name: 'Bonnaroo', year: '2024' }, // a string is not a year
  { name: 'Bonnaroo', year: 1850 },
  { name: 'Bonnaroo' },
  { name: 'Bonnaroo', startDate: '2024-06-13', endDate: '2024-06-16' },
  { name: 'Bonnaroo', startDate: '2024-06-13', endDate: '2024-06-16', year: 2024 },
  { name: 'Bonnaroo', startDate: '2025-06-12', endDate: '2025-06-15' },
  { name: 'Bonnaroo', startDate: '0011-06-13', endDate: '2024-06-16', year: 2024 },
  { name: 'Coachella', year: 2024 },
];

test('festivalYear, isYearOnly, yearsAgree and festivalsMatch agree on year-only records', () => {
  for (const a of YEAR_ONLY) {
    assert.strictEqual(cjs.festivalYear(a), esm.festivalYear(a), `festivalYear(${JSON.stringify(a)})`);
    assert.strictEqual(cjs.isYearOnly(a), esm.isYearOnly(a), `isYearOnly(${JSON.stringify(a)})`);
    for (const b of YEAR_ONLY) {
      const label = `${JSON.stringify(a)} / ${JSON.stringify(b)}`;
      assert.strictEqual(cjs.yearsAgree(a, b), esm.yearsAgree(a, b), `yearsAgree ${label}`);
      assert.strictEqual(cjs.festivalsMatch(a, b), esm.festivalsMatch(a, b), `festivalsMatch ${label}`);
    }
  }
});

test('both match a year-only Bonnaroo 2024 to the dated 2024 edition and never to 2025', () => {
  const yearOnly = { name: 'Bonnaroo', year: 2024 };
  const dated24 = fest('Bonnaroo Music and Arts Festival', '2024-06-13', '2024-06-16');
  const dated25 = fest('Bonnaroo Music and Arts Festival', '2025-06-12', '2025-06-15');
  for (const impl of [esm, cjs]) {
    assert.strictEqual(impl.festivalsMatch(yearOnly, dated24), true);
    assert.strictEqual(impl.festivalsMatch(yearOnly, dated25), false);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
