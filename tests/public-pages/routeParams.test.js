#!/usr/bin/env node
/**
 * Public page routing — the /u/, /u/.../shows/... and /shared/ functions get
 * their ids from the request path, and the sitemap lists each handle once.
 *
 *   node tests/public-pages/routeParams.test.js
 *
 * Why this test exists: from v5.6.0 to 5.44.3 every public profile, show and
 * shared page returned 404 "No profile handle given." The netlify.toml
 * rewrites passed the handle as a query-string placeholder
 * (?handle=:handle), which never reached the function. The sitemap was
 * listing those 404s to Google, one of them twice.
 */

const assert = require('node:assert');
const { routeParams } = require('../../netlify/functions/lib/publicRouteParams');
const sitemap = require('../../netlify/functions/sitemap');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ── Profile ──────────────────────────────────────────────────────────────

test('profile: public URL with and without trailing slash', () => {
  assert.deepStrictEqual(routeParams({ path: '/u/phillip/' }, 'profile'), { handle: 'phillip' });
  assert.deepStrictEqual(routeParams({ path: '/u/phillip' }, 'profile'), { handle: 'phillip' });
});

test('profile: rewritten function URL', () => {
  assert.deepStrictEqual(routeParams({ path: '/.netlify/functions/public-profile/phillip' }, 'profile'), { handle: 'phillip' });
});

test('profile: the visitor\'s own ?page= does not hide the path handle', () => {
  // The exact shape that produced the bug: queryStringParameters present,
  // but holding only the visitor's query, not the rewrite's.
  const event = { path: '/u/phillip/', queryStringParameters: { page: '2' } };
  assert.deepStrictEqual(routeParams(event, 'profile'), { handle: 'phillip' });
});

test('profile: falls back to rawUrl when path is unhelpful', () => {
  const event = { path: '/.netlify/functions/public-profile', rawUrl: 'https://mysetlists.net/u/phillip/?page=2' };
  assert.deepStrictEqual(routeParams(event, 'profile'), { handle: 'phillip' });
});

test('profile: an explicit ?handle= still works (direct function call)', () => {
  const event = { path: '/.netlify/functions/public-profile', queryStringParameters: { handle: 'phillip' } };
  assert.deepStrictEqual(routeParams(event, 'profile'), { handle: 'phillip' });
});

test('profile: no handle anywhere gives an empty string', () => {
  assert.deepStrictEqual(routeParams({ path: '/.netlify/functions/public-profile' }, 'profile'), { handle: '' });
  assert.deepStrictEqual(routeParams({}, 'profile'), { handle: '' });
});

test('profile: a show URL is not mistaken for a profile', () => {
  assert.deepStrictEqual(routeParams({ path: '/u/phillip/shows/abc123/' }, 'profile'), { handle: '' });
});

// ── Show ─────────────────────────────────────────────────────────────────

test('show: public URL', () => {
  assert.deepStrictEqual(routeParams({ path: '/u/phillip/shows/abc123/' }, 'show'), { handle: 'phillip', showId: 'abc123' });
});

test('show: rewritten function URL', () => {
  assert.deepStrictEqual(
    routeParams({ path: '/.netlify/functions/public-show/phillip/abc123' }, 'show'),
    { handle: 'phillip', showId: 'abc123' },
  );
});

test('show: percent-encoded show id is decoded; a malformed one is dropped', () => {
  assert.strictEqual(routeParams({ path: '/u/phillip/shows/a%20b/' }, 'show').showId, 'a b');
  assert.strictEqual(routeParams({ path: '/u/phillip/shows/%E0%A4%A/' }, 'show').showId, '');
});

// ── Shared ───────────────────────────────────────────────────────────────

test('shared: public URL and function URL', () => {
  assert.deepStrictEqual(routeParams({ path: '/shared/xyz789/' }, 'shared'), { id: 'xyz789' });
  assert.deepStrictEqual(routeParams({ path: '/.netlify/functions/public-shared/xyz789' }, 'shared'), { id: 'xyz789' });
});

// ── Sitemap ──────────────────────────────────────────────────────────────

// Every URL in sitemap-pages.xml must be one Google may index. Public
// profiles are noindex (USER_PAGE_ROBOTS) and were listed until 5.58.1.
test('sitemap-pages: no /u/ profile pages, and How to Use is listed', () => {
  const xml = sitemap.pagesSitemap({ artists: [] });
  assert.ok(!/\/u\//.test(xml), 'no public profile URLs');
  assert.match(xml, /<loc>https:\/\/mysetlists\.net\/how-to-use\/<\/loc>/);
});

// The static export serves every page with a trailing slash; a bare path
// is a 301, which a sitemap shouldn't list.
test('sitemap-pages: every static URL ends in a slash', () => {
  for (const { loc } of sitemap.STATIC_URLS) assert.ok(loc.endsWith('/'), loc);
});

// public/_headers denies indexing by default (/*) and allows listed paths.
// /how-to-use was missing from it for months, so a page in the sitemap
// went out with `X-Robots-Tag: noindex, nofollow`. Every static sitemap
// URL needs its own allow rule (Netlify matches `/x` for `/x/` too).
test('_headers: every static sitemap URL has an index rule', () => {
  const fs = require('fs');
  const path = require('path');
  const lines = fs.readFileSync(path.join(__dirname, '../../public/_headers'), 'utf8').split('\n');
  const rules = new Map();
  let current = null;
  for (const line of lines) {
    if (/^\//.test(line)) current = line.trim();
    else if (current && /^\s+X-Robots-Tag:/i.test(line)) rules.set(current, line.split(':')[1].trim());
  }
  assert.strictEqual(rules.get('/*'), 'noindex, nofollow', 'the default deny stays');
  for (const { loc } of sitemap.STATIC_URLS) {
    const key = loc === '/' ? '/' : loc.replace(/\/$/, '');
    assert.strictEqual(rules.get(key), 'index, follow', `${loc} needs an allow rule in public/_headers`);
  }
});

(async () => {
  let passed = 0;
  let failed = 0;
  console.log('\npublic page routing');
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${t.name}\n    ${e.stack || e.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
