/**
 * Setlist edits by song id (lib/setlistEdits.js, 5.60.9, R-06), and the
 * concurrent edits they exist for: two devices with the same show open.
 * Each two-device case shows what the old whole-array write did (the
 * second device's save erased the first device's change) and what the
 * edit applied to the stored setlist does (both kept).
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/setlistEdits.test.js
 */

import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { applySetlistEdit } from '@/lib/setlistEdits';

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

const S0 = [
  { id: 's1', name: 'Arcadia', set: 'Set I' },
  { id: 's2', name: 'Hot Tea', set: 'Set I' },
  { id: 's3', name: 'Madhuvan', set: 'Encore' },
];
const by = (list, id) => list.find((s) => s.id === id);

// ── Each edit ─────────────────────────────────────────────────────────

test('rate / comment one song; clearing a rating stores null', () => {
  const rated = applySetlistEdit(S0, { type: 'rate', songId: 's2', rating: 9 });
  assert.strictEqual(rated.changed, true);
  assert.strictEqual(by(rated.setlist, 's2').rating, 9);
  assert.strictEqual(by(rated.setlist, 's1').rating, undefined);
  assert.strictEqual(by(applySetlistEdit(rated.setlist, { type: 'rate', songId: 's2', rating: undefined }).setlist, 's2').rating, null);
  assert.strictEqual(by(applySetlistEdit(S0, { type: 'comment', songId: 's1', comment: 'opener' }).setlist, 's1').comment, 'opener');
});

test('an edit that changes nothing reports unchanged and returns the same array', () => {
  const same = applySetlistEdit(S0, { type: 'rate', songId: 'nope', rating: 5 });
  assert.deepStrictEqual([same.changed, same.setlist === S0], [false, true]);
  const again = applySetlistEdit([{ id: 'a', rating: 5 }], { type: 'rate', songId: 'a', rating: 5 });
  assert.strictEqual(again.changed, false);
});

test('rate-unrated rates only the songs with no rating', () => {
  const list = [{ id: 'a', rating: 4 }, { id: 'b' }, { id: 'c', rating: null }];
  assert.deepStrictEqual(applySetlistEdit(list, { type: 'rate-unrated', rating: 7 }).setlist.map((s) => s.rating), [4, 7, 7]);
});

test('add appends once; delete reports what it removed; restore puts it back where it was, once', () => {
  const added = applySetlistEdit(S0, { type: 'add', song: { id: 'm1', name: 'Tumble', set: 'Set I', manuallyAdded: true } });
  assert.deepStrictEqual(added.setlist.map((s) => s.id), ['s1', 's2', 's3', 'm1']);
  assert.strictEqual(applySetlistEdit(added.setlist, { type: 'add', song: { id: 'm1' } }).changed, false);

  const rated = applySetlistEdit(S0, { type: 'rate', songId: 's2', rating: 8 }).setlist;
  const del = applySetlistEdit(rated, { type: 'delete', songId: 's2' });
  assert.deepStrictEqual([del.changed, del.removed.id, del.removed.rating, del.index], [true, 's2', 8, 1]);
  assert.strictEqual(applySetlistEdit(del.setlist, { type: 'delete', songId: 's2' }).changed, false, 'a double tap');
  const back = applySetlistEdit(del.setlist, { type: 'restore', song: del.removed, index: del.index });
  assert.deepStrictEqual(back.setlist, rated);
  assert.strictEqual(applySetlistEdit(back.setlist, { type: 'restore', song: del.removed, index: 1 }).changed, false, 'undo pressed twice');
});

test('reorder takes the editor’s order and set labels', () => {
  const edited = [{ ...S0[2], set: 'Set I' }, S0[0], S0[1]];
  const out = applySetlistEdit(S0, { type: 'reorder', setlist: edited });
  assert.deepStrictEqual(out.setlist.map((s) => [s.id, s.set]), [['s3', 'Set I'], ['s1', 'Set I'], ['s2', 'Set I']]);
  assert.strictEqual(applySetlistEdit(S0, { type: 'reorder', setlist: S0 }).changed, false);
});

// ── Two devices, one show ─────────────────────────────────────────────
//
// Both loaded S0. The phone saves first; then the laptop saves an edit
// from its copy, which predates the phone's.

const oldWholeArrayWrite = (laptopCopy, edit) => applySetlistEdit(laptopCopy, edit).setlist; // what was written over the stored setlist
const newEditOnStored = (stored, edit) => applySetlistEdit(stored, edit).setlist;

test('phone rates song 2, laptop rates song 1: both ratings kept (the old write lost the phone’s)', () => {
  const stored = applySetlistEdit(S0, { type: 'rate', songId: 's2', rating: 9 }).setlist; // the phone
  const edit = { type: 'rate', songId: 's1', rating: 7 }; // the laptop
  assert.strictEqual(by(oldWholeArrayWrite(S0, edit), 's2').rating, undefined, 'before 5.60.9: the phone’s rating erased');
  const now = newEditOnStored(stored, edit);
  assert.deepStrictEqual([by(now, 's1').rating, by(now, 's2').rating], [7, 9]);
});

test('phone comments, laptop reorders: the comment survives the reorder', () => {
  const stored = applySetlistEdit(S0, { type: 'comment', songId: 's3', comment: 'chills' }).setlist;
  const edit = { type: 'reorder', setlist: [S0[1], S0[0], S0[2]] };
  assert.strictEqual(by(oldWholeArrayWrite(S0, edit), 's3').comment, undefined);
  const now = newEditOnStored(stored, edit);
  assert.deepStrictEqual(now.map((s) => s.id), ['s2', 's1', 's3']);
  assert.strictEqual(by(now, 's3').comment, 'chills');
});

test('phone adds a song, laptop reorders: the added song stays', () => {
  const stored = applySetlistEdit(S0, { type: 'add', song: { id: 'm1', name: 'Tumble', set: 'Set I', manuallyAdded: true, rating: 10 } }).setlist;
  const now = newEditOnStored(stored, { type: 'reorder', setlist: [S0[2], S0[1], S0[0]] });
  assert.deepStrictEqual(now.map((s) => s.id), ['s3', 's2', 's1', 'm1']);
  assert.strictEqual(by(now, 'm1').rating, 10);
});

test('phone deletes a song, laptop rates another: the delete stands', () => {
  const stored = applySetlistEdit(S0, { type: 'delete', songId: 's3' }).setlist;
  const edit = { type: 'rate', songId: 's1', rating: 6 };
  assert.ok(by(oldWholeArrayWrite(S0, edit), 's3'), 'before 5.60.9: the deleted song came back');
  const now = newEditOnStored(stored, edit);
  assert.deepStrictEqual(now.map((s) => [s.id, s.rating]), [['s1', 6], ['s2', undefined]]);
});

test('phone rates song 2, laptop rates the unrated: the phone’s rating is not overwritten', () => {
  const stored = applySetlistEdit(S0, { type: 'rate', songId: 's2', rating: 10 }).setlist;
  const now = newEditOnStored(stored, { type: 'rate-unrated', rating: 5 });
  assert.deepStrictEqual(now.map((s) => s.rating), [5, 10, 5]);
});

// ── The app writes no whole show any more ─────────────────────────────

test('AppContext: no whole-show write; edits are field updates, arrayUnion, or setlist transactions', () => {
  const ctx = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'context', 'AppContext.jsx'), 'utf8');
  assert.ok(!/const saveShow = /.test(ctx), 'saveShow is gone');
  assert.ok(!/setDoc\(showRef/.test(ctx));
  for (const fn of ['updateSongRating', 'updateSongComment', 'addSongToShow', 'batchRateUnrated', 'deleteSong', 'restoreSongToShow', 'updateSetlistOrder']) {
    const start = ctx.indexOf(`const ${fn} = async`);
    assert.ok(start > 0, fn);
    assert.ok(ctx.slice(start, start + 600).includes('editSetlist('), `${fn} goes through editSetlist`);
  }
  for (const fn of ['updateShowRating', 'updateShowComment', 'updateArchivalAudioPick']) {
    const start = ctx.indexOf(`const ${fn} = `);
    assert.ok(ctx.slice(start, start + 400).includes('updateShowFields('), `${fn} writes its field only`);
  }
  assert.ok(ctx.includes('taggedFriendUids: arrayUnion('));
  assert.ok(/runTransaction\(db, async \(tx\) => \{[\s\S]{0,300}applySetlistEdit\(snap\.data\(\)\.setlist/.test(ctx), 'the edit is applied to the stored setlist');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
