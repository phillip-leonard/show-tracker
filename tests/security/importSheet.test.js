/**
 * Stage 6, Part 2b: import-sheet, the CSV and Excel import for the native
 * app (F-10, call C), against an in-memory Firestore:
 *   - parse: CSV (comma or semicolon) and Excel read with the web's code,
 *     columns and date order found, the caps (rows, columns, cell length,
 *     2 MB) and the refusals (type, empty, unreadable)
 *   - plan: rows into shows, duplicates against the caller's stored shows,
 *     splits, problems, the table checked against parse's caps
 *   - match: one show, the band source and setlist.fm through the stubbed
 *     in-process handlers, the csv-row input normalize-show accepts
 *   - accounts only; the daily counts
 *
 *   node tests/security/importSheet.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const Module = require('module');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');

let db;
let auth;
const fakeModules = {
  'firebase-admin/app': { getApps: () => [{}], initializeApp: () => ({}), cert: () => ({}) },
  'firebase-admin/auth': { getAuth: () => auth },
  'firebase-admin/firestore': { getFirestore: () => db, FieldValue: { serverTimestamp: () => new Date() } },
};
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (fakeModules[request]) return fakeModules[request];
  return realLoad.call(this, request, parent, isMain);
};

const XLSX = require('xlsx');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const importSheet = require('../../netlify/functions/import-sheet');
const { normalizeShowInput } = require('../../lib/normalizeShow');
const { SHEET_LIMITS, capTable, csvTable, parseCSV } = require('../../lib/sheetFile');

const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com', name: 'Alice' };
const GUEST = { uid: 'guestUid000001', firebase: { sign_in_provider: 'anonymous' } };

// setlist.fm, as search-setlists answers it.
const SETLISTFM = [
  {
    id: '63de4613', url: 'https://www.setlist.fm/setlist/phish/2024/msg-63de4613.html', eventDate: '31-12-2024',
    artist: { name: 'Phish' },
    venue: { name: 'Madison Square Garden', city: { name: 'New York', stateCode: 'NY', country: { name: 'United States' } } },
    tour: { name: 'NYE Run' },
    sets: { set: [{ name: 'Set I', song: [{ name: 'Tweezer' }, { name: 'Ghost' }] }] },
  },
];
let searches;
const searchHandler = async ({ queryStringParameters: q }) => {
  searches.push(q);
  const [d, m, y] = SETLISTFM[0].eventDate.split('-');
  const hits = SETLISTFM.filter((s) => s.artist.name.toLowerCase() === String(q.artistName).toLowerCase()
    && (!q.date || q.date === `${y}-${m}-${d}`));
  return hits.length ? { statusCode: 200, body: JSON.stringify({ setlist: hits }) } : { statusCode: 404, body: '{"code":404}' };
};
const bandHandler = async () => ({ statusCode: 200, body: JSON.stringify({ ok: false, songs: [], shows: [] }) });

function setup() {
  db = createFakeDb();
  auth = createFakeAuth({ tokens: { alice: ALICE, guest: GUEST }, users: [ALICE, { uid: GUEST.uid, providerData: [] }] });
  __setTestFirebase({ db, auth });
  searches = [];
  importSheet.__setTestDeps({ XLSX, searchHandler, bandHandler });
  db._put(`userProfiles/${ALICE.uid}`, { displayName: 'Alice' });
  db._put(`users/${ALICE.uid}/shows/a1`, { artist: 'Goose', venue: 'Red Rocks Amphitheatre', date: '2024-07-31' });
}

const call = (token, body) => importSheet.handler({
  httpMethod: 'POST',
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: JSON.stringify(body),
});
const json = (res) => JSON.parse(res.body);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

const CSV = [
  'Artist,Venue,City,Date,Rating,Notes',
  'Phish,Madison Square Garden,New York,12/31/2024,9,NYE',
  'Goose,Red Rocks Amphitheatre,Morrison,07/31/2024,,',
  'Billy Strings; Sierra Hull,Great Stage Park,Manchester,06/15/2019,4/5,',
  ',No Artist Hall,Nowhere,01/01/2020,,',
  'Phish,Madison Square Garden,New York,12/31/2024,,again',
].join('\n');

// ── parse ─────────────────────────────────────────────────────────────

test('parse reads a CSV and finds the columns and the date order', async () => {
  setup();
  const res = await call('alice', { action: 'parse', fileName: 'shows.csv', file: b64(`﻿${CSV}`) });
  assert.strictEqual(res.statusCode, 200, res.body);
  const p = json(res);
  assert.deepStrictEqual(p.headers, ['Artist', 'Venue', 'City', 'Date', 'Rating', 'Notes']);
  assert.strictEqual(p.rows.length, 5);
  assert.deepStrictEqual(p.mapping, { artist: 0, date: 3, venue: 1, city: 2, rating: 4, comment: 5 });
  assert.strictEqual(p.dateOrder, 'mdy');
  assert.strictEqual(p.dateOrderAmbiguous, false, 'every day is past 12, so each date reads one way');
  assert.strictEqual(p.truncated, false);
  assert.ok(p.signature.startsWith('artist|venue'));
});

test('a date that reads two ways is flagged, in parse and in plan', async () => {
  setup();
  const p = json(await call('alice', { action: 'parse', fileName: 'a.csv', file: b64('Artist,Date,Venue\nPhish,03/04/2019,MSG\n') }));
  assert.strictEqual(p.dateOrderAmbiguous, true);
  const { shows, counts } = json(await call('alice', { action: 'plan', headers: p.headers, rows: p.rows, mapping: p.mapping, dateOrder: 'dmy' }));
  assert.strictEqual(shows[0].date, '2019-04-03', 'read day first when the app says so');
  assert.strictEqual(shows[0].ambiguousDate, true);
  assert.strictEqual(counts.ambiguous, 1);
});

test('parse reads a semicolon CSV and an Excel workbook the same way', async () => {
  setup();
  const semi = await call('alice', { action: 'parse', fileName: 'eu.csv', file: b64('Band;Date;Venue\nPhish;31.12.2024;MSG\n') });
  assert.deepStrictEqual(json(semi).rows, [['Phish', '31.12.2024', 'MSG']]);
  assert.strictEqual(json(semi).dateOrder, 'dmy');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Artist', 'Show Date', 'Venue'], ['Phish', 45657, 'MSG']]), 'Shows');
  const file = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64');
  const res = await call('alice', { action: 'parse', fileName: 'shows.xlsx', file });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.deepStrictEqual(json(res).rows, [['Phish', '45657', 'MSG']], 'a date cell is the raw day number');
  assert.deepStrictEqual(json(res).mapping, { artist: 0, date: 1, venue: 2 });
});

test('parse caps rows, columns and cells, and says so', async () => {
  const wide = Array.from({ length: 40 }, (_, i) => `c${i}`);
  const long = 'x'.repeat(600);
  const table = [wide, ...Array.from({ length: 2100 }, (_, i) => [`Band ${i}`, long])];
  const capped = capTable(table);
  assert.strictEqual(capped.headers.length, SHEET_LIMITS.maxColumns);
  assert.strictEqual(capped.rows.length, SHEET_LIMITS.maxDataRows);
  assert.strictEqual(capped.rows[0][1].length, SHEET_LIMITS.maxCellChars);
  assert.strictEqual(capped.truncated, true);
  assert.strictEqual(capTable([['a'], ['b'], ['', ' ']]).truncated, false, 'blank rows drop without counting as cut');
  assert.deepStrictEqual(csvTable('a,"b ""c"""\r\n\r\nd,e'), [['a', 'b "c"'], ['d', 'e']]);
  assert.deepStrictEqual(parseCSV('x;y', ';'), [['x', 'y']]);
});

test('parse refuses other files, empty ones, unreadable ones and big ones', async () => {
  setup();
  const type = await call('alice', { action: 'parse', fileName: 'shows.pdf', file: b64('x') });
  assert.strictEqual(type.statusCode, 415);
  assert.strictEqual(json(type).code, 'bad_type');
  const empty = await call('alice', { action: 'parse', fileName: 'shows.csv', file: b64('Artist,Date\n') });
  assert.strictEqual(empty.statusCode, 400);
  assert.strictEqual(json(empty).code, 'empty');
  const broken = await call('alice', { action: 'parse', fileName: 'shows.xlsx', file: b64('not a workbook at all') });
  assert.ok([200, 400].includes(broken.statusCode), 'SheetJS reads plain text as a sheet or refuses it');
  const big = await call('alice', { action: 'parse', fileName: 'shows.csv', file: 'A'.repeat(Math.ceil(SHEET_LIMITS.maxFileBytes / 3) * 4 + 100) });
  assert.strictEqual(big.statusCode, 413);
  assert.match(json(big).error, /over 2 MB/);
});

// ── plan ──────────────────────────────────────────────────────────────

async function parsed() {
  return json(await call('alice', { action: 'parse', fileName: 'shows.csv', file: b64(CSV) }));
}

test('plan turns rows into shows, with duplicates against your stored shows', async () => {
  setup();
  const p = await parsed();
  const res = await call('alice', { action: 'plan', headers: p.headers, rows: p.rows, mapping: p.mapping, dateOrder: 'mdy' });
  assert.strictEqual(res.statusCode, 200, res.body);
  const { shows, counts } = json(res);
  assert.deepStrictEqual(shows.map((s) => [s.rowIndex, s.artist, s.date]), [
    [0, 'Phish', '2024-12-31'], [1, 'Goose', '2024-07-31'], [2, 'Billy Strings; Sierra Hull', '2019-06-15'],
    [3, '', null], [4, 'Phish', '2024-12-31'],
  ]);
  assert.strictEqual(shows[0].rating, 9);
  assert.strictEqual(shows[0].comment, 'NYE');
  assert.strictEqual(shows[1].duplicate, 'Already in your shows', 'Alice logged that Goose night');
  assert.strictEqual(shows[2].rating, 8, '4/5 reads as 8');
  assert.strictEqual(shows[2].canSplit, true);
  assert.strictEqual(shows[3].problem, 'No artist');
  assert.strictEqual(shows[4].duplicate, 'Same as row 2');
  assert.ok(!('row' in shows[0]) && !('cells' in shows[0]), 'the file\'s cells aren\'t sent back');
  assert.deepStrictEqual(counts, { rows: 5, shows: 5, ready: 2, problems: 1, duplicates: 2, ambiguous: 0 });
});

test('plan splits a bill when asked', async () => {
  setup();
  const p = await parsed();
  const { shows } = json(await call('alice', { action: 'plan', headers: p.headers, rows: p.rows, mapping: p.mapping, split: [2] }));
  assert.deepStrictEqual(shows.filter((s) => s.rowIndex === 2).map((s) => [s.part, s.artist]), [[0, 'Billy Strings'], [1, 'Sierra Hull']]);
});

test('plan checks the table it is sent', async () => {
  setup();
  const p = await parsed();
  const noDate = await call('alice', { action: 'plan', headers: p.headers, rows: p.rows, mapping: { artist: 0 } });
  assert.strictEqual(noDate.statusCode, 400);
  assert.strictEqual(json(noDate).code, 'bad_mapping');
  const outside = await call('alice', { action: 'plan', headers: p.headers, rows: p.rows, mapping: { artist: 0, date: 99 } });
  assert.strictEqual(outside.statusCode, 400);
  const tooMany = await call('alice', { action: 'plan', headers: ['Artist', 'Date'], rows: Array.from({ length: 2001 }, () => ['a', '1/1/2020']), mapping: { artist: 0, date: 1 } });
  assert.strictEqual(tooMany.statusCode, 413);
  const notStrings = await call('alice', { action: 'plan', headers: ['Artist', 'Date'], rows: [[{ evil: 1 }, '1/1/2020']], mapping: { artist: 0, date: 1 } });
  assert.strictEqual(notStrings.statusCode, 400);
});

// ── match ─────────────────────────────────────────────────────────────

test('match finds the setlist and returns the csv-row input normalize-show accepts', async () => {
  setup();
  const show = { artist: 'phish', date: '2024-12-31', venue: '', city: '', state: '', country: '', rating: 9, comment: 'NYE', tour: '' };
  const res = await call('alice', { action: 'match', show });
  assert.strictEqual(res.statusCode, 200, res.body);
  const m = json(res);
  assert.strictEqual(m.status, 'matched');
  assert.strictEqual(m.artist, 'Phish', 'setlist.fm\'s spelling');
  assert.deepStrictEqual(m.setlist, { count: 2, source: 'setlistfm' });
  assert.strictEqual(m.skip, null);
  assert.strictEqual(m.input.kind, 'csv-row');
  assert.strictEqual(m.input.venue, 'Madison Square Garden', 'the file had none; setlist.fm\'s fills it');
  assert.strictEqual(m.input.setlistfmId, '63de4613');
  assert.strictEqual(m.input.rating, 9);
  const normalized = await normalizeShowInput({ ...m.input, showId: 'n1' }, {}, { now: new Date('2026-11-20T00:00:00Z') });
  assert.strictEqual(normalized.show.artist, 'Phish');
  assert.strictEqual(normalized.show.setlist.length, 2);
  assert.ok(searches.length >= 1 && searches.length <= 4);
});

test('match says why a show can\'t be saved', async () => {
  setup();
  const res = await call('alice', { action: 'match', show: { artist: 'Nobody Band', date: '2020-01-01', venue: '' } });
  const m = json(res);
  assert.strictEqual(m.status, 'unknown-artist');
  assert.strictEqual(m.input, null);
  assert.match(m.skip, /No venue/);
  const withVenue = json(await call('alice', { action: 'match', show: { artist: 'Nobody Band', date: '2020-01-01', venue: 'The Club' } }));
  assert.strictEqual(withVenue.input.venue, 'The Club', 'a venue in the file is enough to save it without a setlist');
  assert.strictEqual(withVenue.setlist, null);
  const bad = await call('alice', { action: 'match', show: { artist: 'Phish', date: '31/12/2024' } });
  assert.strictEqual(bad.statusCode, 400);
});

// ── access ────────────────────────────────────────────────────────────

test('accounts only, and each action has a daily count', async () => {
  setup();
  const anon = await call(null, { action: 'parse', fileName: 'a.csv', file: b64(CSV) });
  assert.strictEqual(anon.statusCode, 401);
  const guest = await call('guest', { action: 'parse', fileName: 'a.csv', file: b64(CSV) });
  assert.strictEqual(guest.statusCode, 403);
  assert.strictEqual(json(guest).code, 'account_required');
  const unknown = await call('alice', { action: 'delete' });
  assert.strictEqual(unknown.statusCode, 400);

  for (let i = 0; i < importSheet.DAILY.parse; i++) {
    assert.strictEqual((await call('alice', { action: 'parse', fileName: 'a.csv', file: b64(CSV) })).statusCode, 200);
  }
  const over = await call('alice', { action: 'parse', fileName: 'a.csv', file: b64(CSV) });
  assert.strictEqual(over.statusCode, 429);
  assert.strictEqual(over.headers['Retry-After'], '3600');
  assert.strictEqual((await call('alice', { action: 'match', show: { artist: 'Phish', date: '2024-12-31' } })).statusCode, 200, 'counted per action');
});

run('import-sheet');
