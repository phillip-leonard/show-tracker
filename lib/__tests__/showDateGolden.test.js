/**
 * The shared date golden table (fixtures/dates/show-dates.json) against
 * lib/showDate.js. The Swift app's Core runs the same table
 * (ios-native/Packages/Core/Tests/CoreTests/ShowDateGoldenTests.swift), so
 * a stored date reads the same in both apps. Change a row only on purpose.
 *
 *   node lib/__tests__/showDateGolden.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const D = require('../showDate');

const table = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'dates', 'show-dates.json'), 'utf8'));

const withTZ = (tz, fn) => {
  const saved = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; }
};

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; } catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); }
};

for (const [input, expected] of table.toIsoDate) check(`toIsoDate(${JSON.stringify(input)})`, () => assert.strictEqual(D.toIsoDate(input), expected));
for (const [input, expected] of table.storedDateShape) check(`storedDateShape(${JSON.stringify(input)})`, () => assert.strictEqual(D.storedDateShape(input), expected));
for (const [input, expected] of table.showYear) check(`showYear(${input})`, () => assert.strictEqual(D.showYear(input), expected));
for (const [input, expected] of table.monthDay) check(`monthDay(${input})`, () => assert.strictEqual(D.monthDay(input), expected));
check('compareShowDates', () => assert.deepStrictEqual(table.compareShowDates.input.slice().sort(D.compareShowDates), table.compareShowDates.sorted));
for (const [a, b, expected] of table.sameShowDate) check(`sameShowDate(${a}, ${b})`, () => assert.strictEqual(D.sameShowDate(a, b), expected));
for (const [a, b, expected] of table.daysBetweenDates) {
  check(`daysBetweenDates(${a}, ${b})`, () => {
    const got = D.daysBetweenDates(a, b);
    if (expected === null) assert.ok(Number.isNaN(got)); else assert.strictEqual(got, expected);
  });
}
for (const [input, expected] of table.fromSetlistfmDate) check(`fromSetlistfmDate(${input})`, () => assert.strictEqual(D.fromSetlistfmDate(input), expected));
for (const r of table.relativeToToday) {
  // "today" in the table is a calendar day; noon on it, locally, is that day anywhere.
  const [y, m, d] = r.today.split('-').map(Number);
  const now = new Date(y, m - 1, d, 12);
  check(`isPast/isUpcoming(${r.date} on ${r.today})`, () => {
    assert.strictEqual(D.isPast(r.date, now), r.isPast);
    assert.strictEqual(D.isUpcoming(r.date, now), r.isUpcoming);
  });
}
for (const r of table.today) {
  check(`today at ${r.instant} in ${r.timeZone}`, () => withTZ(r.timeZone, () => assert.strictEqual(D.today(new Date(r.instant)), r.expected)));
}

console.log(`showDateGolden: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
