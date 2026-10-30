/**
 * The spreadsheet import's file reading — lib/importSheet.js: header
 * detection, dates (and which ones are ambiguous), several artists in one
 * cell, ratings, duplicates, and the not-imported CSV.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/importSheet.test.js
 */

import assert from 'assert';
import {
  detectColumns, headerSignature, parseShowDate, inferDateOrder, splitArtists, artistKey, showKey,
  parseRating, buildRows, expandRow, planShows, summaryLine, unmatchedCsv, showDataFor,
} from '@/lib/importSheet';
import { parseCSV } from '@/lib/utils';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) { failed++; console.error(`✗ ${name}\n  ${err.message}`); }
}

// ── Headers ───────────────────────────────────────────────────────────

test('common headers are recognised, whatever their case and punctuation', () => {
  const m = detectColumns(['Band(s)', 'Concert Date', 'Venue Name', 'City', 'State', 'Country', 'My Rating', 'Notes', 'Festival']);
  assert.deepStrictEqual(m, { artist: 0, date: 1, venue: 2, city: 3, state: 4, country: 5, rating: 6, comment: 7, tour: 8 });
});

test('other spellings: Artist, Show Date, Location, Province, Comments, Tour', () => {
  const m = detectColumns(['Show Date', 'ARTIST', 'Location', 'Town', 'Province', 'Comments', 'Tour Name']);
  assert.deepStrictEqual(m, { artist: 1, date: 0, venue: 2, city: 3, state: 4, comment: 5, tour: 6 });
});

test('a header is used once, and unknown headers map to nothing', () => {
  const m = detectColumns(['Date', 'Date', 'Who', 'Ticket price', 'Seat']);
  assert.strictEqual(m.date, 0);
  assert.strictEqual(m.artist, 2);
  assert.strictEqual(Object.keys(m).length, 2);
});

test('the same header row has the same signature, for remembering the mapping', () => {
  assert.strictEqual(headerSignature(['Artist', 'Date ']), headerSignature(['artist', 'date']));
  assert.notStrictEqual(headerSignature(['Artist', 'Date']), headerSignature(['Date', 'Artist']));
});

// ── Dates ─────────────────────────────────────────────────────────────

const iso = (v, o) => parseShowDate(v, o).iso;

test('ISO dates, with or without a time', () => {
  assert.strictEqual(iso('2019-06-03'), '2019-06-03');
  assert.strictEqual(iso('2019/6/3'), '2019-06-03');
  assert.strictEqual(iso('2019-06-03T20:00:00Z'), '2019-06-03');
});

test('US dates', () => {
  assert.strictEqual(iso('6/23/2019'), '2019-06-23');
  assert.strictEqual(iso('06-23-19'), '2019-06-23');
  assert.strictEqual(iso('12/25/1999'), '1999-12-25');
});

test('day-first dates that can only be day-first', () => {
  assert.strictEqual(iso('23/06/2019'), '2019-06-23');
  assert.strictEqual(iso('23.06.2019'), '2019-06-23');
});

test('month names, with weekdays and ordinals', () => {
  assert.strictEqual(iso('Jun 3, 2019'), '2019-06-03');
  assert.strictEqual(iso('June 3rd, 2019'), '2019-06-03');
  assert.strictEqual(iso('3 June 2019'), '2019-06-03');
  assert.strictEqual(iso('3-Jun-19'), '2019-06-03');
  assert.strictEqual(iso('Saturday, June 3, 2019'), '2019-06-03');
  assert.strictEqual(iso('Sept 9 2001'), '2001-09-09');
});

test('Excel day numbers and Date objects', () => {
  assert.strictEqual(iso('43619'), '2019-06-03');
  assert.strictEqual(iso(new Date(2019, 5, 3)), '2019-06-03');
});

test('03/04/2019 is ambiguous: both readings kept, the order decides', () => {
  const mdy = parseShowDate('03/04/2019');
  assert.strictEqual(mdy.ambiguous, true);
  assert.strictEqual(mdy.iso, '2019-03-04');
  assert.deepStrictEqual(mdy.alternatives, ['2019-03-04', '2019-04-03']);
  assert.strictEqual(iso('03/04/2019', { order: 'dmy' }), '2019-04-03');
  // Same day and month can only be read one way.
  assert.strictEqual(parseShowDate('04/04/2019').ambiguous, false);
});

test('impossible and unreadable dates are null, not a guess', () => {
  assert.strictEqual(iso('02/30/2019'), null);
  assert.strictEqual(iso('sometime in 2010'), null);
  assert.strictEqual(iso('13/13/2019'), null);
  assert.strictEqual(iso(''), null);
});

test('no timezone shift: a named-month date is the same day everywhere', () => {
  // new Date('Jun 3, 2019').toISOString() is June 2 east of UTC.
  const before = process.env.TZ;
  process.env.TZ = 'Pacific/Auckland';
  try { assert.strictEqual(iso('Jun 3, 2019'), '2019-06-03'); } finally { process.env.TZ = before; }
});

test('the file says which way it writes dates', () => {
  assert.strictEqual(inferDateOrder(['03/04/2019', '25/12/2019', '01/02/2018']), 'dmy');
  assert.strictEqual(inferDateOrder(['03/04/2019', '12/25/2019']), 'mdy');
  assert.strictEqual(inferDateOrder(['03/04/2019', '2019-01-01']), 'mdy');
});

// ── Artists ───────────────────────────────────────────────────────────

test('a bill or festival lineup splits on ; / | + newlines commas and w/', () => {
  assert.deepStrictEqual(splitArtists('Billy Strings; Greensky Bluegrass; Sierra Hull'), ['Billy Strings', 'Greensky Bluegrass', 'Sierra Hull']);
  assert.deepStrictEqual(splitArtists('Phish / Goose'), ['Phish', 'Goose']);
  assert.deepStrictEqual(splitArtists('Lettuce w/ Soulive'), ['Lettuce', 'Soulive']);
  assert.deepStrictEqual(splitArtists('Dead & Company'), ['Dead & Company']);
  assert.deepStrictEqual(splitArtists('AC/DC'), ['AC/DC']);
});

test('one key for the same act', () => {
  assert.strictEqual(artistKey('The National'), artistKey('national'));
  assert.strictEqual(artistKey('Dead & Company'), artistKey('Dead and Company'));
  assert.strictEqual(artistKey('Beyoncé'), artistKey('Beyonce'));
  assert.strictEqual(artistKey("Umphrey's McGee"), artistKey('Umphreys McGee'));
});

// ── Ratings ───────────────────────────────────────────────────────────

test('ratings become 1–10', () => {
  assert.strictEqual(parseRating('8'), 8);
  assert.strictEqual(parseRating('4/5'), 8);
  assert.strictEqual(parseRating('7/10'), 7);
  assert.strictEqual(parseRating('★★★★☆'), 8);
  assert.strictEqual(parseRating(''), null);
  assert.strictEqual(parseRating('great'), null);
  assert.strictEqual(parseRating('0'), null);
});

// ── Rows and duplicates ───────────────────────────────────────────────

const MAP = { artist: 0, date: 1, venue: 2 };

test('rows that can\'t be imported say why', () => {
  const rows = buildRows([['', '2019-01-01', 'X'], ['Phish', '', 'X'], ['Phish', 'soon', 'X']], MAP);
  assert.deepStrictEqual(rows.map((r) => r.problems), [['No artist'], ['No date'], ["Can't read the date \"soon\""]]);
});

test('duplicates: same artist and date as a logged show, or as an earlier row', () => {
  const rows = buildRows([
    ['The National', '2008-05-03', 'A'],
    ['Phish', 'Dec 31, 2019', 'MSG'],
    ['phish', '12/31/2019', 'Madison Square Garden'],
  ], MAP, { existingShows: [{ artist: 'National', date: '2008-05-03', venue: 'B' }] });
  assert.deepStrictEqual(rows.map((r) => r.duplicate), ['existing', null, 'file']);
});

test('planShows checks a split row\'s acts one by one', () => {
  const rows = buildRows([
    ['Goose', '2022-08-07', 'Forest Hills'],
    ['Goose; Mt. Joy; Pigeons Playing Ping Pong', '2022-08-07', 'Festival'],
  ], MAP);
  const shows = planShows(rows, { split: new Set([1]), existingKeys: new Set([showKey('Pigeons Playing Ping Pong', '2022-08-07')]) });
  assert.deepStrictEqual(shows.map((s) => [s.artist, s.duplicate]), [
    ['Goose', null],
    ['Goose', 'Same as row 2'],
    ['Mt. Joy', null],
    ['Pigeons Playing Ping Pong', 'Already in your shows'],
  ]);
  // Not split, the row is one show.
  assert.strictEqual(planShows(rows).length, 2);
  assert.strictEqual(expandRow(rows[1]).length, 1);
});

// ── Saving and the result ─────────────────────────────────────────────

test('showDataFor: the file wins, setlist.fm fills the gaps, a venue is required', () => {
  const show = { artist: 'the national', date: '2008-05-03', venue: '', city: '', state: 'NY', country: '', rating: 9, comment: 'x', tour: '' };
  const match = { status: 'matched', artist: 'The National', venue: 'Webster Hall', city: 'New York', state: 'NY', country: 'USA', tour: 'Boxer', setlist: [{ name: 'Fake Empire' }], setlistSource: 'setlistfm', setlistfmId: 'abc' };
  const data = showDataFor(show, match);
  assert.strictEqual(data.artist, 'The National');
  assert.strictEqual(data.venue, 'Webster Hall');
  assert.strictEqual(data.tour, 'Boxer');
  assert.strictEqual(data.rating, 9);
  assert.strictEqual(data.setlistfmId, 'abc');
  assert.ok(showDataFor(show, { status: 'no-setlist' }).skip);
  // An unknown artist keeps the file's spelling.
  assert.strictEqual(showDataFor({ ...show, venue: 'V' }, { status: 'unknown-artist', artist: 'x' }).artist, 'the national');
});

test('the summary line', () => {
  assert.strictEqual(
    summaryLine({ imported: 212, withSetlists: 180, duplicates: 9, unmatched: 23 }),
    'Imported 212 shows; 180 with setlists; 9 skipped as duplicates; 23 not matched'
  );
  assert.strictEqual(
    summaryLine({ imported: 1, withSetlists: 0, toReview: 1, duplicates: 0, unmatched: 0, cancelled: true }),
    'Imported 1 show; 0 with setlists; 1 tape setlist to review; 0 skipped as duplicates; 0 not matched (stopped early)'
  );
});

test('the not-imported CSV keeps the file\'s columns and adds the reason, and reads back', () => {
  const text = unmatchedCsv(['Artist', 'Date', 'Notes'], [
    { cells: ['Billy Strngs', '2018-02-02', 'said "wow", twice'], reason: 'setlist.fm has no artist called "Billy Strngs".' },
    { cells: ['Greensky Bluegrass'], reason: 'No date' },
  ]);
  const back = parseCSV(text);
  assert.deepStrictEqual(back[0], ['Artist', 'Date', 'Notes', 'Why not imported']);
  assert.deepStrictEqual(back[1], ['Billy Strngs', '2018-02-02', 'said "wow", twice', 'setlist.fm has no artist called "Billy Strngs".']);
  assert.deepStrictEqual(back[2], ['Greensky Bluegrass', '', '', 'No date']);
});

test('semicolon CSVs (Excel in comma-decimal locales)', () => {
  assert.deepStrictEqual(parseCSV('Artist;Date\nPhish;31.12.2019', ';'), [['Artist', 'Date'], ['Phish', '31.12.2019']]);
});

console.log(`\nimportSheet: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
