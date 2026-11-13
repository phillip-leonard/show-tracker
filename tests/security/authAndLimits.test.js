/**
 * The shared auth helper (lib/requestAuth.js), the daily rate limiter
 * (lib/rateLimit.js) and the CORS policy (lib/cors.js), against an
 * in-memory Firestore and a fake Auth. Plus a guard that no function
 * answers `Access-Control-Allow-Origin: *` again.
 *
 *   node tests/security/authAndLimits.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { requireUser, requireAdmin, optionalUser } = require('../../netlify/functions/lib/requestAuth');
const { takeDailyQuota, peekDailyQuota, ipHash, clientIp } = require('../../netlify/functions/lib/rateLimit');
const { corsHeaders, withCors } = require('../../netlify/functions/lib/cors');

const ADMIN = { uid: 'adminUid', email: 'phillip.leonard@gmail.com', email_verified: true };
const FAKE_ADMIN = { uid: 'impostor', email: 'phillip.leonard@gmail.com', email_verified: false };
const ALICE = { uid: 'aliceUid', email: 'alice@example.com', email_verified: true };

function setup() {
  const db = createFakeDb();
  const auth = createFakeAuth({ tokens: { admin: ADMIN, impostor: FAKE_ADMIN, alice: ALICE }, users: [ADMIN, ALICE] });
  __setTestFirebase({ db, auth });
  return { db };
}
const withToken = (t) => ({ headers: t ? { authorization: `Bearer ${t}` } : {} });

// ── requestAuth ──────────────────────────────────────────────────────

test('requireUser: no token → 401 response, generic body', async () => {
  setup();
  const r = await requireUser(withToken(null), { X: '1' });
  assert.strictEqual(r.response.statusCode, 401);
  assert.strictEqual(r.response.headers.X, '1');
  assert.deepStrictEqual(Object.keys(JSON.parse(r.response.body)).sort(), ['code', 'error']);
});

test('requireUser: invalid token → 401', async () => {
  setup();
  assert.strictEqual((await requireUser(withToken('forged'))).response.statusCode, 401);
});

test('requireUser: valid token → { uid, email, isAdmin:false }', async () => {
  setup();
  const u = await requireUser(withToken('alice'));
  assert.strictEqual(u.response, undefined);
  assert.strictEqual(u.uid, ALICE.uid);
  assert.strictEqual(u.email, ALICE.email);
  assert.strictEqual(u.isAdmin, false);
});

test('admin: allowlisted, verified email → isAdmin', async () => {
  setup();
  assert.strictEqual((await optionalUser(withToken('admin'))).isAdmin, true);
  assert.strictEqual((await requireAdmin(withToken('admin'))).uid, ADMIN.uid);
});

test('admin: allowlisted but unverified email → not admin, 403', async () => {
  setup();
  assert.strictEqual((await optionalUser(withToken('impostor'))).isAdmin, false);
  assert.strictEqual((await requireAdmin(withToken('impostor'))).response.statusCode, 403);
  assert.strictEqual((await requireAdmin(withToken('alice'))).response.statusCode, 403);
});

// ── rateLimit ────────────────────────────────────────────────────────

test('takeDailyQuota: allows up to the limit, then refuses without writing', async () => {
  const { db } = setup();
  const now = Date.UTC(2026, 10, 12, 12);
  for (let i = 1; i <= 3; i++) assert.deepStrictEqual(await takeDailyQuota(db, 'ai_alice', 3, { now }), { allowed: true, count: i, limit: 3 });
  const writes = db._writes.length;
  assert.deepStrictEqual(await takeDailyQuota(db, 'ai_alice', 3, { now }), { allowed: false, count: 3, limit: 3 });
  assert.strictEqual(db._writes.length, writes, 'a refused request writes nothing');
  assert.ok(db._get('rateLimits/ai_alice_2026-11-12'));
  assert.ok(db._get('rateLimits/ai_alice_2026-11-12').expiresAt instanceof Date);
});

test('takeDailyQuota: a new UTC day starts again, keys are independent', async () => {
  const { db } = setup();
  const day1 = Date.UTC(2026, 10, 12, 23, 59);
  const day2 = Date.UTC(2026, 10, 13, 0, 1);
  await takeDailyQuota(db, 'k', 1, { now: day1 });
  assert.strictEqual((await takeDailyQuota(db, 'k', 1, { now: day1 })).allowed, false);
  assert.strictEqual((await takeDailyQuota(db, 'k', 1, { now: day2 })).allowed, true);
  assert.strictEqual((await takeDailyQuota(db, 'other', 1, { now: day1 })).allowed, true);
  assert.strictEqual(await peekDailyQuota(db, 'k', { now: day2 }), 1);
});

test('takeDailyQuota: concurrent requests never exceed the limit', async () => {
  const { db } = setup();
  const now = Date.UTC(2026, 10, 12);
  const results = await Promise.all(Array.from({ length: 10 }, () => takeDailyQuota(db, 'race', 4, { now })));
  assert.strictEqual(results.filter((r) => r.allowed).length, 4);
});

test('ipHash: stable, not the raw address; clientIp reads Netlify headers', () => {
  assert.strictEqual(ipHash('203.0.113.9'), ipHash('203.0.113.9'));
  assert.notStrictEqual(ipHash('203.0.113.9'), ipHash('203.0.113.10'));
  assert.ok(!ipHash('203.0.113.9').includes('203'));
  assert.strictEqual(clientIp({ headers: { 'x-nf-client-connection-ip': '198.51.100.1' } }), '198.51.100.1');
  assert.strictEqual(clientIp({ headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' } }), '198.51.100.2');
});

// ── cors ─────────────────────────────────────────────────────────────

test('corsHeaders: echoes the site, www, the iOS app and local dev; nothing else', () => {
  for (const origin of ['https://mysetlists.net', 'https://www.mysetlists.net', 'capacitor://localhost', 'http://localhost:8888']) {
    assert.strictEqual(corsHeaders({ headers: { origin } })['Access-Control-Allow-Origin'], origin);
  }
  for (const origin of ['https://evil.example', 'https://deploy-preview-1--setlisttracker.netlify.app', 'null', '']) {
    assert.strictEqual(corsHeaders({ headers: { origin } })['Access-Control-Allow-Origin'], undefined, origin);
  }
  assert.match(corsHeaders({ headers: {} })['Access-Control-Allow-Headers'], /Authorization/);
});

test('corsHeaders: a deploy preview may echo only its own URL', () => {
  process.env.DEPLOY_PRIME_URL = 'https://deploy-preview-7--setlisttracker.netlify.app';
  try {
    assert.strictEqual(corsHeaders({ headers: { origin: process.env.DEPLOY_PRIME_URL } })['Access-Control-Allow-Origin'], process.env.DEPLOY_PRIME_URL);
    assert.strictEqual(corsHeaders({ headers: { origin: 'https://deploy-preview-8--setlisttracker.netlify.app' } })['Access-Control-Allow-Origin'], undefined);
  } finally {
    delete process.env.DEPLOY_PRIME_URL;
  }
});

test('withCors: replaces a handler\'s own Allow-Origin and keeps its other headers', async () => {
  const h = withCors(async () => ({ statusCode: 200, headers: { 'Access-Control-Allow-Origin': 'https://anything', 'Content-Type': 'application/json', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '{}' }));
  const ok = await h({ headers: { origin: 'capacitor://localhost' } });
  assert.strictEqual(ok.headers['Access-Control-Allow-Origin'], 'capacitor://localhost');
  assert.strictEqual(ok.headers['Content-Type'], 'application/json');
  assert.strictEqual(ok.headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization');
  assert.strictEqual(ok.headers.Vary, 'Origin');
  const bad = await h({ headers: { origin: 'https://evil.example' } });
  assert.strictEqual(bad.headers['Access-Control-Allow-Origin'], undefined);
});

test('withCors: a CDN-cached response is cached per Origin (Netlify-Vary)', async () => {
  const cached = withCors(async () => ({ statusCode: 200, headers: { 'Cache-Control': 'public, s-maxage=3600', 'Netlify-Vary': 'query=mine' }, body: '' }));
  assert.strictEqual((await cached({ headers: {} })).headers['Netlify-Vary'], 'query=mine,header=Origin');
  const fresh = withCors(async () => ({ statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: '' }));
  assert.strictEqual((await fresh({ headers: {} })).headers['Netlify-Vary'], undefined);
});

test('no function or helper answers Access-Control-Allow-Origin: *', () => {
  const dir = path.join(__dirname, '../../netlify/functions');
  const files = [
    ...fs.readdirSync(dir).filter((f) => /\.m?js$/.test(f)).map((f) => path.join(dir, f)),
    ...fs.readdirSync(path.join(dir, 'lib')).filter((f) => /\.m?js$/.test(f)).map((f) => path.join(dir, 'lib', f)),
  ];
  const offenders = files.filter((f) => /Access-Control-Allow-Origin['"]?\s*[:=]\s*['"]\*['"]/.test(fs.readFileSync(f, 'utf8')));
  assert.deepStrictEqual(offenders.map((f) => path.relative(dir, f)), []);
});

run('auth helper, rate limiter, CORS');
