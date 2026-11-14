/**
 * lib/guestMerge.js — guest shows move into the account on sign-up, with
 * duplicate detection, and nothing on the device is lost when a write
 * fails (5.59.10, guest rescue).
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/guestMerge.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  mergeGuestShows, mergeMessage, readLocalShows, shouldShowRescue, RESCUE_SNOOZE_MS,
} from '@/lib/guestMerge';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const guest = (id, artist, date, extra = {}) => ({
  id, artist, venue: 'Red Rocks', city: 'Morrison', date, setlist: [], createdAt: '2026-11-01T00:00:00.000Z', isManual: true, ...extra,
});
const three = [
  guest('1762000000001', 'Goose', '2026-06-01'),
  guest('1762000000002', 'Phish', '01-07-2026'),
  guest('1762000000003', 'Billy Strings', '2026-08-01', { setlistfmId: '3bd' }),
];
const recorder = (failIds = []) => {
  const written = [];
  return {
    written,
    writeShow: async (doc) => {
      if (failIds.includes(doc.artist)) throw new Error('offline');
      written.push(doc);
    },
  };
};

test('a guest with 3 shows signs up: 3 saved, "3 shows saved"', async () => {
  const r = recorder();
  const result = await mergeGuestShows({ localShows: three, accountShows: [], writeShow: r.writeShow });
  assert.strictEqual(result.saved.length, 3);
  assert.strictEqual(r.written.length, 3);
  assert.deepStrictEqual(result.failed, []);
  assert.strictEqual(mergeMessage(result).message, '3 shows saved to your account.');
});

test('saved through the normal builder: ISO date, isManual by source, guest id kept', async () => {
  const r = recorder();
  const { saved } = await mergeGuestShows({ localShows: three, accountShows: [], writeShow: r.writeShow });
  assert.strictEqual(saved[1].date, '2026-07-01', 'DD-MM-YYYY normalized');
  assert.strictEqual(saved[0].isManual, true);
  assert.strictEqual(saved[2].isManual, false, 'has a setlist.fm id');
  assert.strictEqual(saved[0].id, '1762000000001');
  assert.strictEqual(saved[0].migratedFromLocal, true);
});

test('shows the account already has are skipped (any date format, or same id)', async () => {
  const r = recorder();
  const account = [
    { id: '1700000000000', artist: 'phish', venue: 'red rocks', date: '2026-07-01' },
    { id: '1762000000003', artist: 'Billy Strings', venue: 'Red Rocks', date: '2026-08-01' },
  ];
  const result = await mergeGuestShows({ localShows: three, accountShows: account, writeShow: r.writeShow });
  assert.deepStrictEqual(result.saved.map((s) => s.artist), ['Goose']);
  assert.strictEqual(result.duplicates.length, 2);
  assert.strictEqual(mergeMessage(result).message, '1 show saved to your account.');
});

test('the same show twice on the device is written once', async () => {
  const r = recorder();
  const result = await mergeGuestShows({
    localShows: [three[0], { ...three[0], id: '1762000000009', date: '01-06-2026' }],
    accountShows: [],
    writeShow: r.writeShow,
  });
  assert.strictEqual(r.written.length, 1);
  assert.strictEqual(result.duplicates.length, 1);
});

test('partial failure: the failed show stays on the device; a retry saves only it', async () => {
  const first = recorder(['Phish']);
  const r1 = await mergeGuestShows({ localShows: three, accountShows: [], writeShow: first.writeShow });
  assert.deepStrictEqual(r1.saved.map((s) => s.artist), ['Goose', 'Billy Strings']);
  assert.deepStrictEqual(r1.failed.map((s) => s.artist), ['Phish'], 'kept for next launch');
  assert.strictEqual(mergeMessage(r1).type, 'error');
  assert.match(mergeMessage(r1).message, /2 shows saved .* 1 show couldn't be saved yet\. They're still on this device/);

  // Next launch: the account now has the two that saved, the device has the one that didn't.
  const second = recorder();
  const r2 = await mergeGuestShows({ localShows: r1.failed, accountShows: first.written, writeShow: second.writeShow });
  assert.deepStrictEqual(r2.saved.map((s) => s.artist), ['Phish']);
  assert.deepStrictEqual(r2.failed, []);
});

test('interrupted after writing but before clearing the device: no double write', async () => {
  const r = recorder();
  const alreadyWritten = [{ ...three[0], date: '2026-06-01' }];
  const result = await mergeGuestShows({ localShows: three, accountShows: alreadyWritten, writeShow: r.writeShow });
  assert.ok(!r.written.some((d) => d.id === three[0].id));
  assert.strictEqual(result.duplicates.length, 1);
});

test('a guest id that clashes with an account show gets a fresh id', async () => {
  const r = recorder();
  const account = [{ id: '1762000000001', artist: 'Someone else', venue: 'Elsewhere', date: '2020-01-01' }];
  const { saved } = await mergeGuestShows({ localShows: [three[0]], accountShows: account, writeShow: r.writeShow });
  assert.notStrictEqual(saved[0].id, '1762000000001');
  assert.match(saved[0].id, /^\d{13}$/);
});

test('readLocalShows: junk and non-arrays are empty, not a crash', () => {
  assert.deepStrictEqual(readLocalShows(null), []);
  assert.deepStrictEqual(readLocalShows('{not json'), []);
  assert.deepStrictEqual(readLocalShows('{"a":1}'), []);
  assert.strictEqual(readLocalShows(JSON.stringify(three)).length, 3);
});

test('mergeMessage: nothing to say when nothing was on the device', () => {
  assert.strictEqual(mergeMessage({ saved: [], duplicates: [], failed: [] }), null);
  assert.match(mergeMessage({ saved: [], duplicates: [1], failed: [] }).message, /already in your account/);
});

test('rescue banner: guests with shows; snoozed for 7 days after dismissal', () => {
  const now = Date.UTC(2026, 10, 13);
  assert.ok(shouldShowRescue({ guestMode: true, showCount: 1, dismissedAt: null, now }));
  assert.ok(!shouldShowRescue({ guestMode: true, showCount: 0, now }), 'no shows yet');
  assert.ok(!shouldShowRescue({ guestMode: false, showCount: 5, now }), 'signed in');
  assert.ok(!shouldShowRescue({ guestMode: true, showCount: 2, dismissedAt: String(now - 1000), now }));
  assert.ok(shouldShowRescue({ guestMode: true, showCount: 2, dismissedAt: String(now - RESCUE_SNOOZE_MS - 1), now }));
});

test('AppContext: device copies removed only after the merge, failures kept; no Skip that deletes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'context/AppContext.jsx'), 'utf8');
  const start = src.indexOf('const rescueLocalShows = async');
  const body = src.slice(start, src.indexOf('useEffect(() => {', start));
  const merge = body.indexOf('await mergeGuestShows(');
  const keep = body.indexOf('storage.set(STORAGE_KEYS.GUEST_SHOWS, JSON.stringify(result.failed))');
  const removeGuest = body.indexOf('storage.remove(STORAGE_KEYS.GUEST_SHOWS)');
  assert.ok(merge > 0 && keep > merge && removeGuest > merge, 'nothing is removed before the writes');
  assert.ok(body.indexOf('return;') < merge, 'an unreadable account returns before writing or removing');
  assert.ok(!/handleSkipMigration|handleMigrateData|showMigrationPrompt/.test(src));
  const wrapper = fs.readFileSync(path.join(ROOT, 'app/AppProviderWrapper.jsx'), 'utf8');
  assert.ok(!/migration-prompt|Import Existing Shows/.test(wrapper));
  assert.ok(wrapper.includes('<GuestRescueBanner'));
});

for (const t of tests) {
  try { await t.fn(); passed++; } catch (err) { failed++; console.error(`✗ ${t.name}\n  ${err.message}`); }
}
console.log(`\nguestMerge: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
