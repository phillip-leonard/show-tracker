/**
 * iOS logout (5.59.14).
 *
 *   1. lib/signOutFlow.js: the order, and that no cleanup step (throwing,
 *      hanging, or the push plugin never settling) can block sign-out.
 *   2. The root cause, on the real @capacitor/core with a simulated iOS
 *      bridge: an async function that returns a Capacitor plugin never
 *      settles; returning it wrapped does.
 *   3. Guards: no code returns a Capacitor plugin from an async function,
 *      and logout / account deletion go through performSignOut.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/signOut.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { performSignOut, bounded } from '@/lib/signOutFlow';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const never = () => new Promise(() => {});

// A recording mock of the native plugins and the web SDK.
function harness(overrides = {}) {
  const calls = [];
  const step = (name, impl) => () => { calls.push(name); return impl ? impl() : Promise.resolve(); };
  return {
    calls,
    steps: {
      beforeSignOut: step('pushCleanup', overrides.pushCleanup),
      webSignOut: step('webSignOut', overrides.webSignOut),
      nativeSignOut: step('nativeSignOut', overrides.nativeSignOut),
      clearLocal: step('clearLocal', overrides.clearLocal),
      navigate: step('navigate', overrides.navigate),
      log: () => {},
      timeoutMs: 50,
    },
  };
}

// ── 1. The sequence ───────────────────────────────────────────────────

test('runs push cleanup, web, native, local, navigate, in that order', async () => {
  const h = harness();
  const r = await performSignOut(h.steps);
  assert.deepStrictEqual(h.calls, ['pushCleanup', 'webSignOut', 'nativeSignOut', 'clearLocal', 'navigate']);
  assert.strictEqual(r.signedOut, true);
});

test('a push cleanup that never settles (the 3.11–3.13.13 bug) is cut off; sign-out happens', async () => {
  const h = harness({ pushCleanup: never });
  const r = await performSignOut(h.steps);
  assert.deepStrictEqual(h.calls, ['pushCleanup', 'webSignOut', 'nativeSignOut', 'clearLocal', 'navigate']);
  assert.strictEqual(r.steps.beforeSignOut, 'timed out');
  assert.strictEqual(r.signedOut, true);
});

test('a cleanup step that throws, synchronously or not, never blocks sign-out', async () => {
  for (const pushCleanup of [() => { throw new Error('sync boom'); }, () => Promise.reject(new Error('async boom'))]) {
    const h = harness({ pushCleanup, nativeSignOut: () => Promise.reject(new Error('plugin missing')) });
    const r = await performSignOut(h.steps);
    assert.deepStrictEqual(h.calls, ['pushCleanup', 'webSignOut', 'nativeSignOut', 'clearLocal', 'navigate']);
    assert.strictEqual(r.steps.beforeSignOut, 'failed');
    assert.strictEqual(r.steps.nativeSignOut, 'failed');
    assert.strictEqual(r.signedOut, true);
  }
});

test('a native sign-out that hangs is cut off; local state still clears and the app navigates', async () => {
  const h = harness({ nativeSignOut: never });
  const r = await performSignOut(h.steps);
  assert.strictEqual(r.steps.nativeSignOut, 'timed out');
  assert.ok(h.calls.includes('clearLocal') && h.calls.includes('navigate'));
});

test('if the web sign-out itself fails, it is reported, and the rest still runs', async () => {
  const h = harness({ webSignOut: () => Promise.reject(new Error('network')) });
  const r = await performSignOut(h.steps);
  assert.strictEqual(r.signedOut, false);
  assert.deepStrictEqual(h.calls, ['pushCleanup', 'webSignOut', 'nativeSignOut', 'clearLocal', 'navigate']);
});

test('failures are logged, not swallowed silently', async () => {
  const logged = [];
  await performSignOut({ ...harness({ pushCleanup: () => Promise.reject(new Error('x')) }).steps, log: (m) => logged.push(m) });
  assert.ok(logged.some((m) => /beforeSignOut failed/.test(m)));
});

test('bounded(): value, error, timeout', async () => {
  assert.deepStrictEqual(await bounded(() => 5, 50), { value: 5 });
  assert.ok((await bounded(() => Promise.reject(new Error('e')), 50)).error);
  assert.deepStrictEqual(await bounded(never, 20), { timedOut: true });
});

// ── 2. The root cause, on the real Capacitor core ────────────────────

test('Capacitor: an async function returning a plugin never settles on iOS; a wrapped plugin does', async () => {
  const saved = { webkit: globalThis.webkit, Capacitor: globalThis.Capacitor };
  const rejections = [];
  const onRejection = (e) => rejections.push(e && e.message);
  process.on('unhandledRejection', onRejection);
  try {
    // What a WKWebView has: webkit.messageHandlers.bridge and the bridge's plugin headers.
    globalThis.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
    globalThis.Capacitor = {
      PluginHeaders: [{ name: 'FirebaseMessaging', methods: [{ name: 'deleteToken', rtype: 'promise' }] }],
      nativePromise: (plugin, method) => Promise.resolve({ called: `${plugin}.${method}` }),
      nativeCallback: () => 'cb',
    };
    const modPath = require.resolve('@capacitor/core');
    delete require.cache[modPath];
    const { registerPlugin, Capacitor } = require(modPath);
    assert.strictEqual(Capacitor.getPlatform(), 'ios');
    const FirebaseMessaging = registerPlugin('FirebaseMessaging');
    const within = (p, ms) => Promise.race([p.then(() => 'settled'), new Promise((r) => setTimeout(() => r('never settled'), ms))]);

    const returnsPlugin = async () => FirebaseMessaging;           // what 3.11–3.13.13 did
    const returnsWrapped = async () => ({ fm: FirebaseMessaging }); // what 5.59.14 does
    assert.strictEqual(await within(returnsPlugin(), 200), 'never settled');
    assert.strictEqual(await within(returnsWrapped(), 200), 'settled');
    assert.deepStrictEqual(await (await returnsWrapped()).fm.deleteToken(), { called: 'FirebaseMessaging.deleteToken' });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(rejections.some((m) => /FirebaseMessaging\.then\(\)" is not implemented on ios/.test(m)), 'the console line the device shows');
  } finally {
    process.off('unhandledRejection', onRejection);
    globalThis.webkit = saved.webkit;
    globalThis.Capacitor = saved.Capacitor;
  }
});

// ── 3. Guards ─────────────────────────────────────────────────────────

const PLUGINS = 'FirebaseMessaging|FirebaseAuthentication|App|Haptics|Browser|Share|Preferences|Keyboard|StatusBar|SplashScreen|Filesystem|LocalNotifications|PushNotifications';

test('no code returns a Capacitor plugin (it would never settle when awaited)', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '__tests__') continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(js|jsx)$/.test(ent.name)) {
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (new RegExp(`^\\s*return\\s+(${PLUGINS})\\s*;`).test(line) || new RegExp(`resolve\\((${PLUGINS})\\)`).test(line)) {
            offenders.push(`${path.relative(ROOT, p)}:${i + 1}`);
          }
        });
      }
    }
  };
  for (const d of ['lib', 'components', 'context', 'app', 'hooks']) walk(path.join(ROOT, d));
  assert.deepStrictEqual(offenders, []);
  const push = fs.readFileSync(path.join(ROOT, 'lib/pushAlerts.js'), 'utf8');
  assert.ok(push.includes('return { fm: FirebaseMessaging };'));
  assert.ok(!/const fm = await messaging\(\);/.test(push), 'every caller unwraps .fm');
});

test('logout and account deletion go through performSignOut; nothing is awaited before it', () => {
  const ctx = fs.readFileSync(path.join(ROOT, 'context/AppContext.jsx'), 'utf8');
  const start = ctx.indexOf('const handleLogout = async () => {');
  const body = ctx.slice(start, ctx.indexOf('\n  };', start));
  assert.ok(/^\s*const handleLogout = async \(\) => \{\s*await performSignOut\(\{/.test(body), 'performSignOut is the first thing');
  for (const step of ['beforeSignOut: () => forgetPushToken()', 'webSignOut: () => signOut(auth)', 'nativeSignOut: () => nativeSignOut()', 'resetUserState();', "navigate: () => router.push('/')"]) {
    assert.ok(body.includes(step), step);
  }
  const profile = fs.readFileSync(path.join(ROOT, 'components/profile/ProfileView.js'), 'utf8');
  assert.ok(profile.includes('await performSignOut({'));
  assert.ok(!/await forgetPushToken\(\);\s*\n\s*await signOut\(auth\);/.test(profile), 'the old blocking sequence is gone');
  const nativeAuth = fs.readFileSync(path.join(ROOT, 'lib/native-auth.js'), 'utf8');
  assert.ok(nativeAuth.includes('await FirebaseAuthentication.signOut();'));
});

test('the signed-out branch of the auth listener clears every account\'s state', () => {
  const ctx = fs.readFileSync(path.join(ROOT, 'context/AppContext.jsx'), 'utf8');
  const reset = ctx.slice(ctx.indexOf('const resetUserState = () => {'), ctx.indexOf('// Logout (5.59.14)'));
  for (const setter of ['setShows([])', 'setFriends([])', 'setPendingShowTags([])', 'setUnreadNotifications([])', 'setFavoriteArtists([])', 'setUpcomingShows([])', 'setBlockedUserIds([])', 'setInviteStats(null)', 'setUserRank(null)']) {
    assert.ok(reset.includes(setter), setter);
  }
  assert.ok(/resetUserState\(\);\s*\n\s*setIsLoading\(false\);/.test(ctx), 'called when the session ends');
});

for (const t of tests) {
  try { await t.fn(); passed++; } catch (err) { failed++; console.error(`✗ ${t.name}\n  ${err.message}`); }
}
console.log(`\nsignOut: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
