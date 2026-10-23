#!/usr/bin/env node
/**
 * setlist.fm attribution — netlify/functions/lib/setlistfmSetlist.js.
 *
 *   node tests/setlist-cache/attribution.test.js
 *
 * Why this test exists: setlist.fm's API terms require a followable link to
 * the setlist on setlist.fm wherever its data is shown, using the url each
 * API response carries. Until 5.47.5 no show stored that url, so the show
 * page's link never rendered. These tests pin how the url is found (cache,
 * then setlist.fm, then the home page), that a 429 is retried rather than
 * shown, and that the link HTML never says nofollow.
 */

const assert = require('node:assert');
const { Timestamp } = require('firebase-admin/firestore');
const {
  getSetlists, linkFrom, isSetlistId, isSetlistfmShow, setlistfmUrlFor,
  attributionHtml, creditHtml, SETLISTFM_HOME,
} = require('../../netlify/functions/lib/setlistfmSetlist');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const URL_A = 'https://www.setlist.fm/setlist/phish/2023/madison-square-garden-new-york-ny-63de4613.html';

function fakeDb(docs = {}) {
  return {
    docs,
    collection() {
      return {
        doc(id) {
          const ref = {
            async get() { return { exists: id in docs, data: () => docs[id], ref }; },
            async set(v) { docs[id] = v; },
            async update(v) { docs[id] = { ...docs[id], ...v }; },
          };
          return ref;
        },
      };
    },
  };
}

// A clock that only moves when the code sleeps, so budgets are exact.
function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms) => { t += ms; }, advance: (ms) => { t += ms; } };
}

function fetcher(responses) {
  const calls = [];
  return {
    calls,
    fetch: async (id) => {
      calls.push(id);
      const next = responses[id];
      const r = Array.isArray(next) ? next.shift() : next;
      if (r instanceof Error) throw r;
      return r || { status: 404, data: null };
    },
  };
}

process.env.SETLISTFM_API_KEY = process.env.SETLISTFM_API_KEY || 'test-key';

test('setlist ids: short hex only', () => {
  assert.ok(isSetlistId('63de4613'));
  assert.ok(isSetlistId('b99ed86'));
  assert.ok(!isSetlistId('../admin'));
  assert.ok(!isSetlistId(''));
  assert.ok(!isSetlistId(42));
});

test('linkFrom uses the response url, or the home page for anything else', () => {
  assert.deepStrictEqual(linkFrom({ url: URL_A, artist: { name: 'Phish' } }), { url: URL_A, artist: 'Phish' });
  assert.strictEqual(linkFrom({ url: 'https://evil.example/x' }).url, SETLISTFM_HOME);
  assert.strictEqual(linkFrom({}).url, SETLISTFM_HOME);
  assert.strictEqual(linkFrom(null).url, SETLISTFM_HOME);
});

test('isSetlistfmShow: an id and no band source', () => {
  assert.ok(isSetlistfmShow({ setlistfmId: 'abc1' }));
  assert.ok(isSetlistfmShow({ setlistfmId: 'abc1', setlistSource: 'setlistfm' }));
  assert.ok(!isSetlistfmShow({ setlistfmId: 'abc1', setlistSource: 'elgoose' }));
  assert.ok(!isSetlistfmShow({ setlistSource: 'setlistfm' }));
  assert.ok(!isSetlistfmShow(null));
});

test('getSetlists: a fresh cache entry is used without calling setlist.fm', async () => {
  const db = fakeDb({ setlist_63de4613: { response: JSON.stringify({ url: URL_A }), expiresAt: Timestamp.fromMillis(Date.now() + 3600e3) } });
  const f = fetcher({});
  const { setlists, pending } = await getSetlists(db, ['63de4613'], {}, { fetch: f.fetch });
  assert.strictEqual(setlists['63de4613'].url, URL_A);
  assert.deepStrictEqual(f.calls, []);
  assert.deepStrictEqual(pending, []);
});

test('getSetlists: an expired entry is refetched and recached for at most 24h', async () => {
  const db = fakeDb({ setlist_63de4613: { response: '{"url":"old"}', expiresAt: Timestamp.fromMillis(Date.now() - 1) } });
  const f = fetcher({ '63de4613': { status: 200, data: { url: URL_A } } });
  const { setlists } = await getSetlists(db, ['63de4613'], {}, { fetch: f.fetch, sleep: async () => {} });
  assert.strictEqual(setlists['63de4613'].url, URL_A);
  assert.deepStrictEqual(f.calls, ['63de4613']);
  const entry = db.docs.setlist_63de4613;
  assert.strictEqual(entry.ttlHours, 24);
  assert.ok(entry.expiresAt.toMillis() - entry.fetchedAt.toMillis() <= 24 * 3600e3);
});

test('getSetlists: a 429 is retried with backoff, not reported as an error', async () => {
  const clock = fakeClock();
  const slept = [];
  const f = fetcher({ '63de4613': [{ status: 429 }, { status: 429 }, { status: 200, data: { url: URL_A } }] });
  const { setlists, pending } = await getSetlists(fakeDb(), ['63de4613'], {}, {
    fetch: f.fetch, now: clock.now, sleep: async (ms) => { slept.push(ms); await clock.sleep(ms); },
  });
  assert.strictEqual(setlists['63de4613'].url, URL_A);
  assert.deepStrictEqual(pending, []);
  assert.deepStrictEqual(slept, [1000, 2000]);
});

test('getSetlists: still rate limited after retries -> pending, not an error', async () => {
  const clock = fakeClock();
  const f = fetcher({ '63de4613': [{ status: 429 }, { status: 429 }, { status: 429 }] });
  const warn = console.warn; console.warn = () => {};
  try {
    const r = await getSetlists(fakeDb(), ['63de4613'], {}, { fetch: f.fetch, now: clock.now, sleep: clock.sleep });
    assert.deepStrictEqual(r.pending, ['63de4613']);
    assert.deepStrictEqual(r.setlists, {});
  } finally { console.warn = warn; }
});

test('getSetlists: requests are spaced, and the time budget leaves the rest pending', async () => {
  const clock = fakeClock();
  const ids = ['aaaa1', 'aaaa2', 'aaaa3', 'aaaa4'];
  const responses = Object.fromEntries(ids.map((id) => [id, { status: 200, data: { url: URL_A } }]));
  const f = fetcher(responses);
  const slow = async (id) => { clock.advance(1000); return f.fetch(id); };
  const r = await getSetlists(fakeDb(), ids, { budgetMs: 2500 }, { fetch: slow, now: clock.now, sleep: clock.sleep });
  assert.deepStrictEqual(Object.keys(r.setlists), ['aaaa1', 'aaaa2']);
  assert.deepStrictEqual(r.pending, ['aaaa3', 'aaaa4']);
});

test('getSetlists: 404 is notFound; bad ids are ignored; duplicates fetched once', async () => {
  const f = fetcher({});
  const r = await getSetlists(fakeDb(), ['dead1', 'dead1', 'not-an-id'], {}, { fetch: f.fetch, sleep: async () => {} });
  assert.deepStrictEqual(r.notFound, ['dead1']);
  assert.deepStrictEqual(f.calls, ['dead1']);
});

test('setlistfmUrlFor: stored url, then setlist.fm, then the home page', async () => {
  assert.strictEqual(await setlistfmUrlFor(fakeDb(), { setlistfmId: '63de4613', setlistfmUrl: URL_A }), URL_A);
  const f = fetcher({ '63de4613': { status: 200, data: { url: URL_A } } });
  assert.strictEqual(await setlistfmUrlFor(fakeDb(), { setlistfmId: '63de4613' }, {}, { fetch: f.fetch }), URL_A);
  const gone = fetcher({});
  assert.strictEqual(await setlistfmUrlFor(fakeDb(), { setlistfmId: 'dead1' }, {}, { fetch: gone.fetch }), SETLISTFM_HOME);
  const broken = { fetch: async () => { throw new Error('offline'); } };
  const warn = console.warn; console.warn = () => {};
  try { assert.strictEqual(await setlistfmUrlFor(fakeDb(), { setlistfmId: '63de4613' }, {}, broken), SETLISTFM_HOME); } finally { console.warn = warn; }
});

test('attribution HTML: wording, link, and never nofollow', () => {
  const html = attributionHtml(URL_A, 'Phish');
  assert.ok(html.includes('Source: <a href="' + URL_A + '"'));
  assert.ok(html.includes('Phish setlist on setlist.fm'));
  assert.ok(!/nofollow/i.test(html));
  assert.ok(!/nofollow/i.test(creditHtml()));
  assert.ok(attributionHtml('', '').includes(`href="${SETLISTFM_HOME}"`));
  assert.ok(!attributionHtml(URL_A, '<script>').includes('<script>'));
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.stack}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
