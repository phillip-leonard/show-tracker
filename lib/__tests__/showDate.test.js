/**
 * Unit tests for lib/showDate.js (every legacy format, ambiguous dates,
 * local "today" across time zones, B-09), lib/showIdentity.js (duplicate
 * check, Shows Together key, setlist scan match) and the planning half of
 * scripts/normalize-show-dates.js.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/showDate.test.js
 */

import assert from 'assert';
import { createRequire } from 'module';
import {
  toIsoDate, storedDateShape, parseDate, formatDate, showYear, monthDay, compareShowDates,
  sameShowDate, today, defaultShowDate, isUpcoming, isPast, daysBetweenDates, fromSetlistfmDate,
  parseEnteredDate, parseImportDate, utcIsoDate, localDateIso,
} from '@/lib/showDate';
import { isSameShow, findDuplicate, showMatchKey, setlistIsOnShowDate } from '@/lib/showIdentity';

const require = createRequire(import.meta.url);
const { planDateFix, setlistfmLookup, usableKey } = require('../../scripts/normalize-show-dates.js');

let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const withTZ = async (tz, fn) => {
  const saved = process.env.TZ;
  process.env.TZ = tz;
  try { return await fn(); } finally { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; }
};

// ── Every stored format ──────────────────────────────────────────────

test('toIsoDate: ISO, DD-MM-YYYY, unpadded, with a time, Date, Timestamp', () => {
  assert.strictEqual(toIsoDate('2025-05-28'), '2025-05-28');
  assert.strictEqual(toIsoDate('28-05-2025'), '2025-05-28');
  assert.strictEqual(toIsoDate('2025-5-8'), '2025-05-08');
  assert.strictEqual(toIsoDate('2025-05-28T23:30:00Z'), '2025-05-28', 'the date part is literal, never shifted');
  assert.strictEqual(toIsoDate(new Date(2025, 4, 28, 23, 59)), '2025-05-28');
  assert.strictEqual(toIsoDate({ toDate: () => new Date(2025, 4, 28) }), '2025-05-28');
});

test('toIsoDate: NN-NN-YYYY is read day-first, as the app always has', () => {
  assert.strictEqual(toIsoDate('03-04-2024'), '2024-04-03');
  assert.strictEqual(toIsoDate('05-05-2024'), '2024-05-05');
});

test('toIsoDate: unreadable and impossible dates give ""', () => {
  for (const v of [null, undefined, '', 'tomorrow', 'June 3 2019', '2025-02-30', '31-02-2025', '2025-13-01', 0, new Date(0), new Date('x')]) {
    assert.strictEqual(toIsoDate(v), '', String(v));
  }
});

test('storedDateShape: the migration buckets', () => {
  assert.strictEqual(storedDateShape('2025-05-28'), 'iso');
  assert.strictEqual(storedDateShape('28-05-2025'), 'dd-mm-yyyy');
  assert.strictEqual(storedDateShape('03-04-2024'), 'ambiguous');
  assert.strictEqual(storedDateShape('04-04-2024'), 'dd-mm-yyyy', 'same either way');
  assert.strictEqual(storedDateShape('2025-5-8'), 'iso-variant');
  assert.strictEqual(storedDateShape('2025-05-28T10:00:00Z'), 'iso-variant');
  assert.strictEqual(storedDateShape({ toDate: () => new Date() }), 'timestamp');
  assert.strictEqual(storedDateShape(''), 'missing');
  assert.strictEqual(storedDateShape('soon'), 'other');
  assert.strictEqual(storedDateShape(42), 'other');
});

test('parseDate: local midnight of the day, new Date(0) when unreadable', () => {
  const d = parseDate('28-05-2025');
  assert.deepStrictEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2025, 4, 28, 0]);
  assert.strictEqual(parseDate('nope').getTime(), 0);
});

test('formatDate: the same day for both formats; raw text when unreadable', () => {
  assert.strictEqual(formatDate('2025-05-28'), formatDate('28-05-2025'));
  assert.strictEqual(formatDate('TBA'), 'TBA');
  assert.strictEqual(formatDate(null), '');
});

test('showYear, monthDay', () => {
  assert.strictEqual(showYear('23-10-2019'), '2019', 'not "23" (B-06)');
  assert.strictEqual(showYear('2019-10-23'), '2019');
  assert.strictEqual(showYear('x'), '');
  assert.strictEqual(monthDay('23-10-2019'), '10-23');
});

test('compareShowDates: across formats; unreadable last', () => {
  const list = ['2025-05-28', '01-01-2024', 'x', '2024-06-01', '15-03-2025'];
  assert.deepStrictEqual(list.slice().sort(compareShowDates), ['01-01-2024', '2024-06-01', '15-03-2025', '2025-05-28', 'x']);
  assert.ok(sameShowDate('28-05-2025', '2025-05-28'));
  assert.ok(!sameShowDate('', ''));
});

test('daysBetweenDates: calendar days, across formats and DST', () => {
  assert.strictEqual(daysBetweenDates('2025-03-01', '01-04-2025'), 31);
  assert.ok(Number.isNaN(daysBetweenDates('x', '2025-01-01')));
});

test('fromSetlistfmDate', () => {
  assert.strictEqual(fromSetlistfmDate('28-05-2025'), '2025-05-28');
  assert.strictEqual(fromSetlistfmDate('2025-05-28'), '');
});

// ── Local "today" ─────────────────────────────────────────────────────

test('today / defaultShowDate: 8pm Pacific is still today, not tomorrow (B-02)', async () => {
  // 2026-11-13T04:00Z is 8pm on Nov 12 in Los Angeles.
  const now = new Date('2026-11-13T04:00:00Z');
  await withTZ('America/Los_Angeles', () => {
    assert.strictEqual(today(new Date(now)), '2026-11-12');
    assert.strictEqual(defaultShowDate(new Date(now)), '2026-11-12');
    assert.ok(!isPast('2026-11-12', new Date(now)), "tonight's show isn't past");
    assert.ok(!isUpcoming('2026-11-12', new Date(now)));
    assert.ok(isUpcoming('2026-11-13', new Date(now)));
  });
  await withTZ('America/New_York', () => assert.strictEqual(today(new Date(now)), '2026-11-12'));
  await withTZ('Europe/London', () => assert.strictEqual(today(new Date(now)), '2026-11-13'));
  await withTZ('Asia/Tokyo', () => assert.strictEqual(today(new Date(now)), '2026-11-13'));
  await withTZ('Pacific/Auckland', () => assert.strictEqual(today(new Date('2026-11-12T10:30:00Z')), '2026-11-12'));
});

test('localDateIso and utcIsoDate', async () => {
  await withTZ('America/Los_Angeles', () => {
    const t = new Date('2026-11-13T04:00:00Z');
    assert.strictEqual(localDateIso(t), '2026-11-12');
    assert.strictEqual(utcIsoDate(t), '2026-11-13');
    assert.strictEqual(utcIsoDate({ seconds: t.getTime() / 1000 }), '2026-11-13');
  });
});

// ── Dates people type (B-09) ──────────────────────────────────────────

test('parseImportDate: a month-name date is the same day east of UTC (B-09)', async () => {
  for (const tz of ['Europe/Berlin', 'Asia/Tokyo', 'America/Los_Angeles', 'UTC']) {
    await withTZ(tz, () => {
      assert.strictEqual(parseImportDate('March 4, 2024'), '2024-03-04', tz);
      assert.strictEqual(parseImportDate('4 March 2024'), '2024-03-04', tz);
      assert.strictEqual(parseImportDate('45355'), '2024-03-04', `${tz} Excel serial`);
    });
  }
});

test('parseImportDate: numeric dates read month-first when ambiguous; nonsense is null', () => {
  assert.strictEqual(parseImportDate('03/04/2024'), '2024-03-04');
  assert.strictEqual(parseImportDate('25/12/2024'), '2024-12-25');
  assert.strictEqual(parseImportDate('2024-03-04'), '2024-03-04');
  assert.strictEqual(parseImportDate('next friday'), null);
});

test('parseEnteredDate: flags ambiguity and offers both readings', () => {
  const r = parseEnteredDate('03/04/2024', { order: 'dmy' });
  assert.deepStrictEqual(r, { iso: '2024-04-03', ambiguous: true, alternatives: ['2024-03-04', '2024-04-03'] });
});

// ── Same night: duplicates, Shows Together, setlist scan ─────────────

const A = { artist: 'Goose', venue: 'Red Rocks', date: '2025-05-28' };
const B = { artist: 'goose ', venue: 'red rocks', date: '28-05-2025' };

test('duplicate check: the same night in two formats is a duplicate (B-07)', () => {
  assert.ok(isSameShow(A, B));
  assert.strictEqual(findDuplicate([B], A), B);
  assert.strictEqual(findDuplicate([{ ...B, date: '29-05-2025' }], A), null);
  assert.strictEqual(findDuplicate([{ ...B, venue: 'Fillmore' }], A), null);
  assert.strictEqual(findDuplicate([{ ...A, date: 'x' }], { ...A, date: 'x' }), null, 'unreadable dates never match');
});

test('Shows Together key: the same in both formats (B-08); setlist.fm id wins', () => {
  assert.strictEqual(showMatchKey(A), showMatchKey(B));
  assert.strictEqual(showMatchKey({ ...A, setlistfmId: '63abc' }), '63abc');
});

test('setlist scan: setlist.fm eventDate matches a show stored either way (B-06)', () => {
  assert.ok(setlistIsOnShowDate('28-05-2025', '2025-05-28'));
  assert.ok(setlistIsOnShowDate('28-05-2025', '28-05-2025'));
  assert.ok(!setlistIsOnShowDate('29-05-2025', '2025-05-28'));
  assert.ok(!setlistIsOnShowDate('28-05-2025', ''));
});

// ── Migration plan ────────────────────────────────────────────────────

test('migration: ISO kept, DD-MM fixed, unreadable to review', async () => {
  assert.deepStrictEqual(await planDateFix({ date: '2025-05-28' }), { action: 'keep', shape: 'iso' });
  assert.deepStrictEqual(await planDateFix({ date: '28-05-2025' }), { action: 'fix', shape: 'dd-mm-yyyy', to: '2025-05-28' });
  assert.deepStrictEqual(await planDateFix({ date: '2025-5-8' }), { action: 'fix', shape: 'iso-variant', to: '2025-05-08' });
  assert.strictEqual((await planDateFix({ date: 'soon' })).action, 'review');
  assert.strictEqual((await planDateFix({})).reason, 'no date');
});

test('migration: an ambiguous date is never guessed', async () => {
  const lookup = async (id) => ({ dayFirst: '2024-04-03', monthFirst: '2024-03-04', other: '2024-05-05', missing: '' }[id]);
  assert.deepStrictEqual(await planDateFix({ date: '03-04-2024', setlistfmId: 'dayFirst' }, { lookupSetlistDate: lookup }),
    { action: 'fix', shape: 'ambiguous', to: '2024-04-03' });
  assert.deepStrictEqual(await planDateFix({ date: '03-04-2024', setlistfmId: 'monthFirst' }, { lookupSetlistDate: lookup }),
    { action: 'fix', shape: 'ambiguous', to: '2024-03-04' });
  assert.strictEqual((await planDateFix({ date: '03-04-2024', setlistfmId: 'other' }, { lookupSetlistDate: lookup })).action, 'review');
  assert.strictEqual((await planDateFix({ date: '03-04-2024', setlistfmId: 'missing' }, { lookupSetlistDate: lookup })).action, 'review');
  assert.strictEqual((await planDateFix({ date: '03-04-2024' }, { lookupSetlistDate: lookup })).action, 'review', 'no id');
  assert.strictEqual((await planDateFix({ date: '03-04-2024', setlistfmId: 'x' }, { lookupSetlistDate: async () => null })).action, 'review', 'no key');
  assert.strictEqual((await planDateFix({ date: '03-04-2024', setlistfmId: 'x' })).action, 'review', 'not asked');
});

test('migration: a failed lookup sends that show to review and the run goes on', async () => {
  const lookup = async (id) => { if (id === 'down') throw new Error('timeout'); return '2024-04-03'; };
  const failed = await planDateFix({ date: '03-04-2024', setlistfmId: 'down' }, { lookupSetlistDate: lookup });
  assert.deepStrictEqual(failed, { action: 'review', shape: 'ambiguous', reason: 'ambiguous, setlist.fm lookup failed (timeout)' });
  const next = await planDateFix({ date: '03-04-2024', setlistfmId: 'ok' }, { lookupSetlistDate: lookup });
  assert.strictEqual(next.action, 'fix');
});

test('migration: a refused key (403) is asked once, then every later show goes to review', async () => {
  let calls = 0;
  const get = async () => { calls++; const e = new Error('setlist.fm 403'); e.status = 403; throw e; };
  const lookup = setlistfmLookup('a-real-looking-key', { get, delayMs: 0 });
  const r1 = await planDateFix({ date: '03-04-2024', setlistfmId: 'a' }, { lookupSetlistDate: lookup });
  const r2 = await planDateFix({ date: '05-06-2024', setlistfmId: 'b' }, { lookupSetlistDate: lookup });
  assert.strictEqual(calls, 1, 'not asked again');
  assert.strictEqual(r1.reason, 'ambiguous, setlist.fm lookup failed (setlist.fm 403)');
  assert.match(r2.reason, /lookup failed \(setlist\.fm 403: the key was refused, not asked again\)/);
});

test('migration: a 500 is not a refusal; the next show is still asked', async () => {
  let calls = 0;
  const get = async () => { calls++; if (calls === 1) { const e = new Error('setlist.fm 500'); e.status = 500; throw e; } return { eventDate: '03-04-2024' }; };
  const lookup = setlistfmLookup('a-real-looking-key', { get, delayMs: 0 });
  assert.strictEqual((await planDateFix({ date: '03-04-2024', setlistfmId: 'a' }, { lookupSetlistDate: lookup })).action, 'review');
  assert.deepStrictEqual(await planDateFix({ date: '03-04-2024', setlistfmId: 'b' }, { lookupSetlistDate: lookup }),
    { action: 'fix', shape: 'ambiguous', to: '2024-04-03' });
});

test('migration: a masked key (as netlify env:get prints a secret) counts as no key', async () => {
  assert.ok(!usableKey('****************abcd'));
  assert.ok(!usableKey(''));
  assert.ok(usableKey('0f3c2a1e-1234-4bcd-9a8b-0123456789ab'));
  let calls = 0;
  const lookup = setlistfmLookup('****************abcd', { get: async () => { calls++; return null; }, delayMs: 0 });
  assert.strictEqual((await planDateFix({ date: '03-04-2024', setlistfmId: 'x' }, { lookupSetlistDate: lookup })).reason,
    'ambiguous, SETLISTFM_API_KEY not set');
  assert.strictEqual(calls, 0);
});

test('migration: idempotent — a fixed date plans as keep', async () => {
  const first = await planDateFix({ date: '28-05-2025' });
  assert.deepStrictEqual(await planDateFix({ date: first.to }), { action: 'keep', shape: 'iso' });
});

for (const t of tests) {
  try { await t.fn(); passed++; } catch (err) { failed++; console.error(`✗ ${t.name}\n  ${err.message}`); }
}
console.log(`\nshowDate: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
