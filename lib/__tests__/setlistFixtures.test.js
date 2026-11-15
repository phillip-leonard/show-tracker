/**
 * The setlist golden fixtures (5.60.22, native Stage 1): fixtures/setlist-edits/
 * (lib/setlistEdits.js applySetlistEdit) and fixtures/setlist-grouping/
 * (lib/setlistGrouping.js). The Swift app ports both and runs the same
 * files (Part 3b), so a change here is a change in both apps.
 *
 * Each case's `expected` is checked against the code, and each `survives`
 * entry (a song that must still carry its rating and comment) is checked
 * on its own, so regenerating the expected values can't quietly accept an
 * edit that drops a rating.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/setlistFixtures.test.js
 * Regenerate `expected` after a deliberate change (then read the diff):
 *   UPDATE_FIXTURES=1 node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/setlistFixtures.test.js
 */

import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySetlistEdit } from '@/lib/setlistEdits';
import { groupSongsBySet, getSetOptions, moveSongToSet, reorderSongWithinSet } from '@/lib/setlistGrouping';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UPDATE = process.env.UPDATE_FIXTURES === '1';
const EDIT_TYPES = ['rate', 'comment', 'rate-unrated', 'add', 'delete', 'restore', 'reorder'];

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

const json = (v) => JSON.parse(JSON.stringify(v)); // as the fixture stores it: no undefined
const clone = (v) => structuredClone(v);

function readFixture(rel) {
  const file = path.join(ROOT, 'fixtures', rel);
  return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function writeFixture(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function checkSurvives(setlist, survives = [], label) {
  for (const s of survives) {
    const song = setlist.find((x) => x && x.id === s.songId);
    assert.ok(song, `${label}: ${s.songId} is gone`);
    if ('rating' in s) assert.strictEqual(song.rating ?? null, s.rating, `${label}: ${s.songId}'s rating`);
    if ('comment' in s) assert.strictEqual(song.comment, s.comment, `${label}: ${s.songId}'s comment`);
  }
}

/**
 * Runs every case of one fixture file: `compute(case)` -> the actual value;
 * `setlistOf(actual)` -> the setlist to check `survives` against.
 */
function runFile(rel, compute, setlistOf) {
  const { file, data } = readFixture(rel);
  let changed = false;
  for (const c of data.cases) {
    const input = clone(c);
    const actual = json(compute(input));
    test(`${rel}: ${c.name}`, () => {
      assert.deepStrictEqual(input.setlist, c.setlist, 'the input setlist is not changed in place');
      if (setlistOf) checkSurvives(setlistOf(actual), c.survives, c.name);
      if (UPDATE) {
        if (JSON.stringify(c.expected) !== JSON.stringify(actual)) { c.expected = actual; changed = true; }
      } else {
        assert.deepStrictEqual(c.expected, actual);
      }
    });
  }
  if (UPDATE && changed) {
    writeFixture(file, data);
    console.log(`  (updated ${rel})`);
  }
}

console.log('\nSetlist fixtures (fixtures/setlist-edits, fixtures/setlist-grouping)');

test('every edit type has a fixture file, and each file holds only its own type', () => {
  const files = fs.readdirSync(path.join(ROOT, 'fixtures/setlist-edits')).filter((f) => f.endsWith('.json')).sort();
  assert.deepStrictEqual(files, EDIT_TYPES.map((t) => `${t}.json`).sort());
  for (const type of EDIT_TYPES) {
    const { data } = readFixture(`setlist-edits/${type}.json`);
    assert.ok(data.cases.length > 0, type);
    for (const c of data.cases) assert.strictEqual(c.edit.type, type, `${type}: ${c.name}`);
  }
});

for (const type of EDIT_TYPES) {
  runFile(`setlist-edits/${type}.json`, (c) => applySetlistEdit(c.setlist, c.edit), (r) => r.setlist);
}

test('fields the app doesn\'t know about survive every edit (segue, footnote, jam chart, slug)', () => {
  for (const type of EDIT_TYPES) {
    const { data } = readFixture(`setlist-edits/${type}.json`);
    for (const c of data.cases) {
      const before = new Map(c.setlist.map((s) => [s.id, s]));
      for (const song of c.expected.setlist) {
        const was = before.get(song.id);
        if (!was) continue;
        for (const k of ['transitionMark', 'footnote', 'jamchart', 'songSlug', 'cover', 'tape']) {
          if (k in was) assert.deepStrictEqual(song[k], was[k], `${type}: ${c.name}: ${song.id}.${k}`);
        }
      }
    }
  }
});

runFile('setlist-grouping/groups.json', (c) => groupSongsBySet(c.setlist).map((g) => ({ label: g.label, songIds: g.songs.map((s) => s.id) })));
runFile('setlist-grouping/options.json', (c) => getSetOptions(c.setlist));
runFile('setlist-grouping/move.json', (c) => moveSongToSet(c.setlist, c.songId, c.label), (r) => r);
runFile('setlist-grouping/reorder.json', (c) => reorderSongWithinSet(c.setlist, c.label, c.index, c.direction), (r) => r);

test('an editor move sent as a reorder edit keeps a rating made elsewhere meanwhile', () => {
  // The chain the show page runs: moveSongToSet on this device's copy, then
  // the reorder edit applied to the stored setlist, which is newer.
  const { data } = readFixture('setlist-grouping/move.json');
  const c = data.cases[0];
  const deviceCopy = c.setlist.map((s) => (s.id === 's1' ? { ...s, rating: null, comment: undefined } : s));
  const stored = clone(c.setlist);
  const edited = moveSongToSet(deviceCopy, c.songId, c.label);
  const { setlist } = applySetlistEdit(stored, { type: 'reorder', setlist: edited });
  checkSurvives(setlist, [{ songId: 's1', rating: 8, comment: 'Huge jam' }], 'move then reorder');
  assert.strictEqual(setlist.find((s) => s.id === c.songId).set, c.label);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
