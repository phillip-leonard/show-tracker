/**
 * lib/setGroups.js (5.60.23): the order of sets and encores, Roman or
 * Arabic, shared by the app and the public show page. The golden cases are
 * fixtures/setlist-grouping/ (lib/__tests__/setlistFixtures.test.js); these
 * are the edges of reading a label.
 *
 *   node lib/__tests__/setGroups.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { setLabelRank, orderSetLabels, setBreakToLabel, toRoman } = require('../setGroups');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('\nSet order (lib/setGroups.js)');

test('sets and encores, Roman or Arabic, any case', () => {
  assert.deepStrictEqual(setLabelRank('Set IX'), { rank: 0, number: 9 });
  assert.deepStrictEqual(setLabelRank('Set 9'), { rank: 0, number: 9 });
  assert.deepStrictEqual(setLabelRank('set iv'), { rank: 0, number: 4 });
  assert.deepStrictEqual(setLabelRank('Set XII'), { rank: 0, number: 12 });
  assert.deepStrictEqual(setLabelRank('Encore'), { rank: 1, number: 1 });
  assert.deepStrictEqual(setLabelRank('Encore II'), { rank: 1, number: 2 });
  assert.deepStrictEqual(setLabelRank('Encore 3'), { rank: 1, number: 3 });
});

test('anything else is "other": not a numeral, a malformed numeral, no number', () => {
  for (const label of ['Soundcheck', 'Set', 'Set IIII', 'Set VX', 'Set 0', 'Encore 0', 'Main Set', '', null]) {
    assert.deepStrictEqual(setLabelRank(label), { rank: 2, number: 0 }, String(label));
  }
});

test('order: sets by number, encores by number, others as they came', () => {
  assert.deepStrictEqual(
    orderSetLabels(['Soundcheck', 'Encore II', 'Set 10', 'Encore', 'Set V', 'Set I', 'Notes']),
    ['Set I', 'Set V', 'Set 10', 'Encore', 'Encore II', 'Soundcheck', 'Notes'],
  );
  assert.deepStrictEqual(orderSetLabels(['Set II', 'Set 2']), ['Set II', 'Set 2'], 'the same number keeps its order');
});

test('legacy setBreak numbers past six become Roman', () => {
  assert.strictEqual(setBreakToLabel('Set 7'), 'Set VII');
  assert.strictEqual(setBreakToLabel('Set 2'), 'Set II');
  assert.strictEqual(setBreakToLabel('Main Set'), 'Set I');
  assert.strictEqual(setBreakToLabel('Encore 2'), 'Encore II');
  assert.strictEqual(setBreakToLabel('Set 0'), 'Set 0');
  assert.strictEqual(toRoman(14), 'XIV');
});

test('the public show page uses this module, not a copy of its own', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../netlify/functions/public-show.js'), 'utf8');
  assert.ok(src.includes("require('../../lib/setGroups')"));
  assert.ok(!/CANONICAL_ORDER|function groupSongsBySet|function setBreakToLabel/.test(src));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
