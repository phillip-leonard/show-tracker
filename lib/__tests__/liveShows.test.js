/**
 * The live shows listener (lib/liveShows.js, 5.60.10, R-06 part 2): it
 * fails loudly and never hangs, and a snapshot never undoes what this
 * device just did. Driven with fake subscribe/readOnce functions and short
 * deadlines; no Firebase.
 *
 *   node lib/__tests__/liveShows.test.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mergeShowsSnapshot, startShowsListener } = require('../liveShows');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docs = (...shows) => shows.map(({ id, ...data }) => ({ id, data: () => data }));

// A harness around startShowsListener that records what it reported.
function harness({ subscribe, readOnce = async () => [], first = 30, read = 30 }) {
  const seen = { shows: [], loaded: [], errors: [] };
  const stop = startShowsListener({
    subscribe,
    readOnce,
    onShows: (s) => seen.shows.push(s.map((x) => x.id)),
    onLoaded: (r) => seen.loaded.push({ live: r.live, error: r.error ? r.error.message : null }),
    onError: (e, stage) => seen.errors.push(stage),
    firstSnapshotMs: first,
    readOnceMs: read,
  });
  return { seen, stop };
}

// ── It never hangs ────────────────────────────────────────────────────

test('a live listener: every snapshot applied, loading ends once, stop unsubscribes', async () => {
  let next;
  let unsubscribed = false;
  const { seen, stop } = harness({ subscribe: (n) => { next = n; return () => { unsubscribed = true; }; } });
  next({ docs: docs({ id: 'a' }) });
  next({ docs: docs({ id: 'a' }, { id: 'b' }) });
  assert.deepStrictEqual(seen.shows, [['a'], ['a', 'b']]);
  assert.deepStrictEqual(seen.loaded, [{ live: true, error: null }]);
  await sleep(50);
  assert.deepStrictEqual(seen.errors, [], 'no deadline fires after the first snapshot');
  stop();
  assert.strictEqual(unsubscribed, true);
});

test('the 5.36.4 failure: a listener that never answers falls back to one read, and loading ends', async () => {
  const { seen } = harness({ subscribe: () => () => {}, readOnce: async () => docs({ id: 'x' }) });
  await sleep(80);
  assert.deepStrictEqual(seen.errors, ['first-snapshot']);
  assert.deepStrictEqual(seen.shows, [['x']]);
  assert.strictEqual(seen.loaded.length, 1);
  assert.strictEqual(seen.loaded[0].live, false);
  assert.match(seen.loaded[0].error, /didn't arrive/);
});

test('and when the one read hangs too, loading still ends, with the error', async () => {
  const { seen } = harness({ subscribe: () => () => {}, readOnce: () => new Promise(() => {}) });
  await sleep(120);
  assert.deepStrictEqual(seen.errors, ['first-snapshot', 'read-once']);
  assert.deepStrictEqual(seen.shows, []);
  assert.strictEqual(seen.loaded.length, 1);
  assert.match(seen.loaded[0].error, /took longer than/);
});

test('a listener error (permission, network) falls back to one read', async () => {
  const { seen } = harness({ subscribe: (n, fail) => { setTimeout(() => fail(new Error('permission-denied')), 5); return () => {}; }, readOnce: async () => docs({ id: 'y' }) });
  await sleep(40);
  assert.deepStrictEqual(seen.errors, ['listener']);
  assert.deepStrictEqual(seen.shows, [['y']]);
  assert.deepStrictEqual(seen.loaded, [{ live: false, error: 'permission-denied' }]);
});

test('a listener that throws as it starts falls back too', async () => {
  const { seen } = harness({ subscribe: () => { throw new Error('boom'); }, readOnce: async () => docs({ id: 'z' }) });
  await sleep(20);
  assert.deepStrictEqual(seen.errors, ['listener']);
  assert.deepStrictEqual(seen.loaded, [{ live: false, error: 'boom' }]);
});

test('a listener that answers late is still used, and loading isn’t reported twice', async () => {
  let next;
  const { seen } = harness({ subscribe: (n) => { next = n; return () => {}; }, readOnce: async () => docs({ id: 'old' }) });
  await sleep(60); // the deadline passed; the one read loaded
  next({ docs: docs({ id: 'old' }, { id: 'new' }) });
  assert.deepStrictEqual(seen.shows, [['old'], ['old', 'new']]);
  assert.strictEqual(seen.loaded.length, 1);
});

test('stopped before anything arrives: nothing reported, nothing applied', async () => {
  let next;
  const { seen, stop } = harness({ subscribe: (n) => { next = n; return () => {}; } });
  stop();
  next({ docs: docs({ id: 'a' }) });
  await sleep(60);
  assert.deepStrictEqual([seen.shows, seen.loaded, seen.errors], [[], [], []]);
});

// ── A snapshot never undoes what this device just did ─────────────────

test('the server’s shows win: an edit made elsewhere appears, a show deleted elsewhere goes', () => {
  const local = [{ id: 'a', rating: 5, setlist: [] }, { id: 'gone', setlist: [] }];
  const server = [{ id: 'a', rating: 9 }, { id: 'b', artist: 'New' }];
  const merged = mergeShowsSnapshot(server, local);
  assert.deepStrictEqual(merged.map((s) => [s.id, s.rating]), [['a', 9], ['b', undefined]]);
  assert.deepStrictEqual(merged[1].setlist, [], 'a missing setlist is []');
});

test('a show this device is still saving (offline, the outbox) stays until the server has it', () => {
  const local = [{ id: 'a' }, { id: 'pending', needsNormalization: true, setlist: [] }];
  assert.deepStrictEqual(mergeShowsSnapshot([{ id: 'a' }], local, { pendingIds: new Set(['pending']) }).map((s) => s.id), ['a', 'pending']);
  assert.deepStrictEqual(mergeShowsSnapshot([{ id: 'a' }], local).map((s) => s.id), ['a'], 'not pending: deleted elsewhere');
});

test('a setlist edit in flight keeps this device’s setlist; the rest of the show is the server’s', () => {
  const mine = [{ id: 's1', name: 'Arcadia', rating: 10 }];
  const local = [{ id: 'a', comment: 'old', setlist: mine }];
  const server = [{ id: 'a', comment: 'edited on the phone', setlist: [{ id: 's1', name: 'Arcadia' }] }];
  const merged = mergeShowsSnapshot(server, local, { setlistInFlight: new Set(['a']) });
  assert.deepStrictEqual([merged[0].comment, merged[0].setlist], ['edited on the phone', mine]);
  assert.deepStrictEqual(mergeShowsSnapshot(server, local)[0].setlist, server[0].setlist, 'once back, the stored setlist');
});

// ── Wiring ────────────────────────────────────────────────────────────

test('AppContext: loadShows listens through startShowsListener, and every way out stops it', () => {
  const ctx = fs.readFileSync(path.join(__dirname, '..', '..', 'context', 'AppContext.jsx'), 'utf8');
  const load = ctx.slice(ctx.indexOf('const loadShows = useCallback'), ctx.indexOf('// ── Load festivals from Firestore'));
  assert.ok(load.includes('startShowsListener({'));
  assert.ok(load.includes('onSnapshot(showsRef, next, fail)'));
  assert.ok(load.includes('stopShowsListener();'), 'a new load stops the old listener (a user switch)');
  assert.ok(/setIsLoading\(false\)/.test(load.slice(load.indexOf('onLoaded'))), 'loading ends in onLoaded');
  const reset = ctx.slice(ctx.indexOf('const resetUserState = () => {'), ctx.indexOf('const resetUserState = () => {') + 400);
  assert.ok(reset.includes('stopShowsListener();'), 'sign-out and session end stop it (resetUserState)');
  assert.ok(ctx.includes('useEffect(() => () => stopShowsListener(), [])'), 'unmount stops it');
  assert.ok(!/getDocs\(showsRef\);\s*\n\s*const loadedShows/.test(ctx), 'the one-time read is only the fallback');
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${t.name}\n    ${e.message}`);
    }
  }
  console.log(`\nliveShows: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
