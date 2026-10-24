/**
 * Unit tests for lib/anniversaries.js.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/anniversaries.test.js
 *
 * Pinned to Los Angeles: "today" read as the UTC date only goes wrong
 * west of Greenwich, in the evening.
 */

process.env.TZ = 'America/Los_Angeles';

import assert from 'assert';
import { nextOccurrence, buildUpcomingAnniversaries } from '@/lib/anniversaries';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

test('next occurrence is this year when the month-day is still ahead', () => {
  assert.strictEqual(nextOccurrence('2019-12-25', '2024-06-01'), '2024-12-25');
});

test('next occurrence rolls to next year when the month-day already passed', () => {
  assert.strictEqual(nextOccurrence('2019-01-15', '2024-06-01'), '2025-01-15');
});

test("next occurrence is today's date when the month-day is today", () => {
  assert.strictEqual(nextOccurrence('2019-06-01', '2024-06-01'), '2024-06-01');
});

test('a show happening today has no anniversary yet (0 years is not upcoming)', () => {
  const shows = [{ id: 's1', date: '2024-06-01' }];
  const upcoming = buildUpcomingAnniversaries(shows, '2024-06-01');
  assert.strictEqual(upcoming.length, 0);
});

test('a past show produces one upcoming anniversary with correct years-ago', () => {
  const shows = [{ id: 's1', artist: 'Phish', date: '2019-07-15' }];
  const upcoming = buildUpcomingAnniversaries(shows, '2024-06-01');
  assert.strictEqual(upcoming.length, 1);
  assert.strictEqual(upcoming[0].occurrence, '2024-07-15');
  assert.strictEqual(upcoming[0].yearsAgo, 5);
});

test('results are sorted soonest-first', () => {
  const shows = [
    { id: 's1', date: '2019-12-25' },
    { id: 's2', date: '2019-06-10' },
  ];
  const upcoming = buildUpcomingAnniversaries(shows, '2024-06-01');
  assert.strictEqual(upcoming[0].show.id, 's2');
  assert.strictEqual(upcoming[1].show.id, 's1');
});

test('shows with no date are ignored', () => {
  const shows = [{ id: 's1' }];
  assert.strictEqual(buildUpcomingAnniversaries(shows, '2024-06-01').length, 0);
});

test('DD-MM-YYYY (ticket scanner) dates get the right occurrence and years-ago', () => {
  assert.strictEqual(nextOccurrence('23-10-2019', '2026-06-01'), '2026-10-23');
  const upcoming = buildUpcomingAnniversaries([{ id: 's1', date: '23-10-2019' }], '2026-06-01');
  assert.strictEqual(upcoming.length, 1);
  assert.strictEqual(upcoming[0].occurrence, '2026-10-23');
  assert.strictEqual(upcoming[0].yearsAgo, 7);
});

test('DD-MM-YYYY and YYYY-MM-DD shows sort together by their real dates', () => {
  const shows = [
    { id: 'iso', date: '2019-12-25' },
    { id: 'scanned', date: '10-06-2019' },
  ];
  const upcoming = buildUpcomingAnniversaries(shows, '2024-06-01');
  assert.deepStrictEqual(upcoming.map(e => e.show.id), ['scanned', 'iso']);
});

test('unreadable dates are ignored rather than producing a bogus occurrence', () => {
  assert.strictEqual(nextOccurrence('sometime', '2024-06-01'), null);
  assert.strictEqual(buildUpcomingAnniversaries([{ id: 's1', date: 'sometime' }], '2024-06-01').length, 0);
});

test("default today is the device's local date, not the UTC date", () => {
  // 23:30 in Los Angeles on Oct 23 is 06:30 UTC on Oct 24.
  const RealDate = Date;
  const fixed = new RealDate(2026, 9, 23, 23, 30).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  };
  try {
    assert.strictEqual(new Date().toISOString().slice(0, 10), '2026-10-24');
    assert.strictEqual(nextOccurrence('2019-10-23'), '2026-10-23');
    const upcoming = buildUpcomingAnniversaries([{ id: 's1', date: '2019-10-23' }]);
    assert.strictEqual(upcoming[0].occurrence, '2026-10-23');
    assert.strictEqual(upcoming[0].yearsAgo, 7);
  } finally {
    globalThis.Date = RealDate;
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
