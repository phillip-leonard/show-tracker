/**
 * The app's half of the welcome email (5.55.0): lib/welcomeEmailTrigger.js,
 * and a smoke check that every function in context/AppContext.jsx that
 * writes shows asks for it, after the write, through the one helper.
 *
 * Every add path in the app reaches one of those four functions (see the
 * table in lib/welcomeEmailTrigger.js), so these four calls are the whole
 * coverage.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/welcomeEmailTrigger.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { isFirstShowTransition, requestWelcomeEmail } from '@/lib/welcomeEmailTrigger';

let passed = 0;
let failed = 0;
const pending = [];

function test(name, fn) {
  pending.push((async () => {
    try {
      await fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`✗ ${name}\n  ${err.message}`);
    }
  })());
}

// ── isFirstShowTransition ─────────────────────────────────────────────

test('0 → 1 and 0 → 200 are first-show transitions', () => {
  assert.strictEqual(isFirstShowTransition(0, 1), true);
  assert.strictEqual(isFirstShowTransition(0, 200), true);
});

test('an account that already had shows is not', () => {
  assert.strictEqual(isFirstShowTransition(1, 1), false);
  assert.strictEqual(isFirstShowTransition(57, 12), false);
});

test('a save that added nothing is not', () => {
  assert.strictEqual(isFirstShowTransition(0, 0), false);
});

// ── requestWelcomeEmail ───────────────────────────────────────────────

const fakeUser = (token = 'tok') => ({ getIdToken: async () => token });

test('posts with the ID token and the show id', async () => {
  const calls = [];
  await requestWelcomeEmail(fakeUser('abc'), 'show_1', { url: '/x', fetch: async (u, o) => { calls.push([u, o]); return { ok: true }; } });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], '/x');
  assert.strictEqual(calls[0][1].method, 'POST');
  assert.strictEqual(calls[0][1].headers.Authorization, 'Bearer abc');
  assert.deepStrictEqual(JSON.parse(calls[0][1].body), { showId: 'show_1' });
});

test('no user, no request', async () => {
  let called = false;
  await requestWelcomeEmail(null, 's', { fetch: async () => { called = true; } });
  assert.strictEqual(called, false);
});

test('a failed request is swallowed, never thrown at the save', async () => {
  const orig = console.warn; console.warn = () => {};
  try {
    await requestWelcomeEmail(fakeUser(), 's', { fetch: async () => { throw new Error('offline'); } });
    await requestWelcomeEmail({ getIdToken: async () => { throw new Error('expired'); } }, 's', { fetch: async () => ({}) });
  } finally { console.warn = orig; }
});

// ── Smoke: every show write asks, after the write ──────────────────────

const src = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'context', 'AppContext.jsx'), 'utf8');

// The body of `const <name> = async (...) => {` up to the next top-level
// const in the provider.
function body(name) {
  const start = src.indexOf(`const ${name} = async`);
  assert.ok(start !== -1, `${name} not found`);
  const rest = src.slice(start + 10);
  const next = rest.search(/\n  const [A-Za-z]+ = /);
  return rest.slice(0, next === -1 ? undefined : next);
}

const WRITERS = [
  ['addShow', 'await writeShowDoc(user.uid, newShow)', 'noteShowsAdded(prevCount, [newShow])'],
  ['addShowsFromTour', 'await writeShowDoc(user.uid, show)', 'noteShowsAdded(prevCount, createdThisRun)'],
  ['importShowsToFestival', 'await batch.commit()', 'noteShowsAdded(prevCount, toCreate)'],
  ['handleMigrateData', 'await setDoc(showRef', 'noteShowsAdded(prevCount, localShowsToMigrate)'],
];

for (const [name, write, call] of WRITERS) {
  test(`${name} asks for the welcome email after its write`, () => {
    const b = body(name);
    const w = b.indexOf(write);
    const c = b.indexOf(call);
    assert.ok(w !== -1, `${name}: write "${write}" not found`);
    assert.ok(c !== -1, `${name}: "${call}" not found`);
    assert.ok(c > w, `${name}: asks before it writes`);
    assert.ok(/const prevCount = latestShows\.current/.test(b), `${name}: prevCount is taken before the write`);
  });
}

test('the helper is the only caller of requestWelcomeEmail, and skips guests', () => {
  assert.strictEqual(src.split('requestWelcomeEmail(').length - 1, 1);
  const helper = src.slice(src.indexOf('const noteShowsAdded = '), src.indexOf('const addShow = async'));
  assert.ok(helper.includes('if (!user || guestMode) return;'));
  assert.ok(helper.includes('isFirstShowTransition(prevCount, addedShows.length)'));
  // Fire-and-forget: never awaited.
  assert.ok(!/await requestWelcomeEmail/.test(src));
  assert.ok(!/await noteShowsAdded/.test(src));
});

test('no other function writes show documents without going through one of the four', () => {
  // Every direct write to users/{uid}/shows/{id} that creates a show.
  const creators = [...src.matchAll(/(setDoc|batch\.set)\(doc\(db, 'users', [^)]*'shows'/g)].length
    + (src.match(/await writeShowDoc\(/g) || []).length;
  // writeShowDoc in addShow and addShowsFromTour, batch.set in
  // importShowsToFestival, setDoc in handleMigrateData. A new one fails
  // here until it calls noteShowsAdded and joins WRITERS.
  assert.strictEqual(creators, 4, `found ${creators} show-creating writes`);
});

// 5.59.4 removed the "First show added!" animation. The app is one web
// bundle on the web, mobile web and iOS (Capacitor), so these two files are
// every platform. The welcome email must still go out from addShow.
test('no first-show animation, and addShow still asks for the welcome email', () => {
  const wrapper = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'app', 'AppProviderWrapper.jsx'), 'utf8');
  for (const [file, text] of [['AppContext.jsx', src], ['AppProviderWrapper.jsx', wrapper]]) {
    assert.ok(!/showCelebration|setShowCelebration/.test(text), `${file} still has the celebration state`);
    assert.ok(!text.includes('First show added'), `${file} still renders the celebration`);
  }
  const addShow = src.slice(src.indexOf('const addShow = async'), src.indexOf('const addShowsFromTour'));
  assert.ok(addShow.includes('noteShowsAdded(prevCount, [newShow])'));
  // A guest's first show goes straight to the account prompt.
  assert.ok(addShow.includes('if (isFirstShow) setShowGuestPrompt(true);'));
});

await Promise.all(pending);
console.log(`welcomeEmailTrigger: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
