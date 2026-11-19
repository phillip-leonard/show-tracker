#!/usr/bin/env node
/**
 * get-tour-shows' paged mode (5.60.37, native 4.0.43).
 *
 *   node tests/setlists/tourShowsPaging.test.js
 *
 * Why this test exists: the native "Add shows from a tour" sheet waited on
 * the whole tour walk (up to 10 setlist.fm pages) before it listed a single
 * night. With `page=N` it asks for one page at a time and lists the nights
 * as they come. These tests pin what the app relies on: one page per call,
 * the progress numbers, when the walk is complete, the per-page cache, and
 * the whole-tour entry written once the last page is in (so the web's
 * one-shot request and the next open get the cached tour).
 */

const assert = require('node:assert');
process.env.SETLISTFM_API_KEY = process.env.SETLISTFM_API_KEY || 'test-key';
const { tourPage, MAX_PAGES } = require('../../netlify/functions/get-tour-shows');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function fakeDb(docs = {}) {
  const writes = [];
  return {
    docs, writes,
    collection(name) {
      assert.strictEqual(name, 'setlistCache');
      return {
        doc(id) {
          const ref = {
            async get() { return { exists: id in docs, data: () => docs[id], ref }; },
            async set(value) { docs[id] = value; writes.push(id); },
            async update(value) { docs[id] = { ...docs[id], ...value }; },
          };
          return ref;
        },
      };
    },
  };
}

// A tour of `total` setlist.fm rows, 20 a page, newest first as setlist.fm
// sends them; every fifth row belongs to "Summer Tour 2025 (Europe)", which
// the loose tourName match lets through and the function filters out.
function fakeSetlistfm(total, { fail = {} } = {}) {
  const calls = [];
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `s${i}`,
    eventDate: `${String((i % 28) + 1).padStart(2, '0')}-0${6 + Math.floor(i / 28)}-2025`,
    artist: { name: 'Goose' },
    venue: { name: `Venue ${i}`, city: { name: 'City', state: 'CO', country: { name: 'United States' } } },
    tour: { name: i % 5 === 4 ? 'Summer Tour 2025 (Europe)' : 'Summer Tour 2025' },
    sets: { set: [{ song: [{ name: 'Arcadia' }] }] },
  }));
  async function fetchPage(mbid, tourName, page) {
    calls.push(page);
    if (fail[page]) return { status: fail[page], data: null };
    const slice = rows.slice((page - 1) * 20, page * 20);
    if (!slice.length) return { status: 404, data: { code: 404 } };
    return { status: 200, data: { setlist: slice, total, page, itemsPerPage: 20 } };
  }
  return { fetchPage, calls };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 10));

test('one page per call, with the progress numbers', async () => {
  const db = fakeDb();
  const upstream = fakeSetlistfm(45);
  const res = await tourPage({ mbid: 'm', tourName: 'Summer Tour 2025', page: 1, db, fetchPage: upstream.fetchPage });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['X-Cache'], 'MISS');
  const body = JSON.parse(res.body);
  assert.deepStrictEqual(upstream.calls, [1], 'only page 1 is fetched');
  assert.strictEqual(body.page, 1);
  assert.strictEqual(body.pages, 3);
  assert.strictEqual(body.seen, 20);
  assert.strictEqual(body.upstreamTotal, 45);
  assert.strictEqual(body.complete, false);
  assert.strictEqual(body.shows.length, 16, 'the other tour\'s rows are filtered out');
  assert.ok(body.shows.every(s => s.tour === 'Summer Tour 2025' && s.setlistfmId && s.date));
  const dates = body.shows.map(s => s.date);
  assert.deepStrictEqual(dates, [...dates].sort(), 'in date order');
});

test('the last page completes the walk and caches the whole tour', async () => {
  const db = fakeDb();
  const upstream = fakeSetlistfm(45);
  const all = [];
  for (let page = 1; ; page++) {
    const body = JSON.parse((await tourPage({ mbid: 'm', tourName: 'Summer Tour 2025', page, db, fetchPage: upstream.fetchPage })).body);
    all.push(...body.shows);
    if (body.complete) {
      assert.strictEqual(page, 3);
      assert.strictEqual(body.seen, 45);
      break;
    }
  }
  assert.strictEqual(all.length, 36);
  await flush();
  // The whole-tour entry is the one the unpaged request reads.
  const wholeKey = Object.keys(db.docs).find(k => k.startsWith('tourshows_'));
  assert.ok(wholeKey, 'whole tour cached');
  const whole = JSON.parse(db.docs[wholeKey].response);
  assert.strictEqual(whole.total, 36);
  assert.strictEqual(whole.shows.length, 36);
  assert.ok(db.docs[wholeKey].ttlHours <= 12);

  // Opening the tour again: page 1 answers with every night, from the cache.
  const again = await tourPage({ mbid: 'm', tourName: 'summer tour 2025 ', page: 1, db, fetchPage: upstream.fetchPage });
  assert.strictEqual(again.headers['X-Cache'], 'HIT');
  const body = JSON.parse(again.body);
  assert.strictEqual(body.complete, true);
  assert.strictEqual(body.shows.length, 36);
  assert.deepStrictEqual(upstream.calls, [1, 2, 3], 'no further upstream call');
});

test('each page is cached on its own', async () => {
  const db = fakeDb();
  const upstream = fakeSetlistfm(45);
  await tourPage({ mbid: 'm', tourName: 'Summer Tour 2025', page: 2, db, fetchPage: upstream.fetchPage });
  await flush();
  const res = await tourPage({ mbid: 'm', tourName: 'Summer Tour 2025', page: 2, db, fetchPage: upstream.fetchPage });
  assert.strictEqual(res.headers['X-Cache'], 'HIT');
  assert.deepStrictEqual(upstream.calls, [2]);
});

test('a tour with no nights logged is complete and empty', async () => {
  const db = fakeDb();
  const upstream = fakeSetlistfm(0);
  const body = JSON.parse((await tourPage({ mbid: 'm', tourName: 'Nothing Tour', page: 1, db, fetchPage: upstream.fetchPage })).body);
  assert.strictEqual(body.complete, true);
  assert.deepStrictEqual(body.shows, []);
  await flush();
  assert.deepStrictEqual(db.writes, [], 'a 404 is not cached');
});

test('setlist.fm\'s rate limit and failures pass through', async () => {
  const db = fakeDb();
  const limited = await tourPage({ mbid: 'm', tourName: 'Summer Tour 2025', page: 2, db, fetchPage: fakeSetlistfm(45, { fail: { 2: 429 } }).fetchPage });
  assert.strictEqual(limited.statusCode, 429);
  const broken = await tourPage({ mbid: 'm', tourName: 'Summer Tour 2025', page: 1, db, fetchPage: fakeSetlistfm(45, { fail: { 1: 500 } }).fetchPage });
  assert.strictEqual(broken.statusCode, 502);
  const timedOut = await tourPage({
    mbid: 'm', tourName: 'Summer Tour 2025', page: 1, db,
    fetchPage: async () => { throw Object.assign(new Error('slow'), { code: 'TIMEOUT' }); },
  });
  assert.strictEqual(timedOut.statusCode, 504);
  await flush();
  assert.deepStrictEqual(db.writes, [], 'no failure is cached');
});

test('a tour longer than the cap says so', async () => {
  const db = fakeDb();
  const upstream = fakeSetlistfm(260);
  const body = JSON.parse((await tourPage({ mbid: 'm', tourName: 'Summer Tour 2025', page: MAX_PAGES, db, fetchPage: upstream.fetchPage })).body);
  assert.strictEqual(body.pages, MAX_PAGES);
  assert.strictEqual(body.truncated, true);
  assert.strictEqual(body.complete, true);
});

test('the handler checks the page number', async () => {
  const { handler } = require('../../netlify/functions/get-tour-shows');
  const res = await handler({
    httpMethod: 'GET',
    headers: { origin: 'https://mysetlists.net', 'x-mysetlists-internal': 'x' },
    queryStringParameters: { mbid: 'm', tourName: 'T', page: '0' },
  });
  assert.strictEqual(res.statusCode, 400);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.stack}`); }
  }
  console.log(failed ? `\n${failed} failed` : `\n${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
