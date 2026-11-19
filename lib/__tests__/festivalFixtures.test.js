/**
 * fixtures/festivals/ — the Stage 5 festival contract the native app tests
 * against (5.60.36):
 *
 *   dates.json   lib/festivalDates.js: festivalYear, isYearOnly,
 *                festivalSortKey, festivalLastDay, festivalWhenFields,
 *                showFitsFestival, plus the name and year limits
 *                (lib/festivalMatch.js). The label is left out: each app
 *                formats dates its own way.
 *   stats.json   lib/festivalGrouping.js buildFestivalStats on the shared
 *                keys (Stage 5 call C): shows in, tiles and days out.
 *   joined.json  lib/festivalCatalog.js joinedFestival: an attendance
 *                record and its canonical festival in, the festival every
 *                screen reads out.
 *
 * Inputs are written here; expected values come from the modules, so
 *   UPDATE_FIXTURES=1 node lib/__tests__/festivalFixtures.test.js
 * regenerates the files after a deliberate change (read the diff).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const D = require('../festivalDates');
const { buildFestivalStats } = require('../festivalGrouping');
const { joinedFestival, isCutShort } = require('../festivalCatalog');
const { FESTIVAL_NAME_MAX, MIN_FESTIVAL_YEAR, MAX_FESTIVAL_YEAR } = require('../festivalMatch');

const ROOT = path.join(__dirname, '..', '..');
const UPDATE = process.env.UPDATE_FIXTURES === '1';
let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; } catch (e) { failed += 1; console.error(`✗ ${name}\n  ${e.message}`); }
};
const file = (rel) => path.join(ROOT, 'fixtures', rel);
const plain = (v) => JSON.parse(JSON.stringify(v));
function check(rel, actual) {
  if (UPDATE) { fs.writeFileSync(file(rel), `${JSON.stringify(actual, null, 2)}\n`); return; }
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file(rel), 'utf8')), plain(actual));
}

// ── dates.json ────────────────────────────────────────────────────────

const FESTIVALS = {
  dated: { startDate: '2024-06-13', endDate: '2024-06-16' },
  datedWithYear: { startDate: '2024-06-13', endDate: '2024-06-16', year: 2024 },
  oneDay: { startDate: '2024-09-07', endDate: '2024-09-07' },
  startOnly: { startDate: '2024-06-13' },
  newYear: { startDate: '2023-12-30', endDate: '2024-01-02' },
  yearOnly: { year: 2019 },
  yearOutOfRange: { year: 1850 },
  yearNotWhole: { year: 2019.5 },
  unknown: {},
};
const SHOW_DATES = ['2024-06-13', '2024-06-16', '2024-06-17', '2024-06-12', '15-06-2024', '2019-01-01', '2019-12-31', '2020-01-01', '2024-01-01', '2023-12-31', '', 'not a date'];
const WHEN_INPUTS = [
  { startDate: '2024-06-13', endDate: '2024-06-16' },
  { startDate: '2024-06-13' },
  { startDate: '2024-06-13', endDate: '' },
  { startDate: '2024-06-16', endDate: '2024-06-13' },
  { startDate: '13-06-2024', endDate: '16-06-2024' },
  { startDate: '1850-06-13', endDate: '1850-06-14' },
  { year: 2019 },
  { year: '2019' },
  { year: 2019, startDate: '' },
  { year: 1850 },
  { year: 2101 },
  { year: '20x9' },
  {},
];

test('dates.json', () => {
  check('festivals/dates.json', {
    limits: { nameMax: FESTIVAL_NAME_MAX, minYear: MIN_FESTIVAL_YEAR, maxYear: MAX_FESTIVAL_YEAR },
    festivals: Object.entries(FESTIVALS).map(([name, festival]) => ({
      name,
      festival,
      year: D.festivalYear(festival),
      yearOnly: D.isYearOnly(festival),
      sortKey: D.festivalSortKey(festival),
      lastDay: D.festivalLastDay(festival),
      fits: Object.fromEntries(SHOW_DATES.map((d) => [d, D.showFitsFestival(d, festival)])),
    })),
    whenFields: WHEN_INPUTS.map((input) => ({ input, output: D.festivalWhenFields(input) })),
  });
});

// ── stats.json ────────────────────────────────────────────────────────

const show = (id, date, artist, extra = {}) => ({ id, date, artist, venue: 'Great Stage Park', ...extra });
const STATS_CASES = [
  { name: 'empty', shows: [] },
  {
    name: 'two days, same-day order kept, unrated left out of the average',
    shows: [show('s3', '2024-06-14', 'Billy Strings', { rating: 9 }), show('s1', '2024-06-13', 'Goose', { rating: 8 }), show('s2', '2024-06-13', 'Phish')],
  },
  {
    name: 'one band spelled two ways is one artist, shown as first seen',
    shows: [show('s1', '2024-06-13', 'goose'), show('s2', '2024-06-14', 'Goose'), show('s3', '2024-06-15', 'The Goose'), show('s4', '2024-06-15', 'Goose (US)')],
  },
  {
    name: 'only ratings from 1 to 10 count',
    shows: [show('s1', '2024-06-13', 'A', { rating: 0 }), show('s2', '2024-06-13', 'B', { rating: 11 }), show('s3', '2024-06-13', 'C', { rating: 7 }), show('s4', '2024-06-13', 'D', { rating: '9' }), show('s5', '2024-06-13', 'E', { rating: 8.5 })],
  },
  {
    name: 'a legacy dd-MM-yyyy date is the same day; an unreadable date is last and not a day',
    shows: [show('s1', '14-06-2024', 'A'), show('s2', '', 'B'), show('s3', '2024-06-14', 'C'), show('s4', '2024-06-13', 'D')],
  },
  {
    name: 'across a year boundary',
    shows: [show('s2', '2024-01-01', 'B'), show('s1', '2023-12-31', 'A'), show('s3', '2024-01-02', 'C')],
  },
  { name: 'no artist name is no artist', shows: [show('s1', '2024-06-13', ''), show('s2', '2024-06-13', '  ')] },
];

test('stats.json', () => {
  check('festivals/stats.json', STATS_CASES.map(({ name, shows }) => {
    const s = buildFestivalStats(shows);
    return {
      name,
      shows,
      expected: {
        showCount: s.showCount,
        artists: s.artists,
        artistCount: s.artistCount,
        avgRating: s.avgRating,
        dayCount: s.dayCount,
        days: s.groupedByDay.map((d) => ({ date: d.date, showIds: d.shows.map((x) => x.id) })),
      },
    };
  }));
});

// ── joined.json ───────────────────────────────────────────────────────

const CANONICAL = {
  name: 'Bonnaroo', nameNormalized: 'bonnaroo', startDate: '2025-06-12', endDate: '2025-06-15', year: 2025,
  location: 'Manchester, TN', edition: '2025', createdBy: 'alice', lineup: ['Goose', 'Tyler Childers'],
  lineupSource: 'ticketmaster', lineupUrl: 'https://www.ticketmaster.com/event/abc',
};
const JOINED_CASES = [
  { name: 'the creator', attendanceId: 'a1', uid: 'alice', attendance: { festivalId: 'f1', notes: 'muddy', rating: null, myLineup: ['Goose'] }, canonical: CANONICAL },
  { name: 'someone who joined', attendanceId: 'b1', uid: 'bob', attendance: { festivalId: 'f1' }, canonical: CANONICAL },
  {
    name: 'a catalog festival, cut short',
    attendanceId: 'b2', uid: 'bob', attendance: { festivalId: 'seed1', notes: '' },
    canonical: { name: 'Hardly Strictly', startDate: '2025-10-03', endDate: '2025-10-05', location: 'San Francisco', createdBy: 'system:seed', source: 'seed', status: 'cut_short', notes: 'Rain ended it early.', lineup: ['A'], lineupSource: 'seed' },
  },
  { name: 'year only', attendanceId: 'b3', uid: 'bob', attendance: { festivalId: 'f2' }, canonical: { name: 'Outside Lands', nameNormalized: 'outside lands', year: 2019, location: '', createdBy: 'bob' } },
  { name: 'the canonical can’t be read', attendanceId: 'b4', uid: 'bob', attendance: { festivalId: 'gone', notes: 'still mine' }, canonical: null },
  { name: 'a record from before 5.30.0', attendanceId: 'b5', uid: 'bob', attendance: { name: 'Old Fest', startDate: '2019-06-01', endDate: '2019-06-02', location: 'Somewhere', notes: 'kept' } },
];

test('joined.json', () => {
  check('festivals/joined.json', JOINED_CASES.map(({ name, attendanceId, uid, attendance, canonical }) => {
    const festival = joinedFestival(attendanceId, attendance, canonical, uid);
    return { name, attendanceId, uid, attendance, canonical: canonical === undefined ? 'absent' : canonical, expected: { ...festival, cutShort: isCutShort(festival) } };
  }));
});

console.log(`festival fixtures: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
