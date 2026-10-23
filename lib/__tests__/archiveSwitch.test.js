/**
 * The Internet Archive switch — config/internet-archive.json's `enabled`.
 *
 * Turned off, nothing may send the Archive a request: not the registry
 * (so new adds keep setlist.fm's setlist), not /api/band-setlist (which is
 * what app builds already installed call), not the adapter whoever calls
 * it, and not the admin re-sync. A setlist already saved from the Archive
 * keeps its attribution.
 *
 * No network: https.request is replaced with one that fails the test if
 * anything calls it while the switch is off.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/archiveSwitch.test.js
 */

import assert from 'assert';
import { createRequire } from 'module';
import {
  SETLIST_SOURCES, SETLISTFM_SOURCE_ID, archiveSourceFrom, resolveSource, sourceHomeUrl, sourceLabel,
} from '@/lib/setlistSources';
import internetArchive from '@/config/internet-archive.json';

const require = createRequire(import.meta.url);
const https = require('https');
const archiveAdapter = require('../../netlify/functions/lib/archiveAdapter.js');
const bandSetlist = require('../../netlify/functions/band-setlist.js');
const adminResync = require('../../netlify/functions/admin-resync-setlists.js');
// The same object the adapter and band-setlist.js read, so flipping it here
// is flipping the switch for them.
const serverConfig = require('../../config/internet-archive.json');

let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

let requestsSent = 0;
const realRequest = https.request;
function blockNetwork() {
  requestsSent = 0;
  https.request = () => {
    requestsSent++;
    throw new Error('the Archive was asked while the switch was off');
  };
}
function restoreNetwork() { https.request = realRequest; }

const off = { ...internetArchive, enabled: false };

// ── The registry ──────────────────────────────────────────────────────

test('the shipped config has the Archive on, and the registry follows it', () => {
  assert.strictEqual(internetArchive.enabled, true);
  assert.ok(SETLIST_SOURCES.archive, 'archive is in SETLIST_SOURCES');
  assert.strictEqual(resolveSource('Grateful Dead').id, 'archive');
});

test('switched off, there is no archive source to resolve to', () => {
  assert.strictEqual(archiveSourceFrom(off), null);
  assert.strictEqual(archiveSourceFrom({ ...internetArchive, enabled: 'yes' }), null, 'only literal true turns it on');
});

test('switched off, Grateful Dead resolves to setlist.fm, by name and by mbid', () => {
  const { archive, ...withoutArchive } = SETLIST_SOURCES;
  assert.ok(archive);
  assert.strictEqual(resolveSource('Grateful Dead', withoutArchive).id, SETLISTFM_SOURCE_ID);
  const mbid = internetArchive.artists[0].mbids[0];
  assert.strictEqual(resolveSource({ name: 'Grateful Dead', mbid }, withoutArchive).id, SETLISTFM_SOURCE_ID);
  assert.strictEqual(resolveSource('Grateful Dead', withoutArchive).isBandSource, false);
});

test('a setlist already saved from the Archive keeps crediting the Archive', () => {
  assert.strictEqual(sourceLabel('archive'), 'Internet Archive');
  assert.strictEqual(sourceHomeUrl('archive'), internetArchive.homeUrl);
});

// ── The server ────────────────────────────────────────────────────────

test('switched off, the adapter returns nothing and sends no request', async () => {
  blockNetwork();
  try {
    const r = await archiveAdapter.fetchSetlists('1977-05-08', { config: off });
    assert.strictEqual(r.disabled, true);
    assert.deepStrictEqual(r.shows, []);
    assert.strictEqual(requestsSent, 0);
  } finally { restoreNetwork(); }
});

test('switched off, /api/band-setlist answers "no show" for source=archive without a request', async () => {
  blockNetwork();
  serverConfig.enabled = false;
  try {
    const res = await bandSetlist.handler({
      httpMethod: 'GET',
      queryStringParameters: { source: 'archive', artist: 'Grateful Dead', date: '1977-05-08', artistId: 'GratefulDead' },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.disabled, true);
    assert.deepStrictEqual(body.songs, []);
    assert.strictEqual(requestsSent, 0);
  } finally {
    serverConfig.enabled = true;
    restoreNetwork();
  }
});

test('switched off, the admin re-sync does not treat Grateful Dead as a band source', () => {
  assert.strictEqual(adminResync.resolveBandSource('Grateful Dead', adminResync.bandSourceNameKeys(false)), null);
  assert.strictEqual(adminResync.resolveBandSource('Grateful Dead', adminResync.bandSourceNameKeys(true)).source, 'archive');
  // The default reads the switch at call time.
  serverConfig.enabled = false;
  try {
    assert.strictEqual(adminResync.resolveBandSource('Grateful Dead'), null);
    assert.strictEqual(adminResync.resolveBandSource('Goose').source, 'elgoose', 'other sources are untouched');
  } finally { serverConfig.enabled = true; }
});

test('an excluded date (Dylan & the Dead) is "no show" without a request, and not cached', async () => {
  blockNetwork();
  try {
    const r = await archiveAdapter.fetchSetlists('1987-07-10', {});
    assert.strictEqual(r.excluded, true);
    assert.deepStrictEqual(r.shows, []);
    assert.match(r.message, /Dylan/);
    assert.strictEqual(requestsSent, 0);
  } finally { restoreNetwork(); }
});

for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

console.log(`\narchiveSwitch: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
