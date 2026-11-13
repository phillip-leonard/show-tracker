/**
 * 5.59.8 audit follow-ups:
 *   - proxyLimit: the per-IP daily limit on the setlist.fm, Ticketmaster
 *     and SeatGeek proxies (#398 follow-up 2)
 *   - appleRevoke + delete-account: Sign in with Apple token revocation (B-11)
 *   - B-01: no client code fetches a function by a relative URL
 *
 *   node tests/security/auditFollowups.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createFakeDb } = require('../email/fakeFirestore');
const {
  withProxyLimit, checkProxyLimit, internalProxyHeader, isInternalCall, limitFor,
} = require('../../netlify/functions/lib/proxyLimit');
const { withCors } = require('../../netlify/functions/lib/cors');
const { revokeAppleToken, readAppleToken } = require('../../netlify/functions/lib/appleRevoke');

const ROOT = path.join(__dirname, '../..');
const FN = path.join(ROOT, 'netlify/functions');
const ok = async () => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' });
const req = (ip, extra = {}) => ({ httpMethod: 'GET', headers: { 'x-nf-client-connection-ip': ip, ...extra } });

// ── proxyLimit ───────────────────────────────────────────────────────

test('proxyLimit: allows up to the limit, then 429 with Retry-After', async () => {
  process.env.PROXY_LIMIT_SEATGEEK = '3';
  const db = createFakeDb();
  const h = withProxyLimit('seatgeek', ok, { db });
  for (let i = 0; i < 3; i++) assert.strictEqual((await h(req('1.2.3.4'))).statusCode, 200);
  const refused = await h(req('1.2.3.4'));
  assert.strictEqual(refused.statusCode, 429);
  assert.strictEqual(refused.headers['Retry-After'], '3600');
  assert.match(JSON.parse(refused.body).error, /limit 3/);
  delete process.env.PROXY_LIMIT_SEATGEEK;
});

test('proxyLimit: counted per IP; a second network is unaffected', async () => {
  process.env.PROXY_LIMIT_SEATGEEK = '1';
  const db = createFakeDb();
  const h = withProxyLimit('seatgeek', ok, { db });
  assert.strictEqual((await h(req('1.1.1.1'))).statusCode, 200);
  assert.strictEqual((await h(req('1.1.1.1'))).statusCode, 429);
  assert.strictEqual((await h(req('2.2.2.2'))).statusCode, 200);
  delete process.env.PROXY_LIMIT_SEATGEEK;
});

test('proxyLimit: services count separately', async () => {
  process.env.PROXY_LIMIT_SEATGEEK = '1';
  process.env.PROXY_LIMIT_TICKETMASTER = '1';
  const db = createFakeDb();
  assert.strictEqual((await withProxyLimit('seatgeek', ok, { db })(req('9.9.9.9'))).statusCode, 200);
  assert.strictEqual((await withProxyLimit('ticketmaster', ok, { db })(req('9.9.9.9'))).statusCode, 200);
  delete process.env.PROXY_LIMIT_SEATGEEK;
  delete process.env.PROXY_LIMIT_TICKETMASTER;
});

test('proxyLimit: the raw IP is never stored', async () => {
  const db = createFakeDb();
  await withProxyLimit('setlists', ok, { db })(req('203.0.113.77'));
  const docs = [...db._store.entries()].filter(([p]) => p.startsWith('rateLimits/'));
  assert.strictEqual(docs.length, 1);
  assert.ok(!JSON.stringify(docs).includes('203.0.113.77'));
  assert.match(docs[0][0], /^rateLimits\/proxy_setlists_ip_[0-9a-f]{32}_\d{4}-\d{2}-\d{2}$/);
});

test('proxyLimit: OPTIONS is never counted', async () => {
  const db = createFakeDb();
  await withProxyLimit('setlists', ok, { db })({ httpMethod: 'OPTIONS', headers: {} });
  assert.strictEqual([...db._store.keys()].filter((p) => p.startsWith('rateLimits/')).length, 0);
});

test('proxyLimit: our own server calls are exempt; a wrong header is not', async () => {
  process.env.PROXY_LIMIT_SETLISTS = '1';
  const db = createFakeDb();
  const h = withProxyLimit('setlists', ok, { db });
  const internal = internalProxyHeader();
  assert.ok(internal['X-MySetlists-Internal']);
  assert.strictEqual(isInternalCall({ headers: internal }), true);
  assert.strictEqual(isInternalCall({ headers: { 'x-mysetlists-internal': 'nope' } }), false);
  for (let i = 0; i < 5; i++) assert.strictEqual((await h(req('5.5.5.5', internal))).statusCode, 200);
  assert.strictEqual((await h(req('5.5.5.5', { 'X-MySetlists-Internal': 'a'.repeat(64) }))).statusCode, 200);
  assert.strictEqual((await h(req('5.5.5.5', { 'X-MySetlists-Internal': 'a'.repeat(64) }))).statusCode, 429);
  delete process.env.PROXY_LIMIT_SETLISTS;
});

test('proxyLimit: no secret configured → nobody is exempt', async () => {
  const saved = process.env.UNSUBSCRIBE_SECRET;
  delete process.env.UNSUBSCRIBE_SECRET;
  try {
    assert.deepStrictEqual(internalProxyHeader(), {});
    assert.strictEqual(isInternalCall({ headers: { 'x-mysetlists-internal': '' } }), false);
  } finally {
    process.env.UNSUBSCRIBE_SECRET = saved;
  }
});

test('proxyLimit: fails open when Firestore throws', async () => {
  const broken = { doc: () => ({}), runTransaction: async () => { throw new Error('unavailable'); } };
  assert.strictEqual(await checkProxyLimit(req('7.7.7.7'), 'setlists', { db: broken }), null);
});

test('proxyLimit: defaults, env override, unknown service', async () => {
  assert.strictEqual(limitFor('setlists'), 2000);
  assert.strictEqual(limitFor('ticketmaster'), 500);
  assert.strictEqual(limitFor('seatgeek'), 500);
  process.env.PROXY_LIMIT_TICKETMASTER = 'abc';
  assert.strictEqual(limitFor('ticketmaster'), 500);
  delete process.env.PROXY_LIMIT_TICKETMASTER;
  assert.throws(() => withProxyLimit('spotify', ok), /unknown service/);
});

test('proxyLimit: a 429 still carries CORS for the iOS app', async () => {
  process.env.PROXY_LIMIT_SEATGEEK = '1';
  const db = createFakeDb();
  const h = withCors(withProxyLimit('seatgeek', ok, { db }));
  const ios = (ip) => req(ip, { origin: 'capacitor://localhost' });
  await h(ios('8.8.4.4'));
  const r = await h(ios('8.8.4.4'));
  assert.strictEqual(r.statusCode, 429);
  assert.strictEqual(r.headers['Access-Control-Allow-Origin'], 'capacitor://localhost');
  delete process.env.PROXY_LIMIT_SEATGEEK;
});

test('every proxy that spends a shared key is wrapped', () => {
  const expected = {
    setlists: ['search-setlists', 'search-artists', 'search-artist-shows', 'get-artist-tours', 'get-tour-shows',
      'get-artist-info', 'get-artist-song-stats', 'band-setlist', 'setlistfm-links', 'search-festival-lineup'],
    ticketmaster: ['ticketmaster-events'],
    seatgeek: ['seatgeek-events'],
  };
  for (const [service, files] of Object.entries(expected)) {
    for (const f of files) {
      const src = fs.readFileSync(path.join(FN, `${f}.js`), 'utf8');
      assert.ok(src.includes(`withCors(withProxyLimit('${service}', module.exports.handler))`), `${f} is not limited`);
    }
  }
  // Any public function that reads the setlist.fm key must be on the list,
  // or be admin-only / the test runner.
  const exempt = new Set(['admin-find-missing-setlists', 'admin-populate-setlist', 'run-tests', 'heard-import']);
  const listed = new Set(expected.setlists);
  for (const file of fs.readdirSync(FN).filter((n) => n.endsWith('.js'))) {
    const name = file.replace(/\.js$/, '');
    const src = fs.readFileSync(path.join(FN, file), 'utf8');
    if (/setlistfmKey|SETLISTFM_API_KEY/.test(src) && !exempt.has(name)) {
      assert.ok(listed.has(name), `${name} uses the setlist.fm key but has no proxy limit`);
    }
  }
});

test('admin resync sends the internal header to band-setlist', () => {
  const src = fs.readFileSync(path.join(FN, 'admin-resync-setlists.js'), 'utf8');
  assert.ok(src.includes('...internalProxyHeader()'));
});

// ── appleRevoke (B-11) ───────────────────────────────────────────────

test('readAppleToken: validates token and type', () => {
  assert.deepStrictEqual(readAppleToken({ appleToken: 'c1', appleTokenType: 'code' }), { token: 'c1', tokenType: 'CODE' });
  assert.deepStrictEqual(readAppleToken({ appleToken: 'a1', appleTokenType: 'ACCESS_TOKEN' }), { token: 'a1', tokenType: 'ACCESS_TOKEN' });
  assert.deepStrictEqual(readAppleToken({ appleToken: 'c2' }), { token: 'c2', tokenType: 'CODE' });
  assert.strictEqual(readAppleToken({}), null);
  assert.strictEqual(readAppleToken({ appleToken: 42 }), null);
  assert.strictEqual(readAppleToken({ appleToken: 'x', appleTokenType: 'ID_TOKEN' }), null);
  assert.strictEqual(readAppleToken({ appleToken: 'x'.repeat(5000) }), null);
});

test('revokeAppleToken: posts the Identity Toolkit request', async () => {
  let call;
  const fetchImpl = async (url, init) => { call = { url, init }; return { ok: true, status: 200 }; };
  const r = await revokeAppleToken({ idToken: 'fbid', token: 'authcode', tokenType: 'CODE' }, { fetchImpl, apiKey: 'k 1' });
  assert.deepStrictEqual(r, { revoked: true });
  assert.strictEqual(call.url, 'https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=k%201');
  assert.strictEqual(call.init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(call.init.body), { providerId: 'apple.com', tokenType: 'CODE', token: 'authcode', idToken: 'fbid' });
});

test('revokeAppleToken: reports Firebase errors, network failures and timeouts without throwing', async () => {
  const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'INVALID_IDP_RESPONSE' } }) });
  assert.deepStrictEqual(await revokeAppleToken({ idToken: 'a', token: 'b' }, { fetchImpl: bad, apiKey: 'k' }),
    { revoked: false, reason: 'INVALID_IDP_RESPONSE' });
  const html = async () => ({ ok: false, status: 503, json: async () => { throw new Error('not json'); } });
  assert.deepStrictEqual(await revokeAppleToken({ idToken: 'a', token: 'b' }, { fetchImpl: html, apiKey: 'k' }),
    { revoked: false, reason: 'http_503' });
  const down = async () => { throw new Error('ECONNRESET'); };
  assert.deepStrictEqual(await revokeAppleToken({ idToken: 'a', token: 'b' }, { fetchImpl: down, apiKey: 'k' }),
    { revoked: false, reason: 'network' });
  const hang = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  assert.deepStrictEqual(await revokeAppleToken({ idToken: 'a', token: 'b' }, { fetchImpl: hang, apiKey: 'k', timeoutMs: 20 }),
    { revoked: false, reason: 'timeout' });
  assert.deepStrictEqual(await revokeAppleToken({ idToken: '', token: 'b' }, { fetchImpl: bad, apiKey: 'k' }),
    { revoked: false, reason: 'missing_token' });
});

test('delete-account revokes Apple tokens before disabling the account', () => {
  const src = fs.readFileSync(path.join(FN, 'delete-account.js'), 'utf8');
  const revoke = src.indexOf('await revokeAppleToken(');
  const disable = src.indexOf('auth.updateUser(uid, { disabled: true })');
  const refresh = src.indexOf('auth.revokeRefreshTokens(uid)');
  assert.ok(revoke > 0 && disable > 0 && refresh > 0);
  assert.ok(revoke < disable && revoke < refresh, 'Firebase needs a valid ID token to revoke the Apple token');
});

test('the profile delete flow sends the Apple token', () => {
  const src = fs.readFileSync(path.join(ROOT, 'components/profile/ProfileView.js'), 'utf8');
  assert.ok(src.includes('appleTokenForDeletion(auth.currentUser)'));
  assert.ok(src.includes('appleToken: apple.token, appleTokenType: apple.tokenType'));
});

// ── B-01 ─────────────────────────────────────────────────────────────

test('B-01: no client code fetches a function by a relative URL', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '__tests__') continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(js|jsx|ts|tsx)$/.test(ent.name)) {
        const src = fs.readFileSync(p, 'utf8');
        // A fetch whose first argument is a string literal starting with
        // /.netlify/ or /api/ never reaches Netlify from capacitor://localhost.
        if (/fetch\(\s*[`'"]\/(\.netlify|api)\//.test(src)) offenders.push(path.relative(ROOT, p));
        if (/^\s*[`'"]\/\.netlify\/functions\/[^`'"]*[`'"],?\s*$/m.test(src) && !/apiUrl\(|authedFetch\(/.test(src)) {
          offenders.push(path.relative(ROOT, p));
        }
      }
    }
  };
  for (const d of ['lib', 'components', 'context', 'hooks', 'app']) walk(path.join(ROOT, d));
  assert.deepStrictEqual(offenders, []);
  assert.ok(fs.readFileSync(path.join(ROOT, 'lib/artistImage.js'), 'utf8').includes('apiUrl(`/.netlify/functions/artist-image'));
});

run('Audit follow-ups (5.59.8)');
