/**
 * Unit tests for lib/adminUsers.js: the admin Users tab's rows, filters
 * and sorts, and the Stats tab's totals.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/adminUsers.test.js
 */

import assert from 'assert';
import {
  isoDay, presetRange, matchPreset, buildUserRows, filterRows, sortRows, computeTotals,
} from '@/lib/adminUsers';

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

const TODAY = new Date(2026, 9, 16, 15, 0); // Oct 16 2026, local

const profiles = [
  { id: 'alice', firstName: 'Alice', email: 'alice@x.test', createdAt: new Date(2026, 9, 10), showCount: 40, songCount: 400, ratedSongCount: 30 },
  // No createdAt on the profile (the post-5.36.2 case); Auth has the date.
  { id: 'bob', firstName: 'Bob', email: 'BOB@x.test', showCount: 5, songCount: 50, ratedSongCount: 2 },
  // Invited by alice via the profile fields; converted from a guest.
  { id: 'carol', displayName: 'Carol C', email: 'carol@x.test', createdAt: new Date(2026, 5, 1), showCount: 12, songCount: 100, ratedSongCount: 0,
    invitedByUid: 'alice', invitedByName: 'Alice', convertedFromGuest: true, guestConvertedAt: new Date(2026, 5, 1, 12) },
  // Test account, no date anywhere.
  { id: 'tess', firstName: 'Tess', email: 'tess@x.test', isTestUser: true, showCount: 99, songCount: 999, ratedSongCount: 99 },
];
const guestSessions = [
  { id: 'g1', startedAt: new Date(2026, 9, 15), converted: false, showsAdded: 3 },
  { id: 'g2', startedAt: new Date(2026, 4, 30), converted: true, convertedUserId: 'carol', convertedAt: new Date(2026, 5, 1, 12), showsAdded: 2 },
];
const invites = [
  { inviterUid: 'alice', inviteeEmail: 'carol@x.test', status: 'accepted' },
  { inviterUid: 'alice', inviteeEmail: 'nobody@x.test', status: 'pending' },
  // Bob was invited by email but his profile predates invitedBy* fields.
  { inviterUid: 'carol', inviterName: 'Carol', inviterEmail: 'carol@x.test', inviteeEmail: 'bob@x.test', status: 'accepted' },
];
const authDates = { bob: '2026-10-01T18:00:00.000Z', alice: '2026-10-09T08:00:00.000Z' };

const rows = buildUserRows({ profiles, guestSessions, invites, authDates });
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

// ── Dates and presets ───────────────────────────────────────────────────

test('presets are inclusive ranges ending today', () => {
  assert.deepStrictEqual(presetRange('7d', TODAY), { from: '2026-10-10', to: '2026-10-16' });
  assert.deepStrictEqual(presetRange('30d', TODAY), { from: '2026-09-17', to: '2026-10-16' });
  assert.deepStrictEqual(presetRange('90d', TODAY), { from: '2026-07-19', to: '2026-10-16' });
  assert.deepStrictEqual(presetRange('all', TODAY), { from: '', to: '' });
});

test('matchPreset recognises a preset range and nothing else', () => {
  assert.strictEqual(matchPreset('2026-09-17', '2026-10-16', TODAY), '30d');
  assert.strictEqual(matchPreset('', '', TODAY), 'all');
  assert.strictEqual(matchPreset('2026-09-01', '2026-10-16', TODAY), null);
});

test('isoDay uses the local calendar', () => {
  assert.strictEqual(isoDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

// ── Rows ────────────────────────────────────────────────────────────────

test('one row per profile, plus unconverted guest sessions only', () => {
  assert.strictEqual(rows.length, 5);
  assert.ok(byId['guest:g1']);
  assert.ok(!byId['guest:g2'], 'a converted guest appears only as their account');
  assert.strictEqual(byId['guest:g1'].kind, 'trial');
  assert.strictEqual(byId['guest:g1'].showCount, 3);
});

test('signup date prefers Auth, then createdAt, then null — never today', () => {
  assert.strictEqual(byId.alice.signupDate.toISOString(), '2026-10-09T08:00:00.000Z');
  assert.strictEqual(byId.bob.signupDate.toISOString(), '2026-10-01T18:00:00.000Z');
  assert.strictEqual(byId.carol.signupDate.getTime(), new Date(2026, 5, 1).getTime());
  assert.strictEqual(byId.tess.signupDate, null);
});

test('invites sent counts every invite, accepted or not', () => {
  assert.strictEqual(byId.alice.invitesSent, 2);
  assert.strictEqual(byId.carol.invitesSent, 1);
  assert.strictEqual(byId.bob.invitesSent, 0);
});

test('invited by comes from the profile, else an accepted invite by email', () => {
  assert.deepStrictEqual(byId.carol.invitedBy, { uid: 'alice', name: 'Alice', email: 'alice@x.test' });
  // Case-insensitive email match.
  assert.deepStrictEqual(byId.bob.invitedBy, { uid: 'carol', name: 'Carol', email: 'carol@x.test' });
  assert.strictEqual(byId.alice.invitedBy, null);
});

test('converted carries the conversion date', () => {
  assert.strictEqual(byId.carol.converted, true);
  assert.strictEqual(byId.carol.convertedAt.getTime(), new Date(2026, 5, 1, 12).getTime());
  assert.strictEqual(byId.alice.converted, false);
  assert.strictEqual(byId.alice.convertedAt, null);
});

// ── Filters ─────────────────────────────────────────────────────────────

const ids = (list) => list.map((r) => r.id).sort();

test('real users is the default; test and all work', () => {
  assert.deepStrictEqual(ids(filterRows(rows)), ['alice', 'bob', 'carol', 'guest:g1']);
  assert.deepStrictEqual(ids(filterRows(rows, { testFilter: 'test' })), ['tess']);
  assert.strictEqual(filterRows(rows, { testFilter: 'all' }).length, 5);
});

test('account type filter', () => {
  assert.deepStrictEqual(ids(filterRows(rows, { accountType: 'trial' })), ['guest:g1']);
  assert.deepStrictEqual(ids(filterRows(rows, { accountType: 'full', testFilter: 'all' })), ['alice', 'bob', 'carol', 'tess']);
});

test('date range is inclusive on both ends and drops undated rows', () => {
  const r = filterRows(rows, { from: '2026-10-01', to: '2026-10-15', testFilter: 'all' });
  assert.deepStrictEqual(ids(r), ['alice', 'bob', 'guest:g1']);
  // A start date alone, or an end date alone.
  assert.deepStrictEqual(ids(filterRows(rows, { from: '2026-10-10' })), ['guest:g1']);
  assert.deepStrictEqual(ids(filterRows(rows, { to: '2026-06-30' })), ['carol']);
});

test('filters combine', () => {
  const r = filterRows(rows, { ...presetRange('30d', TODAY), accountType: 'full', testFilter: 'real', search: 'b' });
  assert.deepStrictEqual(ids(r), ['bob']);
});

test('search matches name or email, case-insensitive', () => {
  assert.deepStrictEqual(ids(filterRows(rows, { search: 'CAROL' })), ['carol']);
  assert.deepStrictEqual(ids(filterRows(rows, { search: 'bob@' })), ['bob']);
});

// ── Sorts ───────────────────────────────────────────────────────────────

const order = (list) => list.map((r) => r.id);
const real = filterRows(rows, { testFilter: 'all' });

test('signup date sorts both ways with undated rows last', () => {
  assert.deepStrictEqual(order(sortRows(real, { key: 'signupDate', dir: 'desc' })), ['guest:g1', 'alice', 'bob', 'carol', 'tess']);
  assert.deepStrictEqual(order(sortRows(real, { key: 'signupDate', dir: 'asc' })), ['carol', 'bob', 'alice', 'guest:g1', 'tess']);
});

test('shows and invites sent sort numerically', () => {
  assert.deepStrictEqual(order(sortRows(real, { key: 'showCount', dir: 'desc' })), ['tess', 'alice', 'carol', 'bob', 'guest:g1']);
  assert.deepStrictEqual(order(sortRows(real, { key: 'invitesSent', dir: 'desc' })).slice(0, 2), ['alice', 'carol']);
  assert.strictEqual(order(sortRows(real, { key: 'showCount', dir: 'asc' }))[0], 'guest:g1');
});

test('invited-by and converted put yes first on desc, last on asc', () => {
  const invitedFirst = order(sortRows(real, { key: 'invitedBy', dir: 'desc' }));
  assert.deepStrictEqual(invitedFirst.slice(0, 2).sort(), ['bob', 'carol']);
  const notInvitedFirst = order(sortRows(real, { key: 'invitedBy', dir: 'asc' }));
  assert.deepStrictEqual(notInvitedFirst.slice(-2).sort(), ['bob', 'carol']);
  assert.strictEqual(order(sortRows(real, { key: 'converted', dir: 'desc' }))[0], 'carol');
  assert.strictEqual(order(sortRows(real, { key: 'converted', dir: 'asc' })).at(-1), 'carol');
});

test('sorting does not mutate its input', () => {
  const before = order(real);
  sortRows(real, { key: 'showCount', dir: 'asc' });
  assert.deepStrictEqual(order(real), before);
});

// ── Totals ──────────────────────────────────────────────────────────────

test('totals exclude test users by default', () => {
  assert.deepStrictEqual(computeTotals(profiles), {
    totalUsers: 3, totalShows: 57, totalSongs: 550, totalRated: 32, testUsers: 1,
  });
});

test('totals can include test users', () => {
  const t = computeTotals(profiles, { includeTestUsers: true });
  assert.strictEqual(t.totalUsers, 4);
  assert.strictEqual(t.totalShows, 156);
  assert.strictEqual(t.totalRated, 131);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
