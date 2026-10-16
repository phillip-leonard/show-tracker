/**
 * Unit tests for `impact` in lib/capacitor.js — the haptic the three swipe
 * gestures fire when they commit.
 *
 * WHY THESE EXIST. Every caller fires `impact('light')` unawaited, just
 * before it navigates, dismisses or closes. For 5.36.0–5.43.0 the export did
 * not exist at all, so each commit would have thrown before its action (the
 * gestures shipped switched off because of it). The contract pinned here is
 * the one that makes it safe to call from shared code: a no-op off native,
 * and it never rejects, whatever the plugin does.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/haptics.test.js
 */

import assert from 'assert';
import { createImpact, impact } from '@/lib/capacitor';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

const ImpactStyle = { Heavy: 'HEAVY', Medium: 'MEDIUM', Light: 'LIGHT' };

/** A fake @capacitor/haptics that records calls, or rejects if told to. */
function fakeHaptics({ reject = false } = {}) {
  const calls = [];
  return {
    calls,
    module: {
      ImpactStyle,
      Haptics: {
        impact: async (opts) => {
          calls.push(opts);
          if (reject) throw new Error('Haptics unavailable');
        },
      },
    },
  };
}

// ── The real export ───────────────────────────────────────────────────

await test('impact is exported as a function', () => {
  assert.strictEqual(typeof impact, 'function');
});

await test('the real impact resolves off native (plain node is not native)', async () => {
  assert.strictEqual(await impact('light'), undefined);
  assert.strictEqual(await impact(), undefined);
});

// ── Web ───────────────────────────────────────────────────────────────

await test('on web it never loads the plugin', async () => {
  let loaded = false;
  const run = createImpact({
    isNative: () => false,
    loadHaptics: async () => { loaded = true; return fakeHaptics().module; },
  });
  await run('light');
  assert.strictEqual(loaded, false);
});

// ── Native ────────────────────────────────────────────────────────────

await test('on native it fires one light impact by default', async () => {
  const fake = fakeHaptics();
  const run = createImpact({ isNative: () => true, loadHaptics: async () => fake.module });
  await run();
  assert.deepStrictEqual(fake.calls, [{ style: 'LIGHT' }]);
});

await test("impact('light') is a light impact, as the callers pass it", async () => {
  const fake = fakeHaptics();
  const run = createImpact({ isNative: () => true, loadHaptics: async () => fake.module });
  await run('light');
  assert.deepStrictEqual(fake.calls, [{ style: 'LIGHT' }]);
});

await test('medium and heavy map through; an unknown style falls back to light', async () => {
  const fake = fakeHaptics();
  const run = createImpact({ isNative: () => true, loadHaptics: async () => fake.module });
  await run('medium');
  await run('heavy');
  await run('thud');
  assert.deepStrictEqual(fake.calls, [{ style: 'MEDIUM' }, { style: 'HEAVY' }, { style: 'LIGHT' }]);
});

// ── Never throws ──────────────────────────────────────────────────────

await test('resolves when the Haptics plugin call rejects', async () => {
  const fake = fakeHaptics({ reject: true });
  const run = createImpact({ isNative: () => true, loadHaptics: async () => fake.module });
  assert.strictEqual(await run('light'), undefined);
  assert.strictEqual(fake.calls.length, 1);
});

await test('resolves when the plugin module fails to load', async () => {
  const run = createImpact({
    isNative: () => true,
    loadHaptics: async () => { throw new Error('Cannot find module'); },
  });
  assert.strictEqual(await run('light'), undefined);
});

await test('resolves when the platform check itself throws', async () => {
  const run = createImpact({
    isNative: () => { throw new Error('no Capacitor'); },
    loadHaptics: async () => fakeHaptics().module,
  });
  assert.strictEqual(await run('light'), undefined);
});

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
