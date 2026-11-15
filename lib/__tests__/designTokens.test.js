/**
 * fixtures/design/tokens.json against app/globals.css: the colors the native
 * app's DesignSystem ships (its asset catalog is checked against the same
 * table in DesignSystemTests) are the ones the web app ships (D-5).
 *
 *   node lib/__tests__/designTokens.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'design', 'tokens.json'), 'utf8'));
const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');
const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));

const parse = (value) => {
  const v = value.trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{6})$/);
  if (m) return { hex: `#${m[1]}`, alpha: 1 };
  m = v.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  if (m) {
    const hex = '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    return { hex, alpha: Number(m[4]) };
  }
  throw new Error(`unreadable color ${value}`);
};

let passed = 0;
let failed = 0;
for (const token of table.colors) {
  try {
    const m = rootBlock.match(new RegExp(`${token.css}:\\s*([^;]+);`));
    assert.ok(m, `${token.css} is not in globals.css :root`);
    const got = parse(m[1]);
    assert.strictEqual(got.hex, token.hex.toLowerCase(), `${token.name} (${token.css}) hex`);
    assert.strictEqual(got.alpha, token.alpha, `${token.name} (${token.css}) alpha`);
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${e.message}`);
  }
}

console.log(`designTokens: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
