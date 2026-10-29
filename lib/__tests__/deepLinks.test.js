/**
 * Unit tests for lib/deepLinks.js — which in-app route a link opened on
 * iOS lands on — and for public/.well-known/apple-app-site-association,
 * the list of paths iOS hands to the app instead of Safari.
 *
 * The AASA list is pinned to lib/navRoutes.js both ways: every screen in
 * the route table is a universal link, and every universal link is a
 * screen. A new route (or a removed one) fails here until the file says
 * the same.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/deepLinks.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { deepLinkTarget, signInLeavesRoute } from '@/lib/deepLinks';
import { routePaths } from '@/lib/navRoutes';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

const root = path.resolve(import.meta.dirname, '..', '..');

// ── Links ─────────────────────────────────────────────────────────────

test('a universal link opens its route, query and all', () => {
  assert.strictEqual(deepLinkTarget('https://mysetlists.net/shows/?show=abc123'), '/shows/?show=abc123');
  assert.strictEqual(deepLinkTarget('https://www.mysetlists.net/stats/songs'), '/stats/songs/');
  assert.strictEqual(deepLinkTarget('https://mysetlists.net/songs/?artist=goose&song=arcadia'), '/songs/?artist=goose&song=arcadia');
});

test('the custom scheme opens the same routes', () => {
  assert.strictEqual(deepLinkTarget('mysetlists://shows/?show=abc123'), '/shows/?show=abc123');
  assert.strictEqual(deepLinkTarget('mysetlists://stats/top-artists/'), '/stats/top-artists/');
  assert.strictEqual(deepLinkTarget('mysetlists://localhost/runs/?run=x'), '/runs/?run=x', 'the WebView\'s own origin');
});

test('the old path shapes netlify.toml 301s are rewritten here too', () => {
  assert.strictEqual(deepLinkTarget('https://mysetlists.net/shows/abc123'), '/shows/?show=abc123');
  assert.strictEqual(deepLinkTarget('https://mysetlists.net/shows/abc123/'), '/shows/?show=abc123');
  assert.strictEqual(deepLinkTarget('mysetlists://shows/abc123'), '/shows/?show=abc123');
  assert.strictEqual(deepLinkTarget('https://mysetlists.net/venues/red%20rocks::morrison/'), '/venues/?venue=red+rocks%3A%3Amorrison');
  assert.strictEqual(deepLinkTarget('https://mysetlists.net/venue-dashboard/k1'), '/venue-dashboard/?venue=k1');
  assert.strictEqual(deepLinkTarget('https://mysetlists.net/year-in-review/u1/2025/'), '/year-in-review/?user=u1&year=2025');
  assert.strictEqual(deepLinkTarget('https://mysetlists.net/festivals/f9'), '/festivals/?festival=f9');
  assert.strictEqual(deepLinkTarget('https://mysetlists.net/upcoming/'), '/shows/');
});

test('Spotify\'s sign-in callback is left to the playlist flow', () => {
  assert.strictEqual(deepLinkTarget('mysetlists://spotify-callback?code=x'), null);
  assert.strictEqual(deepLinkTarget('mysetlists://localhost/spotify-callback?code=x'), null);
});

test('links that are not ours, or not app screens, are not followed', () => {
  assert.strictEqual(deepLinkTarget('https://example.com/shows/?show=1'), null);
  assert.strictEqual(deepLinkTarget('http://mysetlists.net/shows/'), null, 'not https');
  assert.strictEqual(deepLinkTarget('com.googleusercontent.apps.x:/oauth2redirect'), null);
  assert.strictEqual(deepLinkTarget('https://mysetlists.net/artist/goose/'), null, 'a public web page');
  assert.strictEqual(deepLinkTarget('https://mysetlists.net/heard/goose/'), null);
  assert.strictEqual(deepLinkTarget('mysetlists://typo'), null);
  assert.strictEqual(deepLinkTarget('not a url'), null);
  assert.strictEqual(deepLinkTarget(undefined), null);
});

test('a bare link opens the app\'s home', () => {
  assert.strictEqual(deepLinkTarget('mysetlists://'), '/');
});

// ── Signing in on a deep link ─────────────────────────────────────────

test('signing in from signed out keeps the link the visitor arrived on', () => {
  // An email's /venues/?venue=… opened signed out shows the landing page
  // with the URL intact; signing in must land on the venue, not My Shows.
  assert.strictEqual(signInLeavesRoute(undefined, 'u1'), false);
});

test('a session restored on load, or the same account back, stays put', () => {
  assert.strictEqual(signInLeavesRoute('u1', 'u1'), false);
});

test('a different account goes to My Shows: the URL may name the last one\'s show', () => {
  assert.strictEqual(signInLeavesRoute('u1', 'u2'), true);
});

test('a guest signing in goes to My Shows: the URL may name a local guest show', () => {
  assert.strictEqual(signInLeavesRoute(undefined, 'u1', true), true);
});

test('signing out is not a sign-in', () => {
  assert.strictEqual(signInLeavesRoute('u1', null), false);
  assert.strictEqual(signInLeavesRoute('u1', null, true), false);
});

// ── apple-app-site-association ────────────────────────────────────────

const aasa = JSON.parse(fs.readFileSync(path.join(root, 'public/.well-known/apple-app-site-association'), 'utf8'));
const detail = aasa.applinks.details[0];
const linked = detail.components.map((c) => c['/']);

test('the AASA names this app: team and bundle id from the Xcode project', () => {
  const pbx = fs.readFileSync(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
  const team = pbx.match(/DEVELOPMENT_TEAM = (\w+);/)[1];
  const bundle = pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = ([\w.]+);/)[1];
  assert.deepStrictEqual(detail.appIDs, [`${team}.${bundle}`]);
  const entitlements = fs.readFileSync(path.join(root, 'ios/App/App/App.entitlements'), 'utf8');
  assert.ok(entitlements.includes('applinks:mysetlists.net'));
});

test('every screen in the route table is a universal link, path and children', () => {
  const screens = [...new Set(routePaths().filter((p) => p !== '/').map((p) => p.replace(/\/:[^/]+.*$/, '')))];
  screens.forEach((p) => {
    assert.ok(linked.includes(p), `${p} missing from apple-app-site-association`);
    assert.ok(linked.includes(`${p}/*`), `${p}/* missing from apple-app-site-association`);
  });
});

test('every universal link opens a screen; the web pages stay in Safari', () => {
  linked.forEach((pattern) => {
    const sample = pattern.replace('/*', '/');
    assert.ok(deepLinkTarget(`https://mysetlists.net${sample}`), `${pattern} opens nothing in the app`);
  });
  ['/', '/artist/*', '/artists', '/heard/*', '/u/*', '/shared/*', '/compare/*', '/privacy', '/terms', '/api/*', '/spotify-callback']
    .forEach((web) => assert.ok(!linked.includes(web), `${web} is a web page`));
});

test('public/_headers serves the AASA as JSON', () => {
  const headers = fs.readFileSync(path.join(root, 'public/_headers'), 'utf8');
  assert.match(headers, /\/\.well-known\/apple-app-site-association\n\s+Content-Type: application\/json/);
});

console.log(`\ndeepLinks: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
