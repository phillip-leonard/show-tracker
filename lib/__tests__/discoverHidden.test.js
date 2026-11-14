/**
 * Discover hidden from navigation (5.60.2): one flag, every visible way in
 * goes through it, and the route still works (noindex) for direct links.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/discoverHidden.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { DISCOVER_NAV_ENABLED } from '@/lib/constants';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p, out); }
    else if (/\.(jsx?|mjs|tsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('the flag is off', () => {
  assert.strictEqual(DISCOVER_NAV_ENABLED, false);
});

test('the sidebar item and the "Fans also see" button go through the flag', () => {
  const sb = read('components/layout/Sidebar.jsx');
  assert.ok(sb.includes("DISCOVER_NAV_ENABLED && !isGuest && { id: 'discover'"), 'sidebar (desktop and drawer share the array)');
  const link = read('components/discover/FansAlsoSeeLink.jsx');
  assert.ok(link.includes('if (!DISCOVER_NAV_ENABLED ||'), 'FansAlsoSeeLink');
  const notes = read('components/ReleaseNotesView.jsx');
  assert.ok(notes.includes('const shownReleases = DISCOVER_NAV_ENABLED'), 'the old "Discover, in the menu" note');
  assert.ok(notes.includes('{shownReleases.map('));
});

test('no other code links into /discover', () => {
  // Files allowed to name /discover: the route itself, its href helper,
  // the nav table (back controls), and the two flagged entry points.
  const allowed = new Set([
    'app/discover/page.jsx',
    'lib/showRouting.js',
    'lib/navRoutes.js',
    'components/layout/Sidebar.jsx',
    'components/discover/FansAlsoSeeLink.jsx',
  ]);
  const offenders = [];
  for (const dir of ['app', 'components', 'lib', 'context', 'hooks', 'netlify/functions']) {
    for (const f of walk(dir)) {
      if (allowed.has(f)) continue;
      const src = read(f);
      if (/['"`]\/discover\b/.test(src) || /\bdiscoverHref\s*\(/.test(src)) offenders.push(f);
    }
  }
  assert.deepStrictEqual(offenders, [], 'gate these behind DISCOVER_NAV_ENABLED');
});

test('/discover still exists for direct links and is noindex', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'app/discover/page.jsx')));
  assert.ok(read('app/discover/layout.jsx').includes('robots: { index: false, follow: false }'));
});

for (const t of tests) {
  try { await t.fn(); passed++; } catch (err) { failed++; console.error(`✗ ${t.name}\n  ${err.message}`); }
}
console.log(`\ndiscoverHidden: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
