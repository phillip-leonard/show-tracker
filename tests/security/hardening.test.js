/**
 * 5.59.12 function hardening (#398 follow-ups). One section per function:
 * an allowed case, a denied case and an over-limit case each.
 *
 *   node tests/security/hardening.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb } = require('../email/fakeFirestore');

// ── heard-share ───────────────────────────────────────────────────────

const heardShare = require('../../netlify/functions/heard-share');

function memoryStore() {
  const m = new Map();
  return { m, get: async (k) => m.get(k) || null, set: async (k, v) => { m.set(k, v); } };
}
const shareDeps = (db, store = memoryStore()) => ({ store, knownBand: (s) => s === 'goose', limitOpts: { db } });
const post = (body, ip = '1.2.3.4') => ({
  httpMethod: 'POST',
  headers: { 'x-nf-client-connection-ip': ip },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('heard-share: a valid share is stored under a server-made id', async () => {
  const deps = shareDeps(createFakeDb());
  const r = await heardShare.handleHeardShare(post({ slug: 'goose', code: 'aABC_-123' }), deps);
  assert.strictEqual(r.statusCode, 200);
  const { id } = JSON.parse(r.body);
  assert.match(id, /^b[A-Za-z0-9_-]{16}$/);
  assert.deepStrictEqual([...deps.store.m.keys()], [`goose/${id}`]);
});

test('heard-share: extra fields, wrong types, unknown bands and bad codes are refused', async () => {
  const deps = shareDeps(createFakeDb());
  for (const body of [
    { slug: 'goose', code: 'aABC', note: 'hi' },
    { slug: 'goose', code: 123 },
    { slug: 'phish-not-listed', code: 'aABC' },
    { slug: 'goose', code: 'not-a-code' },
    { slug: 'goose', code: 'a<script>' },
    '[1,2]',
    'not json',
  ]) {
    const r = await heardShare.handleHeardShare(post(body), deps);
    assert.strictEqual(r.statusCode, 400, JSON.stringify(body));
    assert.deepStrictEqual(JSON.parse(r.body), { ok: false, error: 'bad_request' });
  }
  assert.strictEqual(deps.store.m.size, 0);
});

test('heard-share: an oversize body is 413 before it is parsed', async () => {
  const r = await heardShare.handleHeardShare(post({ slug: 'goose', code: `a${'x'.repeat(heardShare.MAX_BODY)}` }), shareDeps(createFakeDb()));
  assert.strictEqual(r.statusCode, 413);
});

test('heard-share: 50 stores per network per day, then 429; another network is unaffected', async () => {
  process.env.PROXY_LIMIT_HEARDSHARE = '2';
  const deps = shareDeps(createFakeDb());
  assert.strictEqual((await heardShare.handleHeardShare(post({ slug: 'goose', code: 'aA' }), deps)).statusCode, 200);
  assert.strictEqual((await heardShare.handleHeardShare(post({ slug: 'goose', code: 'aB' }), deps)).statusCode, 200);
  const third = await heardShare.handleHeardShare(post({ slug: 'goose', code: 'aC' }), deps);
  assert.strictEqual(third.statusCode, 429);
  assert.strictEqual((await heardShare.handleHeardShare(post({ slug: 'goose', code: 'aD' }, '9.9.9.9'), deps)).statusCode, 200);
  delete process.env.PROXY_LIMIT_HEARDSHARE;
  assert.strictEqual(require('../../netlify/functions/lib/proxyLimit').limitFor('heardshare'), 50);
});

test('heard-share: reading a share stays public and returns only the code', async () => {
  const deps = shareDeps(createFakeDb());
  const { id } = JSON.parse((await heardShare.handleHeardShare(post({ slug: 'goose', code: 'aXYZ' }), deps)).body);
  const r = await heardShare.handleHeardShare({ httpMethod: 'GET', headers: {}, queryStringParameters: { slug: 'goose', id } }, deps);
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(r.body), { ok: true, code: 'aXYZ' });
});

// ── Cache-writing functions ───────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const FN = path.join(__dirname, '../../netlify/functions');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { checkProxyLimit, limitFor } = require('../../netlify/functions/lib/proxyLimit');
const { cacheName, isoDay, cacheable, MAX_CACHED_BYTES } = require('../../netlify/functions/lib/cacheGuard');
const { writeEntry, MAX_RESPONSE_BYTES } = require('../../netlify/functions/lib/setlistCache');
const get = (fn, q, ip = '5.6.7.8') => require(path.join(FN, fn)).handler({ httpMethod: 'GET', headers: { 'x-nf-client-connection-ip': ip }, queryStringParameters: q });

test('cacheGuard: names, days and sizes', () => {
  assert.strictEqual(cacheName('  Goose  Band '), 'Goose Band');
  assert.strictEqual(cacheName(''), null);
  assert.strictEqual(cacheName('x'.repeat(201)), null);
  assert.strictEqual(cacheName('a\u0000b'), null);
  assert.strictEqual(isoDay('2024-02-29'), '2024-02-29');
  assert.strictEqual(isoDay('2023-02-29'), null);
  assert.strictEqual(isoDay('../../x'), null);
  assert.ok(cacheable('x'.repeat(MAX_CACHED_BYTES)));
  assert.ok(!cacheable('x'.repeat(MAX_CACHED_BYTES + 1)));
});

for (const [fn, q] of [
  ['enrich-artist.js', { name: 'x'.repeat(300) }],
  ['get-entity-info.js', { name: 'Goose', type: 'band' }],
  ['get-entity-info.js', { name: '' }],
  ['archival-audio-lookup.js', { artist: 'Goose', date: '2024-13-40' }],
  ['archival-audio-lookup.js', { artist: 'x'.repeat(300), date: '2024-06-01' }],
]) {
  test(`${fn}: invalid input is 400 with a generic body, before any upstream call (${JSON.stringify(q).slice(0, 40)})`, async () => {
    const r = await get(fn, q);
    assert.strictEqual(r.statusCode, 400);
    assert.deepStrictEqual(JSON.parse(r.body), { error: 'bad_request' });
  });
}

test('metadata limit: allowed under the cap, 429 over it, before reaching upstream', async () => {
  const db = createFakeDb();
  __setTestFirebase({ db });
  process.env.PROXY_LIMIT_METADATA = '1';
  try {
    assert.strictEqual(await checkProxyLimit({ httpMethod: 'GET', headers: { 'x-nf-client-connection-ip': '7.7.7.7' } }, 'metadata'), null, 'first miss allowed');
    for (const [fn, q] of [
      ['enrich-artist.js', { name: 'Goose' }],
      ['get-entity-info.js', { name: 'Goose', type: 'artist' }],
      ['archival-audio-lookup.js', { artist: 'Goose', date: '2024-06-01' }],
    ]) {
      const r = await get(fn, q, '7.7.7.7');
      assert.strictEqual(r.statusCode, 429, fn);
      assert.ok(r.headers['Retry-After']);
    }
  } finally {
    delete process.env.PROXY_LIMIT_METADATA;
  }
  assert.strictEqual(limitFor('metadata'), 300);
});

test('the server builds every cache key; failures are not cached', () => {
  const read = (f) => fs.readFileSync(path.join(FN, f), 'utf8');
  const enrich = read('enrich-artist.js');
  assert.ok(enrich.includes('if (db && (mb || discogs) && cacheable(responseBody))'), 'enrich caches only when a source answered');
  assert.ok(read('get-entity-info.js').includes('if (db && cacheable(responseBody))'));
  const archival = read('archival-audio-lookup.js');
  assert.ok(archival.includes("res.statusCode === 200 || res.statusCode === 404"), 'only a real "no recordings" is a negative');
  for (const f of ['enrich-artist.js', 'get-entity-info.js', 'archival-audio-lookup.js']) {
    assert.ok(/cacheName\(/.test(read(f)), `${f} validates its name`);
    assert.ok(read(f).includes("checkProxyLimit(event, 'metadata')"), `${f} counts misses`);
  }
  assert.ok(!fs.existsSync(path.join(FN, 'get-artist-stats.js')), 'get-artist-stats is removed');
});

test('setlist cache: an oversize response is not written', async () => {
  const db = createFakeDb();
  await writeEntry(db, 'big', { response: 'x'.repeat(MAX_RESPONSE_BYTES + 1), ttlHours: 1 });
  await writeEntry(db, 'ok', { response: '{"setlist":[]}', ttlHours: 1 });
  assert.strictEqual(db._get('setlistCache/big'), undefined);
  assert.ok(db._get('setlistCache/ok'));
});

module.exports = { run };
if (require.main === module) run('Function hardening (5.59.12)');
