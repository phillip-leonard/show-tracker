/**
 * lib/showDoc.js — one builder and one id scheme for every add path
 * (B-13, 5.59.10), and the festival import's duplicate rule.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/showDoc.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { buildShowDoc, mintShowId, isBandSourced } from '@/lib/showDoc';
import { findDuplicate } from '@/lib/showIdentity';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const ctx = fs.readFileSync(path.join(ROOT, 'context/AppContext.jsx'), 'utf8');

let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// What FestivalLineupModal hands importShowsToFestival for one set.
const festivalCandidate = {
  artist: 'Goose', venue: 'Bonnaroo Farm', city: 'Manchester', country: 'United States',
  date: '2025-06-14', setlist: [{ name: 'Arcadia' }], setlistfmId: '13abcd', setlistfmUrl: null, tour: null,
};

test('mintShowId: 13-digit ms strings, unique and increasing within a millisecond', () => {
  const ids = Array.from({ length: 500 }, () => mintShowId());
  assert.ok(ids.every((id) => /^\d{13}$/.test(id)));
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(ids.every((id, i) => i === 0 || Number(id) > Number(ids[i - 1])));
});

test('buildShowDoc: ISO date, setlist default, isManual by source', () => {
  const doc = buildShowDoc({ ...festivalCandidate, date: '14-06-2025' }, 'x');
  assert.strictEqual(doc.date, '2025-06-14');
  assert.strictEqual(doc.id, 'x');
  assert.strictEqual(doc.isManual, false, 'has a setlist.fm id');
  assert.strictEqual(buildShowDoc({ artist: 'A', date: '2025-01-01', setlistSource: 'elgoose' }, 'y').isManual, false, 'band-sourced');
  assert.strictEqual(buildShowDoc({ artist: 'A', date: '2025-01-01' }, 'z').isManual, true, 'typed by hand');
  assert.deepStrictEqual(buildShowDoc({ artist: 'A', date: '2025-01-01' }, 'z').setlist, []);
  assert.ok(isBandSourced({ setlistSource: 'phishnet' }) && !isBandSourced({ setlistSource: 'setlistfm' }));
});

test('a festival set and the same set added through search are the same document shape', () => {
  const viaFestival = buildShowDoc(festivalCandidate, '1');
  const viaSearch = buildShowDoc({ ...festivalCandidate }, '2');
  const strip = ({ id, createdAt, ...rest }) => rest;
  assert.deepStrictEqual(strip(viaFestival), strip(viaSearch));
});

test('a festival import is a duplicate of the same set added normally (any date format)', () => {
  const addedNormally = { id: '1700000000000', ...festivalCandidate, setlistfmId: undefined, date: '14-06-2025' };
  assert.strictEqual(findDuplicate([addedNormally], festivalCandidate), addedNormally);
  assert.strictEqual(findDuplicate([addedNormally], { ...festivalCandidate, date: '2025-06-15' }), null);
});

test('importShowsToFestival writes through normalize-show with the one duplicate rule (5.60.6)', () => {
  const start = ctx.indexOf('const importShowsToFestival = async');
  const body = ctx.slice(start, ctx.indexOf('const detachShowsFromFestival', start));
  assert.ok(start > 0 && body.length > 0);
  assert.ok(body.includes("kind: 'festival-row'"));
  assert.ok(body.includes('commitShowInputs('));
  assert.ok(body.includes('classifyDuplicate('));
  assert.ok(!/idSeed|isManual:|buildShowDoc\(|enrichShowDataWithBandSetlist/.test(body), 'no document built here');
});

test('no add path in AppContext builds a show document itself (5.60.6)', () => {
  // Every add goes to normalize-show (commitShowInputs); the app builds a
  // document only through lib/normalizeShow.js, for a guest or offline.
  assert.ok(!/enrichShowDataWithBandSetlist|buildShowDoc\(/.test(ctx));
  for (const fn of ['const addShow = async', 'const addShowsFromTour = async']) {
    const start = ctx.indexOf(fn);
    assert.ok(start > 0, fn);
    assert.ok(ctx.slice(start, start + 6000).includes('commitShowInputs('), `${fn} sends to normalize-show`);
  }
});

test('AppContext has no builder of its own', () => {
  assert.ok(!/function (buildShowDoc|mintShowId)\(/.test(ctx));
  assert.ok(ctx.includes("from '@/lib/showDoc'"));
});

for (const t of tests) {
  try { await t.fn(); passed++; } catch (err) { failed++; console.error(`✗ ${t.name}\n  ${err.message}`); }
}
console.log(`\nshowDoc: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
