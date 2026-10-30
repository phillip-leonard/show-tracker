/**
 * Unit tests for the native wide-layout thresholds in lib/platform.js, against
 * the content column each iPad actually gets: the screen, minus the 256px
 * sidebar from md up, minus the column's padding, capped at 1200px wide.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/wideLayout.test.js
 */

import assert from 'assert';
import {
  SPLIT_VIEW_MIN_WIDTH, WIDE_LIST_MIN_WIDTH, splitPaneHasSideColumn,
} from '@/lib/platform';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

function columnWidth(screen) {
  if (screen < 768) return screen - 32;
  return Math.min(1200, screen - 256) - 64;
}

// [screen width, splits?, two-column lists?, side column in the split?]
const SCREENS = [
  ['iPad mini portrait', 744, true, false, false],
  ['iPad mini landscape', 1133, true, true, false],
  ['iPad 11" portrait', 834, false, false, false],
  ['iPad 11" landscape', 1194, true, true, false],
  ['iPad 12.9" portrait', 1024, true, false, false],
  ['iPad 12.9" landscape', 1366, true, true, true],
  ['iPad half-screen Split View', 678, true, false, false],
  // 956pt less a 62pt side inset each way, which an iPad doesn't have.
  ['iPhone Pro Max landscape', 832, false, false, false],
];

for (const [name, screen, split, wideList, sideColumn] of SCREENS) {
  test(name, () => {
    const column = columnWidth(screen);
    assert.strictEqual(column >= SPLIT_VIEW_MIN_WIDTH, split, 'split view');
    assert.strictEqual(column >= WIDE_LIST_MIN_WIDTH, wideList, 'two-column list');
    assert.strictEqual(splitPaneHasSideColumn(column), sideColumn, 'side column');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
