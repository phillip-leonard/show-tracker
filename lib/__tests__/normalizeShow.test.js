/**
 * normalize-show's golden fixtures (fixtures/shows/*.json, 5.60.5): each is
 * one input, the answers its reads get (setlist.fm, the band source, the
 * tag or upcoming show, the user's existing shows), a fixed clock, and the
 * exact document and duplicate verdict lib/normalizeShow.js produces. The
 * Swift app's contract tests read the same files.
 *
 * Also checked, the parity with the web app's add path today: for the
 * kinds the app already builds (setlist.fm results, typed shows, upcoming
 * shows), the document AppContext.addShow would write from the same data
 * (lib/setlistSearch.js setlistToShowData, lib/bandSetlistRules.js
 * applyBandSetlist, lib/showDoc.js buildShowDoc), once in the canonical
 * shape, is the server's document. The only field the server adds is
 * artistMbid, which the app's search never stored.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/normalizeShow.test.js
 * Regenerate after a deliberate change (then read the diff):
 *   UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/normalizeShow.test.js
 */

import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeShowInput, canonicalizeStoredShow, SHOW_SCHEMA_VERSION } from '@/lib/normalizeShow';
import { canonicalShowData, upcomingToShowData } from '@/lib/showInputs';
import { setlistToShowData } from '@/lib/setlistSearch';
import { extractSongsFromSetlist } from '@/lib/setlistParser';
import { bandSetlistRequest, bandSetlistResultFrom, applyBandSetlist } from '@/lib/bandSetlistRules';
import { buildShowDoc } from '@/lib/showDoc';

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

// What the web app writes today from the same data (AppContext.addShow).
async function clientDoc(fixture) {
  const { input, context: ctx } = fixture;
  const now = () => new Date(fixture.now);
  const extract = (s) => extractSongsFromSetlist(s, { idFor });
  let data;
  if (input.kind === 'setlistfm') data = setlistToShowData(ctx.setlistfm[input.setlistfmId], extract);
  else if (input.kind === 'manual') { const { kind: _k, showId: _s, ...fields } = input; data = fields; }
  else if (input.kind === 'upcoming') data = upcomingToShowData(ctx.upcomingShows[input.upcomingId], setlistToShowData(ctx.setlistfm[input.setlistfmId], extract));
  else return null;
  const req = bandSetlistRequest({ artist: data.artist, artistMbid: data.artistMbid, date: data.date, venue: data.venue });
  const result = req.source ? bandSetlistResultFrom(req.source, bandAnswer(ctx)).result : null;
  const doc = buildShowDoc(applyBandSetlist(data, result, { now }), input.showId, { now });
  return JSON.parse(JSON.stringify({ ...buildShowDoc(canonicalShowData(doc, { idFor }), input.showId, { now }), normalizedVersion: SHOW_SCHEMA_VERSION }));
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

  const client = out.show && await clientDoc(fixture);
  if (client) {
    await test(`${file}: the web app's add path gives the same document (but artistMbid)`, () => {
      const { artistMbid: _a, ...server } = out.show;
      assert.deepStrictEqual(client, server);
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
