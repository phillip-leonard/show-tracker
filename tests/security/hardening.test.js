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

module.exports = { run };
if (require.main === module) run('Function hardening (5.59.12)');
