/**
 * Unit tests for lib/upcomingShows.js: shows the user is going to, kept
 * apart from their history so they never count toward stats.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/upcomingShows.test.js
 */

import assert from 'assert';
import {
  todayIso, isValidIsoDate, isUpcomingPast, sortUpcoming, normalizeUpcomingInput,
  validateUpcomingInput, eventToUpcomingInput, upcomingTagShowData, upcomingInputFromTag,
  goingFriends, findSetlistForDate, upcomingToShowData,
} from '@/lib/upcomingShows';
import { upcomingShowHref, showHref } from '@/lib/showRouting';

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

// ── Dates ───────────────────────────────────────────────────────────────

test('todayIso uses the local calendar day, zero-padded', () => {
  assert.strictEqual(todayIso(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
});

test('isValidIsoDate rejects impossible and malformed dates', () => {
  assert.strictEqual(isValidIsoDate('2026-02-28'), true);
  assert.strictEqual(isValidIsoDate('2026-02-30'), false);
  assert.strictEqual(isValidIsoDate('10/11/2026'), false);
  assert.strictEqual(isValidIsoDate(''), false);
});

test('a show is past only after its day, not on it', () => {
  assert.strictEqual(isUpcomingPast({ date: '2026-10-11' }, '2026-10-11'), false);
  assert.strictEqual(isUpcomingPast({ date: '2026-10-10' }, '2026-10-11'), true);
  assert.strictEqual(isUpcomingPast({ date: '2026-12-01' }, '2026-10-11'), false);
  assert.strictEqual(isUpcomingPast({}, '2026-10-11'), false);
});

test('sortUpcoming puts the soonest first without mutating its input', () => {
  const input = [{ date: '2026-12-01', artist: 'B' }, { date: '2026-11-01', artist: 'A' }];
  const sorted = sortUpcoming(input);
  assert.deepStrictEqual(sorted.map(s => s.artist), ['A', 'B']);
  assert.strictEqual(input[0].artist, 'B');
});

// ── Input ───────────────────────────────────────────────────────────────

test('normalizeUpcomingInput trims, nulls optional fields, and defaults the source', () => {
  const data = normalizeUpcomingInput({ artist: ' Goose ', venue: 'Red Rocks', date: '2026-12-01', source: 'bogus' });
  assert.strictEqual(data.artist, 'Goose');
  assert.strictEqual(data.time, null);
  assert.strictEqual(data.ticketUrl, null);
  assert.strictEqual(data.source, 'manual');
  assert.strictEqual(data.notes, '');
});

test('validateUpcomingInput requires artist, venue and a future date', () => {
  const today = '2026-10-11';
  assert.strictEqual(validateUpcomingInput({ venue: 'X', date: '2026-12-01' }, today), 'Add the artist.');
  assert.strictEqual(validateUpcomingInput({ artist: 'A', date: '2026-12-01' }, today), 'Add the venue.');
  assert.strictEqual(validateUpcomingInput({ artist: 'A', venue: 'X' }, today), 'Add the date.');
  assert.match(validateUpcomingInput({ artist: 'A', venue: 'X', date: '2026-10-10' }, today), /passed/);
  assert.strictEqual(validateUpcomingInput({ artist: 'A', venue: 'X', date: '2026-10-11' }, today), null);
});

test('a Ticketmaster event becomes form input with city and state joined', () => {
  const input = eventToUpcomingInput(
    { id: 'tm_123', date: '2026-12-01', time: '19:30:00', venue: 'Red Rocks', city: 'Morrison', state: 'CO', tmUrl: 'https://tm/x', sgUrl: null },
    'Goose',
  );
  assert.strictEqual(input.source, 'ticketmaster');
  assert.strictEqual(input.city, 'Morrison, CO');
  assert.strictEqual(input.ticketUrl, 'https://tm/x');
  assert.strictEqual(input.sourceEventId, 'tm_123');
});

test('a SeatGeek-only event is marked as SeatGeek', () => {
  const input = eventToUpcomingInput({ id: 'sg_9', date: '2026-12-01', venue: 'V', city: 'C', sgUrl: 'https://sg/y' }, 'A');
  assert.strictEqual(input.source, 'seatgeek');
  assert.strictEqual(input.ticketUrl, 'https://sg/y');
});

// ── Tags ────────────────────────────────────────────────────────────────

test('a tag carries event facts and the upcoming flag, never notes', () => {
  const data = upcomingTagShowData({ artist: 'A', venue: 'V', date: '2026-12-01', city: 'C', notes: 'private', taggedFriendUids: ['x'] });
  assert.strictEqual(data.upcoming, true);
  assert.strictEqual('notes' in data, false);
  assert.strictEqual('taggedFriendUids' in data, false);
});

test('accepting an upcoming tag builds the friend\'s copy with who tagged them', () => {
  const copy = upcomingInputFromTag({
    fromName: 'Sam', fromUid: 'u1', upcomingShowId: 'up1',
    showData: { artist: 'A', venue: 'V', date: '2026-12-01', city: 'C', upcoming: true },
  });
  assert.strictEqual(copy.taggedBy, 'Sam');
  assert.strictEqual(copy.taggedByUid, 'u1');
  assert.strictEqual(copy.originUpcomingId, 'up1');
  assert.strictEqual(copy.artist, 'A');
});

test('goingFriends drops blocked accounts and unknown uids', () => {
  const friends = [{ friendUid: 'a', friendName: 'Ann' }, { friendUid: 'b', friendName: 'Bo' }];
  const going = goingFriends({ taggedFriendUids: ['a', 'b', 'gone'] }, friends, ['b']);
  assert.deepStrictEqual(going.map(f => f.friendName), ['Ann']);
});

// ── Conversion ──────────────────────────────────────────────────────────

test('findSetlistForDate matches setlist.fm\'s DD-MM-YYYY date', () => {
  const setlists = [
    { id: '1', eventDate: '30-11-2026', venue: { name: 'Other' } },
    { id: '2', eventDate: '01-12-2026', venue: { name: 'Red Rocks' } },
  ];
  assert.strictEqual(findSetlistForDate(setlists, '2026-12-01', 'Red Rocks').id, '2');
  assert.strictEqual(findSetlistForDate(setlists, '2026-12-02', 'Red Rocks'), null);
});

test('two shows on one day: the one at the same venue wins', () => {
  const setlists = [
    { id: 'fest', eventDate: '01-12-2026', venue: { name: 'Festival Grounds' } },
    { id: 'late', eventDate: '01-12-2026', venue: { name: 'The Late Room' } },
  ];
  assert.strictEqual(findSetlistForDate(setlists, '2026-12-01', 'the late room').id, 'late');
});

test('converting keeps tags and notes and the upcoming date', () => {
  const show = { artist: 'A', venue: 'V', city: 'C', date: '2026-12-01', notes: 'GA', taggedFriendUids: ['x'], taggedBy: 'Sam', taggedByUid: 'u1' };
  const manual = upcomingToShowData(show);
  assert.deepStrictEqual(manual.taggedFriendUids, ['x']);
  assert.strictEqual(manual.comment, 'GA');
  assert.deepStrictEqual(manual.setlist, []);

  const withSetlist = upcomingToShowData(show, { artist: 'A', venue: 'V (setlist.fm)', date: '2026-12-01', setlist: [{ name: 'Song' }], setlistfmId: 'sf1' });
  assert.strictEqual(withSetlist.setlistfmId, 'sf1');
  assert.strictEqual(withSetlist.setlist.length, 1);
  assert.strictEqual(withSetlist.taggedBy, 'Sam');
  assert.strictEqual(withSetlist.date, '2026-12-01');
});

// ── Routing ─────────────────────────────────────────────────────────────

test('upcoming shows use a query param on the real /shows route, like past shows', () => {
  assert.strictEqual(upcomingShowHref('a b'), '/shows/?upcoming=a%20b');
  assert.strictEqual(showHref('123'), '/shows/?show=123');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
