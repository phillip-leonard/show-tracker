/**
 * The show field-edit golden fixtures (5.60.25, native Stage 1 Part 3a):
 * fixtures/show-edits/. The native show page writes the show rating, the
 * venue rating and the note one field at a time (lib/showFieldEdits.js);
 * its Swift copy (`ShowFieldEdit`) reads the same file. A change here is a
 * change to what the app writes.
 *
 * Run with:
 *   node lib/__tests__/showEditFixtures.test.js
 * Regenerate `expected` after a deliberate change (then read the diff):
 *   UPDATE_FIXTURES=1 node lib/__tests__/showEditFixtures.test.js
 */

const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const { showFieldEdit, applyShowFieldEdit, SHOW_FIELDS } = require('../showFieldEdits');

const ROOT = path.join(__dirname, '../..');
const UPDATE = process.env.UPDATE_FIXTURES === '1';

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

const json = (v) => JSON.parse(JSON.stringify(v));

console.log('\nShow field-edit fixtures (fixtures/show-edits)');

const file = path.join(ROOT, 'fixtures/show-edits/fields.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
let changed = false;

for (const c of data.cases) {
  const edit = showFieldEdit(c.field, c.value);
  const actual = json({ edit, show: applyShowFieldEdit(c.show, edit) });
  test(`fields.json: ${c.name}`, () => {
    if (UPDATE) {
      if (JSON.stringify(c.expected) !== JSON.stringify(actual)) { c.expected = actual; changed = true; }
    } else {
      assert.deepStrictEqual(c.expected, actual);
    }
  });

  // Checked on their own, so regenerating `expected` can't accept an edit
  // that touches a second field (R-06).
  test(`fields.json: ${c.name}: writes at most the one field`, () => {
    const keys = [...Object.keys(edit.set || {}), ...(edit.remove || [])];
    assert.ok(keys.length <= 1, `writes ${keys.join(', ')}`);
    if (keys.length) assert.strictEqual(keys[0], c.field);
    const after = applyShowFieldEdit(c.show, edit);
    for (const key of new Set([...Object.keys(c.show), ...Object.keys(after)])) {
      if (key === c.field) continue;
      assert.deepStrictEqual(after[key], c.show[key], `${key} changed`);
    }
  });
}

test('every editable field has a case that sets it and one that clears it', () => {
  for (const field of Object.keys(SHOW_FIELDS)) {
    assert.ok(data.cases.some((c) => c.field === field && c.expected.edit?.set), `${field}: no set case`);
    assert.ok(data.cases.some((c) => c.field === field && c.expected.edit?.remove), `${field}: no clear case`);
  }
});

test('a cleared field is removed, never written as 0 or empty', () => {
  for (const c of data.cases) {
    const set = c.expected.edit?.set || {};
    for (const v of Object.values(set)) assert.ok(v !== 0 && v !== '' && v !== null, `${c.name} writes ${JSON.stringify(v)}`);
  }
});

if (UPDATE && changed) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log('  (updated fields.json)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
