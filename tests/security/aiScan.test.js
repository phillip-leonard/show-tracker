/**
 * analyze-tickets / analyze-screenshot (lib/aiScan.js): image checks,
 * the REQUIRE_AUTH_AI flag, per-user and tokenless limits, CORS, and that
 * nothing from Anthropic or the model leaks back to the client. The real
 * handlers run against an in-memory Firestore; the Anthropic call is
 * swapped for a stub, so no network and no key.
 *
 *   node tests/security/aiScan.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const ai = require('../../netlify/functions/lib/aiScan');
const tickets = require('../../netlify/functions/analyze-tickets').handler;
const screenshot = require('../../netlify/functions/analyze-screenshot').handler;

const ADMIN = { uid: 'adminUid', email: 'phillip.leonard@gmail.com', email_verified: true };
const ALICE = { uid: 'aliceUid', email: 'alice@example.com', email_verified: true };

// Smallest real headers for each format, padded so they're valid base64.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]).toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 1)]).toString('base64');
const PDF = Buffer.from('%PDF-1.7 not an image at all, really not').toString('base64');

let claudeCalls = 0;
let claudeReply = { ok: true, text: '[{"artist":"Goose","venue":"Red Rocks","date":"2024-06-15","city":"Morrison"}]' };

function setup({ enforce = false } = {}) {
  const db = createFakeDb();
  const auth = createFakeAuth({ tokens: { admin: ADMIN, alice: ALICE }, users: [ADMIN, ALICE] });
  __setTestFirebase({ db, auth });
  if (enforce) process.env.REQUIRE_AUTH_AI = 'true'; else delete process.env.REQUIRE_AUTH_AI;
  claudeCalls = 0;
  claudeReply = { ok: true, text: '[{"artist":"Goose","venue":"Red Rocks","date":"2024-06-15","city":"Morrison"}]' };
  ai.__setTestClaude(async () => { claudeCalls++; return claudeReply; });
  return { db };
}

const post = (body, { token, origin = 'https://mysetlists.net', ip = '203.0.113.5' } = {}) => ({
  httpMethod: 'POST',
  headers: { origin, 'x-nf-client-connection-ip': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const ticketBody = (n = 1, b64 = JPEG, mediaType = 'image/jpeg') => ({ images: Array.from({ length: n }, () => ({ base64: b64, mediaType })) });
const json = (res) => JSON.parse(res.body);
const quiet = async (fn) => { const l = console.log; const e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };

// ── Image checks (ship immediately, no flag) ─────────────────────────

test('checkImage: real JPEG/PNG pass; wrong declared type, PDF, non-base64 fail', () => {
  assert.ok(ai.checkImage(JPEG, 'image/jpeg').image);
  assert.ok(ai.checkImage(PNG, 'image/png').image);
  assert.strictEqual(ai.checkImage(PNG, 'image/jpeg').error, 'badImage', 'bytes must match the declared type');
  assert.strictEqual(ai.checkImage(PDF, 'application/pdf').error, 'badImage');
  assert.strictEqual(ai.checkImage(PDF, 'image/jpeg').error, 'badImage');
  assert.strictEqual(ai.checkImage('not base64!!', 'image/jpeg').error, 'badImage');
  assert.strictEqual(ai.checkImage(JPEG, 'image/svg+xml').error, 'badImage');
});

test('checkImage: over 4 MB decoded is refused', () => {
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(ai.MAX_IMAGE_BYTES)]).toString('base64');
  assert.strictEqual(ai.checkImage(big, 'image/jpeg').error, 'tooLarge');
});

test('tickets: more than 10 images → 400 before any counter or Anthropic call', async () => {
  const { db } = setup();
  const res = await tickets(post(ticketBody(11)));
  assert.strictEqual(res.statusCode, 400);
  assert.match(json(res).error, /up to 10/);
  assert.strictEqual(claudeCalls, 0);
  assert.strictEqual(db._list('rateLimits').length, 0);
});

test('tickets: a non-image is rejected before Anthropic', async () => {
  setup();
  const res = await tickets(post(ticketBody(1, PDF, 'application/pdf')));
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(claudeCalls, 0);
});

test('screenshot: no body → 400 (also with enforcement on), never 401 first', async () => {
  setup({ enforce: true });
  assert.strictEqual((await screenshot({ httpMethod: 'POST', headers: {} })).statusCode, 400);
  assert.strictEqual((await tickets({ httpMethod: 'GET', headers: {} })).statusCode, 405);
});

// ── REQUIRE_AUTH_AI ──────────────────────────────────────────────────

test('enforcement on: no token → 401 with a human message; nothing spent', async () => {
  setup({ enforce: true });
  const res = await tickets(post(ticketBody(1)));
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(json(res).code, 'auth_required');
  assert.match(json(res).error, /account/i);
  assert.strictEqual(claudeCalls, 0);
});

test('enforcement on: a signed-in scan works', async () => {
  setup({ enforce: true });
  const res = await tickets(post(ticketBody(2), { token: 'alice' }));
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(json(res).shows[0], { artist: 'Goose', venue: 'Red Rocks', date: '2024-06-15', city: 'Morrison' });
  assert.strictEqual(claudeCalls, 1);
});

test('a signed-in counter carries the uid (delete-account purges by it); the tokenless pool doesn\'t', async () => {
  const { db } = setup();
  await tickets(post(ticketBody(1), { token: 'alice' }));
  await quiet(() => tickets(post(ticketBody(1))));
  const docs = db._list('rateLimits');
  assert.strictEqual(docs.find((d) => d.key === 'ai_aliceUid').uid, 'aliceUid');
  assert.ok(docs.filter((d) => d.key.startsWith('ai_anon')).every((d) => d.uid === null));
});

test('enforcement off: a tokenless scan (old iOS build) still works', async () => {
  setup();
  const res = await quiet(() => screenshot(post({ image: JPEG, mediaType: 'image/jpeg' })));
  assert.strictEqual(res.statusCode, 200);
});

// ── Limits ───────────────────────────────────────────────────────────

test('signed-in: 20 scans a day, then 429; screenshot and tickets share it', async () => {
  setup();
  for (let i = 0; i < ai.AI_USER_DAILY_LIMIT; i++) {
    const h = i % 2 ? tickets : screenshot;
    const body = i % 2 ? ticketBody(1) : { image: JPEG, mediaType: 'image/jpeg' };
    assert.strictEqual((await h(post(body, { token: 'alice' }))).statusCode, 200, `scan ${i + 1}`);
  }
  const res = await tickets(post(ticketBody(1), { token: 'alice' }));
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(json(res).code, 'daily_limit');
  assert.strictEqual(claudeCalls, ai.AI_USER_DAILY_LIMIT);
});

test('admin: exempt from the daily limit', async () => {
  setup();
  for (let i = 0; i <= ai.AI_USER_DAILY_LIMIT; i++) {
    assert.strictEqual((await tickets(post(ticketBody(1), { token: 'admin' }))).statusCode, 200);
  }
});

test('tokenless: 10 a day per IP, then 429; another IP is unaffected', async () => {
  setup();
  await quiet(async () => {
    for (let i = 0; i < ai.AI_ANON_IP_DAILY_LIMIT; i++) assert.strictEqual((await tickets(post(ticketBody(1)))).statusCode, 200);
    const res = await tickets(post(ticketBody(1)));
    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(json(res).code, 'anon_limit');
    assert.strictEqual((await tickets(post(ticketBody(1), { ip: '198.51.100.7' }))).statusCode, 200);
  });
});

test('tokenless: 100 a day in total across all IPs', async () => {
  setup();
  await quiet(async () => {
    for (let i = 0; i < ai.AI_ANON_DAILY_LIMIT; i++) {
      assert.strictEqual((await tickets(post(ticketBody(1), { ip: `10.0.${Math.floor(i / 5)}.${i % 5}` }))).statusCode, 200);
    }
    assert.strictEqual((await tickets(post(ticketBody(1), { ip: '10.9.9.9' }))).statusCode, 429);
    // A signed-in user isn't in the tokenless pool.
    assert.strictEqual((await tickets(post(ticketBody(1), { token: 'alice' }))).statusCode, 200);
  });
});

test('the raw client IP is never stored', async () => {
  const { db } = setup();
  await quiet(() => tickets(post(ticketBody(1), { ip: '203.0.113.77' })));
  assert.ok(!JSON.stringify(db._list('rateLimits')).includes('203.0.113.77'));
  assert.ok(!db._list('rateLimits').some((d) => d.id.includes('203.0.113.77')));
});

// ── What goes back ───────────────────────────────────────────────────

test('Anthropic failure → 502, generic message, no upstream details', async () => {
  setup();
  claudeReply = { ok: false };
  const res = await tickets(post(ticketBody(1), { token: 'alice' }));
  assert.strictEqual(res.statusCode, 502);
  assert.deepStrictEqual(Object.keys(json(res)), ['error']);
});

test('model text with no array → 422 without the raw text', async () => {
  setup();
  claudeReply = { ok: true, text: 'SECRET model ramble with no JSON' };
  const res = await screenshot(post({ image: JPEG, mediaType: 'image/jpeg' }, { token: 'alice' }));
  assert.strictEqual(res.statusCode, 422);
  assert.ok(!res.body.includes('SECRET'));
});

test('results are reduced to the four fields, as strings', async () => {
  setup();
  claudeReply = { ok: true, text: '[{"artist":"A","venue":3,"date":"2024-01-01","city":"X","extra":"<script>"}, "junk"]' };
  const res = await tickets(post(ticketBody(1), { token: 'alice' }));
  assert.deepStrictEqual(json(res).shows, [{ artist: 'A', venue: '', date: '2024-01-01', city: 'X' }]);
});

test('CORS: allowlist only, never *', async () => {
  setup();
  const pre = (origin) => tickets({ httpMethod: 'OPTIONS', headers: { origin } });
  assert.strictEqual((await pre('capacitor://localhost')).headers['Access-Control-Allow-Origin'], 'capacitor://localhost');
  assert.strictEqual((await pre('https://mysetlists.net')).headers['Access-Control-Allow-Origin'], 'https://mysetlists.net');
  assert.strictEqual((await pre('https://evil.example')).headers['Access-Control-Allow-Origin'], undefined);
  assert.match((await pre('capacitor://localhost')).headers['Access-Control-Allow-Headers'], /Authorization/);
});

test('rate-limit storage down → 503, nothing spent (fails closed)', async () => {
  const { db } = setup();
  db.runTransaction = async () => { throw new Error('unavailable'); };
  const res = await quiet(() => tickets(post(ticketBody(1), { token: 'alice' })));
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(claudeCalls, 0);
});

run('AI scan endpoints').finally(() => { delete process.env.REQUIRE_AUTH_AI; });
