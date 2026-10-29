/**
 * The spreadsheet import end to end on a 300-row file —
 * fixtures/import/concert-history-300.csv — from parsing to saved shows:
 * lib/importSheet.js reads it, lib/importMatch.js matches every row and
 * saves the chosen ones.
 *
 * The file has mixed date formats (ISO, 6/3/2019, "Jun 3, 2019",
 * "3 June 2019", 06-03-19, and an ambiguous 7/4/2003), a festival row with
 * three bands, five rows repeating earlier ones, four shows the account
 * already has, a typo'd artist, a row with no date, one with an unreadable
 * date, and two Internet Archive bands from 5.50.0.
 *
 * No network. setlist.fm is a fake built from the same rule that wrote the
 * file (every regular row has a setlist except every tenth), and
 * /api/band-setlist is the real function and the real Archive adapter,
 * replaying the archive.org responses in fixtures/internet-archive/.
 * Saving is a fake addShow with addShow's own duplicate check.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/importFlow.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { parseCSV } from '@/lib/utils';
import { detectColumns, inferDateOrder, buildRows, planShows, showKey, artistKey, summaryLine } from '@/lib/importSheet';
import { createMatchContext, matchShow, importShows } from '@/lib/importMatch';

const require = createRequire(import.meta.url);
const https = require('https');
const bandSetlistFn = require('../../netlify/functions/band-setlist.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV = fs.readFileSync(path.join(HERE, 'fixtures', 'import', 'concert-history-300.csv'), 'utf8');

let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ── The fakes ─────────────────────────────────────────────────────────

const ARTISTS = ['Billy Strings', 'Widespread Panic', "Umphrey's McGee", 'Dead & Company', 'Pearl Jam', 'The National', 'Sturgill Simpson'];
const VENUES = ['Red Rocks Amphitheatre', 'The Capitol Theatre', 'Madison Square Garden', 'The Fillmore', 'Ryman Auditorium'];
const ddmmyyyy = (iso) => iso.split('-').reverse().join('-');

// setlist.fm, as the generator wrote the file: regular row i is ARTISTS[i % 7]
// on 2010-01-01 + 9i days, with a setlist unless i % 10 === 0.
const SETLISTFM = [];
for (let i = 0; i < 285; i++) {
  const iso = new Date(Date.UTC(2010, 0, 1) + i * 9 * 86400000).toISOString().slice(0, 10);
  SETLISTFM.push({
    id: `sfm${i}`, url: `https://www.setlist.fm/x/${i}`, eventDate: ddmmyyyy(iso),
    artist: { name: ARTISTS[i % 7] },
    venue: { name: VENUES[i % 5], city: { name: 'Somewhere', stateCode: 'CO', country: { name: 'United States' } } },
    sets: { set: i % 10 === 0 ? [] : [{ song: [{ name: `Song A${i}` }, { name: `Song B${i}` }] }] },
  });
}
for (const a of ['Billy Strings', 'Greensky Bluegrass', 'Sierra Hull']) {
  SETLISTFM.push({
    id: `bonnaroo-${a}`, eventDate: '15-06-2019', artist: { name: a },
    venue: { name: 'Great Stage Park', city: { name: 'Manchester', stateCode: 'TN', country: { name: 'United States' } } },
    tour: { name: 'Bonnaroo 2019' },
    sets: { set: [{ song: [{ name: `${a} opener` }, { name: `${a} closer` }] }] },
  });
}

const calls = { setlistfm: 0, bandSetlist: 0 };

function setlistfmResponse(params) {
  calls.setlistfm++;
  const name = params.get('artistName');
  const date = params.get('date');
  const hits = SETLISTFM.filter((s) => artistKey(s.artist.name) === artistKey(name) && (!date || s.eventDate === ddmmyyyy(date)));
  return hits.length ? { status: 200, body: { setlist: hits } } : { status: 404, body: { code: 404 } };
}

// archive.org for the band-setlist function, from the Part A fixtures.
const IA_FIXTURES = {
  'keller-williams|2003-07-04': 'keller-williams/2003-07-04.json',
  'tea-leaf-green|2005-02-21': 'tea-leaf-green/2005-02-21.json',
};
let archiveResponses = {};
const realRequest = https.request;
https.request = (opts, ...rest) => {
  const cb = rest.find((x) => typeof x === 'function');
  const p = opts.path || opts.pathname;
  const req = new EventEmitter();
  req.setTimeout = () => {};
  req.end = () => {
    const hit = archiveResponses[p];
    const res = new EventEmitter();
    res.setEncoding = () => {};
    res.resume = () => {};
    res.statusCode = hit ? hit.status : 404;
    res.headers = {};
    process.nextTick(() => { cb(res); res.emit('data', hit ? hit.body : '{}'); res.emit('end'); });
  };
  return req;
};

async function fakeFetch(url) {
  const u = new URL(url, 'https://mysetlists.test');
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  if (u.pathname === '/.netlify/functions/search-setlists') {
    const { status, body } = setlistfmResponse(u.searchParams);
    return reply(status, body);
  }
  if (u.pathname === '/api/band-setlist') {
    calls.bandSetlist++;
    const q = Object.fromEntries(u.searchParams.entries());
    const file = IA_FIXTURES[`${q.artistId}|${q.date}`];
    archiveResponses = file
      ? JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'internet-archive', file), 'utf8')).responses
      : {};
    const res = await bandSetlistFn.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: q });
    return reply(res.statusCode, JSON.parse(res.body));
  }
  throw new Error(`unexpected request ${url}`);
}
globalThis.fetch = fakeFetch;

// addShow, as far as the import can see it: its own duplicate check
// (artist, venue, date) and a saved document.
function fakeAccount(existing) {
  const docs = [...existing];
  return {
    docs,
    save: async (data) => {
      const dup = docs.find((d) => d.artist.toLowerCase().trim() === data.artist.toLowerCase().trim()
        && (d.venue || '').toLowerCase().trim() === (data.venue || '').toLowerCase().trim() && d.date === data.date);
      if (dup) return { id: dup.id, duplicate: true };
      const id = `show${docs.length}`;
      docs.push({ ...data, id });
      return id;
    },
  };
}

const EXISTING = [
  { id: 'e1', artist: 'Phish', date: '2019-12-31', venue: 'Madison Square Garden' },
  { id: 'e2', artist: 'Goose', date: '2022-08-07', venue: 'Forest Hills Stadium' },
  { id: 'e3', artist: 'Pearl Jam', date: '2006-07-22', venue: 'Camden' },
  { id: 'e4', artist: 'The National', date: '2008-05-03', venue: 'Webster Hall' },
];

// What ImportView does, minus React: read, preview, match, import.
async function runImport(account, { split = true } = {}) {
  const table = parseCSV(CSV);
  const headers = table[0];
  const data = table.slice(1);
  const mapping = detectColumns(headers);
  const order = inferDateOrder(data.map((r) => r[mapping.date]));
  const rows = buildRows(data, mapping, { order, existingShows: account.docs });
  const festival = rows.filter((r) => r.artists.length > 1).map((r) => r.index);
  const shows = planShows(rows, {
    split: new Set(split ? festival : []),
    existingKeys: new Set(account.docs.map((d) => showKey(d.artist, d.date))),
  });
  // The preview: every importable show matched before anything is saved.
  const ctx = createMatchContext({ gapMs: 0 });
  const matches = new Map();
  for (const s of shows.filter((x) => !x.problem && !x.duplicate)) {
    // eslint-disable-next-line no-await-in-loop
    if (!matches.has(s.key)) matches.set(s.key, await matchShow({ artist: s.artist, date: s.date, venue: s.venue }, ctx));
  }
  const isPicked = (s) => !s.problem && !s.duplicate && matches.get(s.key)?.status !== 'unknown-artist';
  const result = await importShows(shows, {
    isPicked, matches, save: account.save, match: () => { throw new Error('everything was matched in the preview'); },
    artistColumn: mapping.artist, isSplit: (i) => split && festival.includes(i),
  });
  return { headers, mapping, order, rows, shows, matches, ...result };
}

// ── The tests ─────────────────────────────────────────────────────────

let first;
let account;

test('the file: 300 rows, columns found, month-first dates', async () => {
  account = fakeAccount(EXISTING);
  first = await runImport(account);
  assert.strictEqual(first.rows.length, 300);
  assert.deepStrictEqual(first.mapping, { artist: 0, date: 1, venue: 2, city: 3, state: 4, country: 5, rating: 6, comment: 7 });
  assert.strictEqual(first.order, 'mdy');
});

test('every regular row\'s date is read right, in all five formats', () => {
  for (let i = 0; i < 285; i++) {
    const want = new Date(Date.UTC(2010, 0, 1) + i * 9 * 86400000).toISOString().slice(0, 10);
    assert.strictEqual(first.rows[i].date.iso, want, `row ${i + 2}: "${first.rows[i].rawDate}"`);
  }
  // 7/4/2003 is flagged for the user, and read month-first.
  const kw = first.rows.find((r) => r.artist === 'Keller Williams');
  assert.strictEqual(kw.date.ambiguous, true);
  assert.strictEqual(kw.date.iso, '2003-07-04');
});

test('the preview: problems, duplicates and the typo are found before saving', () => {
  const problems = first.shows.filter((s) => s.problem);
  assert.deepStrictEqual(problems.map((s) => s.problem), ['No date', 'Can\'t read the date "sometime in 2010"']);
  const dups = first.shows.filter((s) => s.duplicate);
  assert.strictEqual(dups.filter((s) => s.duplicate === 'Already in your shows').length, 4);
  assert.strictEqual(dups.filter((s) => /^Same as row/.test(s.duplicate)).length, 5);
  const typo = first.matches.get(showKey('Billy Strngs', '2018-02-02'));
  assert.strictEqual(typo.status, 'unknown-artist');
  assert.match(typo.reason, /Billy Strngs/);
});

test('the result counts', () => {
  assert.deepStrictEqual(first.counts, {
    imported: 290, withSetlists: 260, toReview: 1, duplicates: 9, unmatched: 3, leftOut: 0, cancelled: false,
  });
  assert.strictEqual(summaryLine(first.counts),
    'Imported 290 shows; 260 with setlists; 1 tape setlist to review; 9 skipped as duplicates; 3 not matched');
});

test('no duplicate shows were created', () => {
  const keys = account.docs.map((d) => showKey(d.artist, d.date));
  assert.strictEqual(new Set(keys).size, keys.length);
  assert.strictEqual(account.docs.length, EXISTING.length + 290);
});

test('the festival row became three shows, each with its own setlist', () => {
  const day = account.docs.filter((d) => d.date === '2019-06-15');
  assert.deepStrictEqual(day.map((d) => d.artist).sort(), ['Billy Strings', 'Greensky Bluegrass', 'Sierra Hull']);
  day.forEach((d) => assert.strictEqual(d.setlist.length, 2));
  assert.ok(day.every((d) => d.venue === 'Bonnaroo'), 'the file\'s venue wins');
});

test('the not-imported rows, with their reasons, for the CSV', () => {
  const byArtist = first.unmatched.map((u) => [u.cells[0], u.reason]).sort();
  assert.deepStrictEqual(byArtist.map(([a]) => a), ['Billy Strngs', 'Greensky Bluegrass', 'Greensky Bluegrass']);
  assert.match(byArtist[0][1], /no artist called "Billy Strngs"/);
  assert.deepStrictEqual(byArtist.slice(1).map(([, r]) => r).sort(), ['Can\'t read the date "sometime in 2010"', 'No date']);
});

test('Internet Archive bands come in with tape setlists, labelled', () => {
  const tlg = account.docs.find((d) => d.artist === 'Tea Leaf Green');
  assert.strictEqual(tlg.setlistSource, 'archive');
  assert.strictEqual(tlg.sourceShowId, 'tlg2005-02-21.flac16');
  assert.strictEqual(tlg.sourcePermalink, 'https://archive.org/details/tlg2005-02-21.flac16');
  assert.strictEqual(tlg.setlist.length, 25);

  // A track list is never written unasked: it waits on the show for review.
  const kw = account.docs.find((d) => d.artist === 'Keller Williams');
  assert.deepStrictEqual(kw.setlist, []);
  assert.strictEqual(kw.setlistProposal.status, 'pending');
  assert.strictEqual(kw.setlistProposal.source, 'archive');
  assert.strictEqual(kw.setlistProposal.confidence, 'tracks-only');
  assert.strictEqual(kw.setlistProposal.sourcePermalink, 'https://archive.org/details/kw2003-07-04.shnf');
  assert.strictEqual(kw.setlistProposal.songs.length, 33);
});

test('ratings and notes come along', () => {
  const d = account.docs.find((x) => x.date === '2010-01-01');
  assert.strictEqual(d.rating, 1);
  assert.strictEqual(d.comment, 'Great night, "Tweezer" too');
});

test('importing the same file again creates nothing', async () => {
  const again = await runImport(account);
  assert.strictEqual(again.counts.imported, 0);
  // 300 rows less the two bad ones and the typo, with the festival row
  // counting as its three bands.
  assert.strictEqual(again.counts.duplicates, 300 - 2 - 1 - 1 + 3);
  assert.strictEqual(account.docs.length, EXISTING.length + 290);
});

test('a band-source artist with no show that night keeps its name and is never "unknown"', async () => {
  // setlist.fm also has a Belgian "GOOSE"; asking it "does Goose exist"
  // would rename the band. A registry band is known without asking.
  SETLISTFM.push({ id: 'be', eventDate: '07-08-2022', artist: { name: 'GOOSE' }, venue: { name: 'Pukkelpop', city: { name: 'Hasselt', country: { name: 'Belgium' } } }, sets: { set: [{ song: [{ name: 'Synrise' }] }] } });
  const before = calls.setlistfm;
  const m = await matchShow({ artist: 'Goose', date: '2022-08-07', venue: 'Forest Hills Stadium' }, createMatchContext({ gapMs: 0 }));
  assert.strictEqual(m.artist, 'Goose');
  assert.notStrictEqual(m.status, 'unknown-artist');
  assert.strictEqual(m.setlist, null, "the Belgian GOOSE's set that night is not Goose's");
  assert.strictEqual(m.venue, '');
  assert.strictEqual(calls.setlistfm - before, 1, 'one dated lookup, no "does this artist exist" lookup');
});

test('a setlist.fm 429 is waited out once, not reported as "no setlist"', async () => {
  let n = 0;
  const ctx = createMatchContext({
    gapMs: 0,
    sleep: async () => {},
    fetchImpl: async (url) => {
      n++;
      if (n === 1) return { ok: false, status: 429, json: async () => ({}) };
      return fakeFetch(url);
    },
  });
  const m = await matchShow({ artist: 'The National', date: new Date(Date.UTC(2010, 0, 1) + 5 * 9 * 86400000).toISOString().slice(0, 10), venue: '' }, ctx);
  assert.strictEqual(m.status, 'matched');
  assert.strictEqual(n, 2);
});

test('Stop keeps what is saved and imports nothing after it', async () => {
  const fresh = fakeAccount([]);
  const table = parseCSV(CSV);
  const mapping = detectColumns(table[0]);
  const rows = buildRows(table.slice(1, 21), mapping);
  const shows = planShows(rows);
  let saves = 0;
  const result = await importShows(shows, {
    isPicked: () => true,
    match: async () => ({ status: 'no-setlist' }),
    save: async (d) => { saves++; return fresh.save(d); },
    shouldStop: () => saves >= 5,
  });
  assert.strictEqual(result.counts.imported, 5);
  assert.strictEqual(result.counts.cancelled, true);
  assert.strictEqual(result.counts.leftOut, 15);
  assert.strictEqual(fresh.docs.length, 5);
});

for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.stack || err.message}`);
  }
}
https.request = realRequest;

console.log(`\nimportFlow: ${passed} passed, ${failed} failed (${calls.setlistfm} setlist.fm lookups, ${calls.bandSetlist} band-setlist lookups)\n`);
process.exit(failed > 0 ? 1 : 0);
