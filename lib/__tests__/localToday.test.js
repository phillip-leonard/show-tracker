/**
 * Local "today" (B-02, 5.59.10): every "today", default date and
 * upcoming/past decision uses the device's own calendar day.
 *
 * Pins 8pm Pacific and checks that a new show defaults to today, not
 * tomorrow; and guards the client code against the UTC idiom coming back.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/localToday.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { defaultShowDate, today, toIsoDate } from '@/lib/showDate';
import { todayIso, isUpcomingPast } from '@/lib/upcomingShows';
import { localIsoDate } from '@/lib/utils';

const require = createRequire(import.meta.url);
const { showDay } = require('../recommendations.js');
const ROOT = path.resolve(import.meta.dirname, '..', '..');

let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// 2026-11-13T04:00:00Z = 8:00pm on Thursday 12 November in Los Angeles.
const EIGHT_PM_PACIFIC = '2026-11-13T04:00:00Z';

test('8pm Pacific: a new show defaults to today, not tomorrow', () => {
  process.env.TZ = 'America/Los_Angeles';
  const now = new Date(EIGHT_PM_PACIFIC);
  assert.strictEqual(now.toISOString().slice(0, 10), '2026-11-13', 'UTC has already rolled over');
  assert.strictEqual(defaultShowDate(now), '2026-11-12');
  assert.strictEqual(today(now), '2026-11-12');
  assert.strictEqual(todayIso(now), '2026-11-12', 'upcoming shows use the same today');
  assert.strictEqual(localIsoDate(now), '2026-11-12', 'the lib/utils name too');
  assert.strictEqual(isUpcomingPast({ date: '2026-11-12' }, todayIso(now)), false, "tonight's show isn't past yet");
});

test('ShowForm starts its date from defaultShowDate()', () => {
  const src = fs.readFileSync(path.join(ROOT, 'components/ShowForm.jsx'), 'utf8');
  assert.ok(src.includes('initialData?.date || defaultShowDate()'));
});

test('no client code takes "today" or a show day from toISOString()', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '__tests__') continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(js|jsx)$/.test(ent.name) && !p.endsWith(path.join('lib', 'showDate.js'))) {
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (/toISOString\(\)\s*\.(slice\(0,\s*10\)|split\(['"]T['"]\)|substring\(0,\s*10\))/.test(line)) {
            offenders.push(`${path.relative(ROOT, p)}:${i + 1}`);
          }
        });
      }
    }
  };
  for (const d of ['lib', 'components', 'context', 'app', 'hooks']) walk(path.join(ROOT, d));
  assert.deepStrictEqual(offenders, []);
});

test('recommendations.showDay (CommonJS twin) reads dates as showDate does', () => {
  for (const d of ['2025-05-28', '28-05-2025', '2025-5-8', '03-04-2024', '2025-05-28T23:00:00Z']) {
    assert.strictEqual(showDay({ date: d }), toIsoDate(d), d);
  }
});

for (const t of tests) {
  try { await t.fn(); passed++; } catch (err) { failed++; console.error(`✗ ${t.name}\n  ${err.message}`); }
}
console.log(`\nlocalToday: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
