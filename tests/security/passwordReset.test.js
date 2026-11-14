/**
 * Password reset (5.60.0): send-password-reset and complete-password-reset,
 * run for real against the in-memory Firestore and a fake Auth and Resend.
 *
 *   node tests/security/passwordReset.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestTransport, FROM_NOREPLY } = require('../../netlify/functions/lib/outgoingEmail');
const sendReset = require('../../netlify/functions/send-password-reset');
const completeReset = require('../../netlify/functions/complete-password-reset');
const {
  generateToken, hashToken, isWellFormedToken, INVALID_LINK, TOKEN_TTL_MS,
} = require('../../netlify/functions/lib/passwordReset');
const { validatePassword } = require('../../netlify/functions/lib/passwordRules');

const ROOT = path.join(__dirname, '../..');
const NEW_PASSWORD = 'NewPassw0rd';

const PASSWORD_USER = { uid: 'pwUid', email: 'pat@example.com', providerData: [{ providerId: 'password' }] };
const GOOGLE_USER = { uid: 'gUid', email: 'gail@example.com', providerData: [{ providerId: 'google.com' }] };
const APPLE_USER = { uid: 'aUid', email: 'ana@example.com', providerData: [{ providerId: 'apple.com' }] };
const BOTH_USER = { uid: 'bUid', email: 'bo@example.com', providerData: [{ providerId: 'google.com' }, { providerId: 'apple.com' }] };
const DISABLED_USER = { uid: 'dUid', email: 'dee@example.com', disabled: true, providerData: [{ providerId: 'password' }] };

sendReset.__setSleep(async () => {});

function setup({ resendStatus = 200 } = {}) {
  const db = createFakeDb();
  const users = [PASSWORD_USER, GOOGLE_USER, APPLE_USER, BOTH_USER, DISABLED_USER].map((u) => ({ ...u }));
  const auth = createFakeAuth({ users });
  const calls = { updateUser: [], revoke: [] };
  auth.updateUser = async (uid, props) => { calls.updateUser.push({ uid, props }); return { uid }; };
  auth.revokeRefreshTokens = async (uid) => { calls.revoke.push(uid); };
  __setTestFirebase({ db, auth });
  const sent = [];
  __setTestTransport((p, payload) => { sent.push(payload); return { status: resendStatus, body: '{"id":"x"}' }; });
  return { db, auth, sent, calls };
}

const quiet = async (fn) => { const l = console.log; const e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };
const post = (fn, body, ip = '203.0.113.7') => quiet(() => fn.handler({
  httpMethod: 'POST',
  headers: { origin: 'https://mysetlists.net', 'x-nf-client-connection-ip': ip },
  body: JSON.stringify(body),
}));
const json = (res) => JSON.parse(res.body);
const tokenFrom = (html) => (html.match(/https:\/\/mysetlists\.net\/reset\/([0-9A-Za-z]+)/) || [])[1];

// ── Token ───────────────────────────────────────────────────────────

test('tokens are 16 base62 characters and differ every time', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const t = generateToken();
    assert.ok(isWellFormedToken(t), t);
    seen.add(t);
  }
  assert.strictEqual(seen.size, 500);
});

test('bytes of 248 and over are discarded, so no character is favoured', () => {
  let calls = 0;
  const fake = () => { calls++; return Buffer.from(calls === 1 ? [255, 248, 250, ...Array(29).fill(61)] : Array(32).fill(0)); };
  assert.strictEqual(generateToken(fake), 'z'.repeat(16));
});

test('password rules match the sign-up form', () => {
  assert.ok(validatePassword('Short1'));
  assert.ok(validatePassword('alllowercase1'));
  assert.ok(validatePassword('ALLUPPERCASE1'));
  assert.ok(validatePassword('NoNumbersHere'));
  assert.strictEqual(validatePassword('GoodPassw0rd'), null);
  const signup = fs.readFileSync(path.join(ROOT, 'components/auth/SignupForm.js'), 'utf8');
  assert.ok(signup.includes("from '@/lib/passwordRules'"), 'SignupForm must use the shared rules');
});

// ── send-password-reset ─────────────────────────────────────────────

test('password account: branded email from noreply with a /reset/<16> link; only the hash is stored', async () => {
  const { db, sent } = setup();
  const res = await post(sendReset, { email: '  Pat@Example.com ' });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(json(res), { ok: true });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].from, FROM_NOREPLY);
  assert.strictEqual(sent[0].from, 'MySetlists <noreply@mysetlists.net>');
  assert.strictEqual(sent[0].to, 'pat@example.com');
  assert.match(sent[0].html, /logo\.svg/);
  assert.match(sent[0].html, /expires in 1 hour/);
  assert.match(sent[0].html, /didn’t request this/);
  assert.ok(!/unsubscribe/i.test(sent[0].html), 'a reset email carries no unsubscribe link');
  assert.ok(!sent[0].headers, 'no List-Unsubscribe header');
  const token = tokenFrom(sent[0].html);
  assert.ok(isWellFormedToken(token), `link token: ${token}`);

  const docs = db._list('passwordResetTokens');
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].id, hashToken(token));
  assert.strictEqual(docs[0].uid, 'pwUid');
  assert.strictEqual(docs[0].email, 'pat@example.com');
  assert.strictEqual(docs[0].used, false);
  assert.strictEqual(new Date(docs[0].expiresAt) - new Date(docs[0].createdAt), TOKEN_TTL_MS);
  assert.ok(!JSON.stringify([...db._store.values()]).includes(token), 'the raw token is stored nowhere');
});

test('Google-only and Apple-only accounts get the "no password" email, naming the provider', async () => {
  const { db, sent } = setup();
  await post(sendReset, { email: 'gail@example.com' });
  await post(sendReset, { email: 'ana@example.com' });
  await post(sendReset, { email: 'bo@example.com' });
  assert.strictEqual(sent.length, 3);
  assert.match(sent[0].subject, /with Google/);
  assert.match(sent[0].html, /Continue with Google/);
  assert.ok(!/\/reset\//.test(sent[0].html));
  assert.match(sent[1].subject, /with Apple/);
  assert.match(sent[1].html, /Sign in with Apple/);
  assert.match(sent[2].html, /with Google or Apple/);
  for (const m of sent) assert.strictEqual(m.from, FROM_NOREPLY);
  assert.strictEqual(db._list('passwordResetTokens').length, 0);
});

test('unknown and disabled addresses: same 200, nothing sent, nothing stored', async () => {
  const { db, sent } = setup();
  const known = await post(sendReset, { email: 'pat@example.com' });
  const unknown = await post(sendReset, { email: 'nobody@example.com' });
  const disabled = await post(sendReset, { email: 'dee@example.com' });
  assert.strictEqual(unknown.statusCode, known.statusCode);
  assert.strictEqual(unknown.body, known.body);
  assert.strictEqual(disabled.body, known.body);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(db._list('passwordResetTokens').length, 1);
});

test('a failed send still answers 200 { ok: true }', async () => {
  setup({ resendStatus: 500 });
  const res = await post(sendReset, { email: 'pat@example.com' });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(json(res), { ok: true });
});

test('an invalid email is a 400 and sends nothing', async () => {
  const { sent } = setup();
  for (const email of ['', 'not-an-email', 42, null, 'a@b']) {
    const res = await post(sendReset, { email });
    assert.strictEqual(res.statusCode, 400, String(email));
  }
  assert.strictEqual(sent.length, 0);
});

test('rate limit: the 4th request for one address in an hour is refused, before any lookup', async () => {
  const { sent } = setup();
  for (let i = 0; i < 3; i++) assert.strictEqual((await post(sendReset, { email: 'pat@example.com' }, `198.51.100.${i}`)).statusCode, 200);
  const fourth = await post(sendReset, { email: 'pat@example.com' }, '198.51.100.99');
  assert.strictEqual(fourth.statusCode, 429);
  assert.strictEqual(sent.length, 3);
  // An unknown address is limited exactly the same way.
  for (let i = 0; i < 3; i++) await post(sendReset, { email: 'ghost@example.com' }, `192.0.2.${i}`);
  assert.strictEqual((await post(sendReset, { email: 'ghost@example.com' }, '192.0.2.99')).statusCode, 429);
});

test('rate limit: one network is refused after its hourly allowance', async () => {
  setup();
  for (let i = 0; i < sendReset.PER_IP_PER_HOUR; i++) {
    assert.strictEqual((await post(sendReset, { email: `u${i}@example.com` })).statusCode, 200);
  }
  assert.strictEqual((await post(sendReset, { email: 'another@example.com' })).statusCode, 429);
});

test('every answer past the limits is held to the same time floor, sent or not', async () => {
  setup();
  const waits = [];
  sendReset.__setSleep(async (ms) => { waits.push(ms); });
  try {
    await post(sendReset, { email: 'pat@example.com' });
    await post(sendReset, { email: 'nobody@example.com' });
    await post(sendReset, { email: 'gail@example.com' });
  } finally {
    sendReset.__setSleep(async () => {});
  }
  assert.strictEqual(waits.length, 3, 'all three paths wait');
  assert.strictEqual(sendReset.MIN_RESPONSE_MS, 3000);
  for (const w of waits) assert.ok(w > 0 && w <= sendReset.MIN_RESPONSE_MS, `wait ${w}`);
});

test('the per-address counter stores no address', async () => {
  const { db } = setup();
  await post(sendReset, { email: 'pat@example.com' });
  const dump = JSON.stringify([...db._store.entries()].filter(([p]) => p.startsWith('rateLimits/')));
  assert.ok(!dump.includes('pat@example.com'));
});

// ── complete-password-reset ─────────────────────────────────────────

async function issue(email = 'pat@example.com') {
  const ctx = setup();
  await post(sendReset, { email });
  return { ...ctx, token: tokenFrom(ctx.sent[ctx.sent.length - 1].html) };
}

test('a valid link sets the password, revokes sessions and marks the token used', async () => {
  const { db, calls, token } = await issue();
  const res = await post(completeReset, { token, newPassword: NEW_PASSWORD });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(json(res), { ok: true });
  assert.deepStrictEqual(calls.updateUser, [{ uid: 'pwUid', props: { password: NEW_PASSWORD } }]);
  assert.deepStrictEqual(calls.revoke, ['pwUid']);
  assert.strictEqual(db._get(`passwordResetTokens/${hashToken(token)}`).used, true);
});

test('reusing a link fails with the generic message', async () => {
  const { calls, token } = await issue();
  await post(completeReset, { token, newPassword: NEW_PASSWORD });
  const again = await post(completeReset, { token, newPassword: 'Another1Pass' });
  assert.strictEqual(again.statusCode, 400);
  assert.strictEqual(json(again).error, INVALID_LINK);
  assert.strictEqual(calls.updateUser.length, 1);
});

test('a link older than 60 minutes fails', async () => {
  const { db, calls, token } = await issue();
  const ref = `passwordResetTokens/${hashToken(token)}`;
  db._put(ref, { ...db._get(ref), expiresAt: new Date(Date.now() - 1000) });
  const res = await post(completeReset, { token, newPassword: NEW_PASSWORD });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(json(res).error, INVALID_LINK);
  assert.strictEqual(calls.updateUser.length, 0);
});

test('unknown and malformed tokens get the same generic answer', async () => {
  setup();
  for (const token of [generateToken(), 'short', '', null, 'x'.repeat(16) + '!', { $gt: '' }]) {
    const res = await post(completeReset, { token, newPassword: NEW_PASSWORD });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(json(res).error, INVALID_LINK);
  }
});

test('a weak password is refused without using up the link', async () => {
  const { db, calls, token } = await issue();
  const res = await post(completeReset, { token, newPassword: 'weak' });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(json(res).code, 'weak_password');
  assert.strictEqual(calls.updateUser.length, 0);
  assert.strictEqual(db._get(`passwordResetTokens/${hashToken(token)}`).used, false);
  assert.strictEqual((await post(completeReset, { token, newPassword: NEW_PASSWORD })).statusCode, 200);
});

test('other unused tokens for the account are deleted after a reset', async () => {
  const { db, sent, token: first } = await issue();
  await post(sendReset, { email: 'pat@example.com' }, '198.51.100.50');
  const second = tokenFrom(sent[sent.length - 1].html);
  db._put('passwordResetTokens/someoneElse', { uid: 'otherUid', used: false, expiresAt: new Date(Date.now() + 1e6) });
  assert.strictEqual(db._list('passwordResetTokens').length, 3);
  await post(completeReset, { token: second, newPassword: NEW_PASSWORD });
  const left = db._list('passwordResetTokens').map((d) => d.id).sort();
  assert.deepStrictEqual(left, [hashToken(second), 'someoneElse'].sort());
  assert.strictEqual((await post(completeReset, { token: first, newPassword: NEW_PASSWORD })).statusCode, 400);
});

test('a link no longer works once the account has a different address', async () => {
  const { auth, calls, token } = await issue();
  const u = await auth.getUser('pwUid');
  u.email = 'pat.new@example.com';
  const res = await post(completeReset, { token, newPassword: NEW_PASSWORD });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(calls.updateUser.length, 0);
});

test('if updateUser fails the link still works afterwards', async () => {
  const { db, auth, token } = await issue();
  const real = auth.updateUser;
  auth.updateUser = async () => { throw Object.assign(new Error('boom'), { code: 'auth/internal-error' }); };
  assert.strictEqual((await post(completeReset, { token, newPassword: NEW_PASSWORD })).statusCode, 500);
  assert.strictEqual(db._get(`passwordResetTokens/${hashToken(token)}`).used, false);
  auth.updateUser = real;
  assert.strictEqual((await post(completeReset, { token, newPassword: NEW_PASSWORD })).statusCode, 200);
});

test('complete-password-reset is rate limited per network', async () => {
  setup();
  for (let i = 0; i < completeReset.PER_IP_PER_HOUR; i++) {
    await post(completeReset, { token: generateToken(), newPassword: NEW_PASSWORD });
  }
  assert.strictEqual((await post(completeReset, { token: generateToken(), newPassword: NEW_PASSWORD })).statusCode, 429);
});

test('both functions answer CORS for the iOS app and refuse other methods', async () => {
  setup();
  for (const fn of [sendReset, completeReset]) {
    const pre = await fn.handler({ httpMethod: 'OPTIONS', headers: { origin: 'capacitor://localhost' } });
    assert.strictEqual(pre.statusCode, 204);
    assert.strictEqual(pre.headers['Access-Control-Allow-Origin'], 'capacitor://localhost');
    const evil = await fn.handler({ httpMethod: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    assert.strictEqual(evil.headers['Access-Control-Allow-Origin'], undefined);
    assert.strictEqual((await fn.handler({ httpMethod: 'GET', headers: {} })).statusCode, 405);
  }
});

// ── Client wiring ───────────────────────────────────────────────────

test('no web code calls Firebase sendPasswordResetEmail any more', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '__tests__') continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(js|jsx|ts|tsx)$/.test(ent.name) && fs.readFileSync(p, 'utf8').includes('sendPasswordResetEmail')) offenders.push(path.relative(ROOT, p));
    }
  };
  for (const d of ['app', 'components', 'context', 'hooks', 'lib', 'src']) walk(path.join(ROOT, d));
  assert.deepStrictEqual(offenders, []);
});

test('/reset/<token> redirects to the real /reset/ route (static export)', () => {
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  assert.ok(/from = "\/reset\/:token"\s+to = "\/reset\/\?token=:token"\s+status = 301/.test(toml));
  assert.ok(/from = "\/reset\/:token\/"\s+to = "\/reset\/\?token=:token"\s+status = 301/.test(toml));
  assert.ok(fs.existsSync(path.join(ROOT, 'app/reset/page.jsx')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'app/reset/[token]')), 'no dynamic route under app/');
});

test('Universal Links never claim /reset, so the link opens in the browser, not the app', () => {
  const aasa = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/.well-known/apple-app-site-association'), 'utf8'));
  const paths = aasa.applinks.details.flatMap((d) => (d.components || []).map((c) => c['/'])).concat(
    aasa.applinks.details.flatMap((d) => d.paths || []),
  );
  // /reset itself, or any wildcard whose prefix it starts with (*, /*, /r*, …).
  const claims = (p) => /^\/reset(\/|$)/.test(p) || (p.endsWith('*') && '/reset/'.startsWith(p.slice(0, -1)));
  assert.deepStrictEqual(paths.filter(claims), [], 'the reset page must stay a web page: the app has no reset screen');
});

run('Password reset (5.60.0)');
