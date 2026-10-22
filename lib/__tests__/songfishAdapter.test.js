/**
 * Unit tests for the Songfish registry as /api/band-setlist applies it:
 * which sites the function will call, which artist a request means, and
 * that a disabled site or an unmapped artist never produces a request.
 *
 * Every outbound https request is recorded by a stub, so "never called" is
 * checked against what the function actually tried to send.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/songfishAdapter.test.js
 */

import assert from 'node:assert';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { artistNameKey, artistNameKeyLoose } from '@/lib/setlistSources';

const require = createRequire(import.meta.url);
const https = require('https');

// Recorded requests, answered from `responses` keyed by hostname.
const requests = [];
let responses = {};
https.request = (options, cb) => {
  requests.push(`${options.hostname}${options.path}`);
  const req = new EventEmitter();
  req.setTimeout = () => {};
  req.destroy = () => {};
  req.end = () => setImmediate(() => {
    const res = new EventEmitter();
    res.statusCode = 200;
    cb(res);
    res.emit('data', JSON.stringify(responses[options.hostname] || { error: 0, error_message: '', data: [] }));
    res.emit('end');
  });
  return req;
};

for (const k of ['FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PROJECT_ID']) delete process.env[k];

const songfishSites = require('../../netlify/functions/lib/songfishSites.js');
const bandSetlist = require('../../netlify/functions/band-setlist.js');
const fx = require('./fixtures/bandSetlistFixtures.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  requests.length = 0;
  responses = {};
  try {
    await fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

const call = async (qs) => {
  const res = await bandSetlist.handler({ httpMethod: 'GET', queryStringParameters: qs });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

// ── Which sites ───────────────────────────────────────────────────────

await test('only enabled sites come out of songfishSites', () => {
  assert.deepStrictEqual(songfishSites.enabledSites().map((s) => s.id), ['elgoose']);
  assert.strictEqual(songfishSites.siteById('ttbase'), null);
  assert.strictEqual(songfishSites.siteById('elgoose').hostname, 'elgoose.net');
  assert.strictEqual(songfishSites.siteById('elgoose').permalinkBase, 'https://elgoose.net/setlists/');
});

await test('a disabled site is an unknown source, and nothing is sent to it', async () => {
  for (const site of songfishSites.SITES.filter((s) => !s.enabled)) {
    const { status } = await call({ source: site.id, artist: site.artists[0].name, date: '2024-02-29', artistId: '1' });
    assert.strictEqual(status, 400, `${site.id} must be refused`);
  }
  assert.deepStrictEqual(requests, [], 'no request may leave for a disabled site');
});

await test('an inherited property name is not a source', async () => {
  const { status } = await call({ source: 'constructor', artist: 'Goose', date: '2024-10-24' });
  assert.strictEqual(status, 400);
});

// ── Which artist ──────────────────────────────────────────────────────

await test('an artist the site does not map gets ok:false without a request', async () => {
  const { status, body } = await call({ source: 'elgoose', artist: 'Orebolo', date: '2024-02-08' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.deepStrictEqual(requests, []);
});

await test("an installed client's artistId=goose still resolves to artist_id 1", () => {
  const site = songfishSites.siteById('elgoose');
  assert.strictEqual(songfishSites.artistIdFor(site, { artist: 'Goose', artistId: 'goose' }), 1);
  assert.strictEqual(songfishSites.artistIdFor(site, { artist: 'Goose', artistId: '1' }), 1);
  assert.strictEqual(songfishSites.artistIdFor(site, { artist: 'Goose (US)' }), 1);
  assert.strictEqual(songfishSites.artistIdFor(site, { artist: 'Goose', artistId: '8' }), 1, 'an id the site does not map falls back to the name');
  assert.strictEqual(songfishSites.artistIdFor(site, { artist: 'Mother Goose' }), null);
});

await test("the server's name keys match the client's", () => {
  ['Goose', '  Goose  ', 'Goose (US)', 'The Goose', 'King Gizzard & the Lizard Wizard', "Umphrey's McGee", 'Dogs in a Pile', 'moe.']
    .forEach((name) => {
      assert.strictEqual(songfishSites.artistNameKey(name), artistNameKey(name), `exact key for ${name}`);
      assert.strictEqual(songfishSites.artistNameKeyLoose(name), artistNameKeyLoose(name), `loose key for ${name}`);
    });
});

// ── End to end through the handler ────────────────────────────────────

await test('a Goose date asks elgoose.net once and returns the encore as Encore', async () => {
  responses['elgoose.net'] = fx.ELGOOSE_REAL_ENCORE;
  const { body } = await call({ source: 'elgoose', artist: 'Goose', date: '2024-10-24', artistId: '1' });
  assert.deepStrictEqual(requests, ['elgoose.net/api/v2/setlists/showdate/2024-10-24.json']);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.songs[body.songs.length - 1].set, 'Encore');
});

await test('a date only another act played returns no songs, not their setlist', async () => {
  responses['elgoose.net'] = {
    error: false,
    error_message: '',
    data: fx.ELGOOSE_REAL_ENCORE.data.map((r) => ({ ...r, artist: 'Orebolo', artist_id: 8 })),
  };
  const { body } = await call({ source: 'elgoose', artist: 'Goose', date: '2024-02-08', artistId: '1' });
  assert.strictEqual(body.ok, true);
  assert.deepStrictEqual(body.songs, []);
});

// ── Summary ─────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
