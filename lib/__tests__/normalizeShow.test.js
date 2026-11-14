/**
 * normalize-show's golden fixtures (fixtures/shows/*.json, 5.60.5): each is
 * one input, the answers its reads get (setlist.fm, the band source, the
 * tag or upcoming show, the user's existing shows), a fixed clock, and the
 * exact document and duplicate verdict lib/normalizeShow.js produces. The
 * Swift app's contract tests read the same files.
 *
 * Also checked: the document the app builds itself when the server can't
 * be reached (offline, or a guest; lib/showAdd.js) is the server's
 * document whenever the band source has nothing to add. Since 5.60.6 the
 * web app sends inputs and runs this same code; 5.60.5's parity report
 * (the old client builders against the server) is in its PR.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/normalizeShow.test.js
 * Regenerate after a deliberate change (then read the diff):
 *   UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/normalizeShow.test.js
 */

import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeShowInput, canonicalizeStoredShow } from '@/lib/normalizeShow';

const DIR = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'shows');
const UPDATE = process.env.UPDATE_FIXTURES === '1';
const idFor = (i) => `song-${i + 1}`;

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

// A band source with nothing for the night unless the fixture says
// otherwise: band-setlist.js's own "no show" answer.
const NO_SHOW = { ok: false, songs: [], shows: [], message: 'No show on that date.' };
const bandAnswer = (ctx) => (ctx.bandSetlist === undefined ? NO_SHOW : ctx.bandSetlist);

function depsFrom(ctx) {
  return {
    setlistfmSetlist: async (id) => (ctx.setlistfm || {})[id] || null,
    bandSetlist: async () => bandAnswer(ctx),
    showTag: async (id) => (ctx.showTags || {})[id] || null,
    pendingEmailTag: async (id) => (ctx.pendingEmailTags || {})[id] || null,
    upcomingShow: async (id) => (ctx.upcomingShows || {})[id] || null,
  };
}

async function run(fixture) {
  const now = () => new Date(fixture.now);
  try {
    const out = await normalizeShowInput(fixture.input, {
      deps: depsFrom(fixture.context), existingShows: fixture.context.existingShows || [], now, idFor,
    });
    return JSON.parse(JSON.stringify(out));
  } catch (err) {
    if (err.code) return { error: err.code };
    throw err;
  }
}

// What the app builds itself, offline (no band source asked).
async function deviceDoc(fixture) {
  const deps = { ...depsFrom(fixture.context), bandSetlist: async () => null };
  const out = await normalizeShowInput(fixture.input, { deps, existingShows: fixture.context.existingShows || [], now: () => new Date(fixture.now), idFor });
  return JSON.parse(JSON.stringify(out.show));
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();

await test('there are fixtures to check', () => assert.ok(files.length >= 12, `found ${files.length}`));

for (const file of files) {
  const full = path.join(DIR, file);
  const fixture = JSON.parse(fs.readFileSync(full, 'utf8'));
  const out = await run(fixture);

  if (UPDATE) {
    fs.writeFileSync(full, `${JSON.stringify({ ...fixture, expected: out }, null, 2)}\n`);
    console.log(`  wrote ${file}`);
    continue;
  }

  await test(`${file}: matches the expected output`, () => {
    assert.ok(fixture.expected, 'no `expected` in the fixture (run with UPDATE_FIXTURES=1)');
    assert.deepStrictEqual(out, fixture.expected);
  });

  if (out.show && out.band.reason !== 'ok') {
    await test(`${file}: the app's own offline build is the same document`, async () => {
      assert.deepStrictEqual(await deviceDoc(fixture), out.show);
    });
  }
}

await test('canonicalizeStoredShow fixes only the date, isManual and a missing setlist', () => {
  const stored = { artist: ' Phish ', venue: 'MSG', date: '31-12-2024', isManual: true, setlistfmId: 'x', setlist: [{ name: '  ' }], tour: '', rating: 9 };
  assert.deepStrictEqual(canonicalizeStoredShow(stored), { changes: ['date', 'isManual'], fields: { date: '2024-12-31', isManual: false } });
  assert.deepStrictEqual(canonicalizeStoredShow({ date: '2024-12-31', isManual: true }), { changes: ['setlist'], fields: { setlist: [] } });
  assert.deepStrictEqual(canonicalizeStoredShow({ date: 'sometime', isManual: true, setlist: [] }).changes, [], 'an unreadable date is left as it is');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
