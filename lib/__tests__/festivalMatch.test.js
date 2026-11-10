/**
 * Unit tests for lib/festivalMatch.js — the shared-festival match rule.
 *
 * The case this file exists to protect: Bonnaroo 2025 and Bonnaroo 2026
 * have identical names and must never match each other.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/festivalMatch.test.js
 */

import assert from 'assert';
import {
  normalizeFestivalName,
  nameSimilarity,
  namesAreClose,
  datesAreClose,
  normalizeLocation,
  locationsAgree,
  festivalsMatch,
  findFestivalMatches,
  MAX_START_DATE_GAP_DAYS,
  festivalNameProblem,
  FESTIVAL_NAME_MAX,
  MAX_FESTIVAL_DAYS,
  MIN_FESTIVAL_YEAR,
  MAX_FESTIVAL_YEAR,
  festivalYear,
  isYearOnly,
  yearsAgree,
} from '@/lib/festivalMatch';

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

console.log('\nlib/festivalMatch.js\n');

// ── Normalization ─────────────────────────────────────────────────────

test('lowercases, strips punctuation and collapses whitespace', () => {
  assert.strictEqual(normalizeFestivalName('  Bonnaroo!!  Music   Festival '), 'bonnaroo music festival');
});

test('strips a leading article', () => {
  assert.strictEqual(normalizeFestivalName('The Bonnaroo'), 'bonnaroo');
  assert.strictEqual(normalizeFestivalName('A Perfect Weekend'), 'perfect weekend');
});

test('strips a trailing year but keeps a leading one', () => {
  assert.strictEqual(normalizeFestivalName('Bonnaroo 2026'), 'bonnaroo');
  assert.strictEqual(normalizeFestivalName('1964 Revival'), '1964 revival');
});

test('expands & so "Music & Arts" and "Music and Arts" agree', () => {
  assert.strictEqual(normalizeFestivalName('Music & Arts'), normalizeFestivalName('Music and Arts'));
});

// ── Name closeness ────────────────────────────────────────────────────

test('a short name is contained by its long form', () => {
  assert.strictEqual(namesAreClose('Bonnaroo', 'Bonnaroo Music and Arts Festival'), true);
  assert.strictEqual(namesAreClose('Bonnaroo 2026', 'The Bonnaroo Music & Arts Festival'), true);
});

test('containment is by whole token, not raw substring', () => {
  assert.strictEqual(namesAreClose('roo', 'Bonnaroo'), false);
});

test('unrelated names of the same shape stay apart', () => {
  assert.strictEqual(namesAreClose('Summer Camp', 'Summer Solstice'), false);
  assert.strictEqual(namesAreClose('Coachella', 'Bonnaroo'), false);
});

test('similarity is 0 when either name is empty', () => {
  assert.strictEqual(nameSimilarity('', 'Bonnaroo'), 0);
  assert.strictEqual(namesAreClose('', ''), false);
});

// ── Dates: the edition gate ───────────────────────────────────────────

test('THE case: Bonnaroo 2025 and Bonnaroo 2026 never match', () => {
  const a = fest('Bonnaroo 2025', '2025-06-12', '2025-06-15', 'Manchester, TN');
  const b = fest('Bonnaroo 2026', '2026-06-11', '2026-06-14', 'Manchester, TN');
  assert.strictEqual(namesAreClose(a.name, b.name), true, 'names should be identical after normalization');
  assert.strictEqual(datesAreClose(a, b), false, 'a year apart must fail the date gate');
  assert.strictEqual(festivalsMatch(a, b), false);
});

test('overlapping windows match', () => {
  assert.strictEqual(
    datesAreClose(fest('x', '2026-06-11', '2026-06-14'), fest('x', '2026-06-13', '2026-06-16')),
    true
  );
});

test('starts within the allowed gap match even without overlap', () => {
  // Two one-day festivals MAX_START_DATE_GAP_DAYS apart.
  assert.strictEqual(MAX_START_DATE_GAP_DAYS, 3);
  assert.strictEqual(
    datesAreClose(fest('x', '2026-06-11', '2026-06-11'), fest('x', '2026-06-14', '2026-06-14')),
    true
  );
  assert.strictEqual(
    datesAreClose(fest('x', '2026-06-11', '2026-06-11'), fest('x', '2026-06-15', '2026-06-15')),
    false
  );
});

test('single-day festivals (start == end) match correctly', () => {
  const a = fest('Field Day', '2026-08-01', '2026-08-01');
  const b = fest('Field Day', '2026-08-01', '2026-08-01');
  assert.strictEqual(festivalsMatch(a, b), true);
});

test('a festival spanning a year boundary matches its twin', () => {
  const a = fest('Decadence', '2026-12-30', '2027-01-01');
  const b = fest('Decadence', '2026-12-31', '2027-01-01');
  assert.strictEqual(festivalsMatch(a, b), true);
});

test('a year-boundary festival does not match the next edition', () => {
  const a = fest('Decadence', '2026-12-30', '2027-01-01');
  const b = fest('Decadence', '2027-12-30', '2028-01-01');
  assert.strictEqual(festivalsMatch(a, b), false);
});

test('the day either side of a month boundary is counted exactly', () => {
  // Jan 31 -> Feb 1 is one day, not a month.
  assert.strictEqual(
    datesAreClose(fest('x', '2026-01-31', '2026-01-31'), fest('x', '2026-02-01', '2026-02-01')),
    true
  );
});

test('a malformed or missing date fails the gate rather than matching everything', () => {
  assert.strictEqual(datesAreClose(fest('x', '', ''), fest('x', '2026-06-11', '2026-06-14')), false);
  assert.strictEqual(datesAreClose(fest('x', 'June 2026'), fest('x', '2026-06-11')), false);
});

test('a missing end date is treated as a single day, not an open window', () => {
  assert.strictEqual(
    datesAreClose(fest('x', '2026-06-11', undefined), fest('x', '2026-06-11', '2026-06-14')),
    true
  );
  assert.strictEqual(
    datesAreClose(fest('x', '2026-06-11', undefined), fest('x', '2026-09-01', '2026-09-04')),
    false
  );
});

test('an inverted window is treated as a single day rather than matching nothing', () => {
  assert.strictEqual(
    datesAreClose(fest('x', '2026-06-14', '2026-06-11'), fest('x', '2026-06-14', '2026-06-16')),
    true
  );
});

// ── Implausible dates must match nothing, not everything ──────────────
// Regression tests for a real production mis-merge: one record's startDate
// had been typed "0011-08-12" instead of "2011-08-12". Year 11 AD parsed
// fine (four digits is four digits), giving a ~2001-year-wide window that
// overlapped every festival in the catalog, so "Outside Lands" 2011 was
// merged into "Outside Lands Music & Arts Festival" 2008.

test('THE regression: a year-typo window does not swallow another edition', () => {
  const corrupt = fest('Outside Lands', '0011-08-12', '2011-08-14');
  const real2008 = fest('Outside Lands Music & Arts Festival', '2008-08-22', '2008-08-24');
  // The names genuinely are close — the date gate is the only thing
  // standing between these two, which is exactly why it must hold.
  assert.strictEqual(namesAreClose(corrupt.name, real2008.name), true);
  assert.strictEqual(datesAreClose(corrupt, real2008), false);
  assert.strictEqual(festivalsMatch(corrupt, real2008), false);
});

test('a year outside the plausible range is not a date at all', () => {
  assert.strictEqual(MIN_FESTIVAL_YEAR, 1900);
  assert.strictEqual(MAX_FESTIVAL_YEAR, 2100);
  for (const bad of ['0011-08-12', '0000-01-01', '1899-12-31', '2101-01-01']) {
    assert.strictEqual(
      datesAreClose(fest('x', bad, bad), fest('x', '2011-08-12', '2011-08-14')),
      false,
      `${bad} should not date-match anything`
    );
  }
});

test('a span wider than a festival can be is treated as a typo, not a range', () => {
  assert.strictEqual(MAX_FESTIVAL_DAYS, 30);
  // Both endpoints plausible, but three years apart — a mistyped year.
  assert.strictEqual(
    datesAreClose(fest('x', '2008-08-22', '2011-08-24'), fest('x', '2009-06-01', '2009-06-03')),
    false
  );
  // A long-but-real festival window still matches.
  assert.strictEqual(
    datesAreClose(fest('x', '2026-06-01', '2026-06-20'), fest('x', '2026-06-18', '2026-06-19')),
    true
  );
});

test('the corrupt record still matches its own true edition once the date is fixed', () => {
  const fixed = fest('Outside Lands', '2011-08-12', '2011-08-14');
  const same = fest('Outside Lands Music & Arts Festival', '2011-08-12', '2011-08-14');
  assert.strictEqual(festivalsMatch(fixed, same), true);
});

test('a corrupt start with a good end does not become a giant window', () => {
  // Reversed corruption: the end is the typo. Collapses to a single day at
  // the start rather than spanning to year 11.
  assert.strictEqual(
    datesAreClose(fest('x', '2011-08-12', '0011-08-14'), fest('x', '2011-08-12', '2011-08-14')),
    true
  );
  assert.strictEqual(
    datesAreClose(fest('x', '2011-08-12', '0011-08-14'), fest('x', '2008-08-22', '2008-08-24')),
    false
  );
});

// ── Location: tiebreaker, never an equality test ──────────────────────

test('a blank location never splits two records of the same festival', () => {
  assert.strictEqual(locationsAgree('', 'Manchester, TN'), true);
  assert.strictEqual(
    festivalsMatch(
      fest('Bonnaroo', '2026-06-11', '2026-06-14', ''),
      fest('Bonnaroo', '2026-06-11', '2026-06-14', 'Manchester, TN')
    ),
    true
  );
});

test('normalizeLocation takes the city out of free text', () => {
  assert.strictEqual(normalizeLocation('Manchester, TN'), 'manchester');
  assert.strictEqual(normalizeLocation('  Chicago , IL '), 'chicago');
});

test('a differing city does not reject a candidate on its own', () => {
  const chicago = fest('Lollapalooza', '2026-08-01', '2026-08-04', 'Chicago, IL');
  const berlin = fest('Lollapalooza', '2026-08-01', '2026-08-04', 'Berlin');
  assert.strictEqual(locationsAgree(chicago.location, berlin.location), false);
  assert.strictEqual(festivalsMatch(chicago, berlin), true, 'still a candidate — the user chooses');
});

// ── findFestivalMatches ───────────────────────────────────────────────

test('same name and dates in two cities returns both, city-agreeing first', () => {
  const draft = fest('Lollapalooza', '2026-08-01', '2026-08-04', 'Berlin');
  const catalog = [
    { id: 'chi', ...fest('Lollapalooza', '2026-08-01', '2026-08-04', 'Chicago, IL') },
    { id: 'ber', ...fest('Lollapalooza', '2026-08-01', '2026-08-04', 'Berlin') },
  ];
  const matches = findFestivalMatches(draft, catalog);
  assert.strictEqual(matches.length, 2);
  assert.strictEqual(matches[0].festival.id, 'ber');
  assert.strictEqual(matches[1].festival.id, 'chi');
});

test('the previous edition is never returned as a match', () => {
  const draft = fest('Bonnaroo 2026', '2026-06-11', '2026-06-14', 'Manchester, TN');
  const catalog = [
    { id: 'y2025', ...fest('Bonnaroo 2025', '2025-06-12', '2025-06-15', 'Manchester, TN') },
    { id: 'y2026', ...fest('Bonnaroo', '2026-06-11', '2026-06-14', 'Manchester, TN') },
  ];
  const matches = findFestivalMatches(draft, catalog);
  assert.deepStrictEqual(matches.map(m => m.festival.id), ['y2026']);
});

test('no candidates returns an empty list, not a throw', () => {
  assert.deepStrictEqual(findFestivalMatches(fest('Bonnaroo', '2026-06-11', '2026-06-14'), []), []);
  assert.strictEqual(festivalsMatch(null, fest('x', '2026-01-01')), false);
});

// ── Name limits (mirrors the `festivals` rule in firestore.rules) ────
// Without these the write is rejected by Firestore with a bare
// permission error that names no field.

test('an empty name is rejected with the same message as before', () => {
  assert.strictEqual(festivalNameProblem(''), 'Give your festival a name.');
  assert.strictEqual(festivalNameProblem('   '), 'Give your festival a name.');
});

test('an ordinary name passes', () => {
  assert.strictEqual(festivalNameProblem('BottleRock Napa Valley 2025'), '');
});

test('a name at the limit passes and one over it is rejected', () => {
  assert.strictEqual(festivalNameProblem('a'.repeat(FESTIVAL_NAME_MAX)), '');
  assert.ok(festivalNameProblem('a'.repeat(FESTIVAL_NAME_MAX + 1)).includes('too long'));
});

test('a name that only exceeds the limit once normalized is rejected', () => {
  // normalizeFestivalName expands "&" to " and ", so normalizing can make
  // a name longer than the raw string the rule also caps at 120.
  const name = `${'ab&'.repeat(39)}x`; // 118 raw, longer once expanded
  assert.ok(name.length <= FESTIVAL_NAME_MAX, 'fixture must pass the raw check');
  assert.ok(normalizeFestivalName(name).length > FESTIVAL_NAME_MAX, 'fixture must fail normalized');
  assert.ok(festivalNameProblem(name).includes('too long'));
});

test('leading and trailing whitespace does not count toward the limit', () => {
  assert.strictEqual(festivalNameProblem(`   ${'a'.repeat(FESTIVAL_NAME_MAX)}   `), '');
});

// ── Year-only festivals (5.58.0) ──────────────────────────────────────

const yearOnly = (name, year, location = '') => ({ name, year, location });

test('festivalYear reads the start date first, then year', () => {
  assert.strictEqual(festivalYear(fest('Bonnaroo', '2024-06-13', '2024-06-16')), 2024);
  assert.strictEqual(festivalYear(yearOnly('Bonnaroo', 2024)), 2024);
  assert.strictEqual(festivalYear({ name: 'Bonnaroo', startDate: '2024-06-13', endDate: '2024-06-16', year: 1999 }), 2024);
  assert.strictEqual(festivalYear(yearOnly('Bonnaroo', '2024')), null, 'a string is not a year');
  assert.strictEqual(festivalYear(yearOnly('Bonnaroo', MIN_FESTIVAL_YEAR - 1)), null);
  assert.strictEqual(festivalYear(yearOnly('Bonnaroo', MAX_FESTIVAL_YEAR + 1)), null);
  assert.strictEqual(festivalYear({ name: 'Bonnaroo' }), null);
});

test('isYearOnly is true only without readable dates', () => {
  assert.strictEqual(isYearOnly(yearOnly('Bonnaroo', 2024)), true);
  assert.strictEqual(isYearOnly(fest('Bonnaroo', '2024-06-13', '2024-06-16')), false);
  assert.strictEqual(isYearOnly({ name: 'Bonnaroo' }), false);
});

test('a year-only festival matches the same name in the same year', () => {
  assert.strictEqual(festivalsMatch(yearOnly('Bonnaroo', 2024), fest('Bonnaroo Music & Arts Festival', '2024-06-13', '2024-06-16')), true);
  assert.strictEqual(festivalsMatch(yearOnly('Bonnaroo', 2024), yearOnly('The Bonnaroo', 2024)), true);
});

test('a year-only festival never matches another year', () => {
  assert.strictEqual(festivalsMatch(yearOnly('Bonnaroo', 2025), fest('Bonnaroo', '2026-06-11', '2026-06-14')), false);
  assert.strictEqual(festivalsMatch(yearOnly('Bonnaroo', 2025), yearOnly('Bonnaroo', 2026)), false);
});

test('a year-only festival still needs a close name', () => {
  assert.strictEqual(festivalsMatch(yearOnly('Summer Camp', 2024), fest('Summer Solstice', '2024-06-20', '2024-06-22')), false);
});

test('a year-only festival is offered both Coachella weekends', () => {
  const w1 = fest('Coachella', '2024-04-12', '2024-04-14');
  const w2 = fest('Coachella', '2024-04-19', '2024-04-21');
  const found = findFestivalMatches(yearOnly('Coachella', 2024), [w1, w2]).map(m => m.festival);
  assert.deepStrictEqual(found, [w1, w2]);
});

test('two dated festivals are never matched by year alone', () => {
  const w1 = fest('Coachella', '2024-04-12', '2024-04-14');
  const w2 = fest('Coachella', '2024-04-19', '2024-04-21');
  assert.strictEqual(yearsAgree(w1, w2), false);
  assert.strictEqual(festivalsMatch(w1, w2), false, 'the weekends stay separate');
});

test('a festival with neither dates nor a year matches nothing', () => {
  assert.strictEqual(festivalsMatch({ name: 'Bonnaroo' }, yearOnly('Bonnaroo', 2024)), false);
  assert.strictEqual(festivalsMatch({ name: 'Bonnaroo' }, { name: 'Bonnaroo' }), false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
