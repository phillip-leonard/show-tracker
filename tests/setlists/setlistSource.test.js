/**
 * setlist-source (5.60.22, native Stage 1): the band's setlist source and
 * the re-sync control, from lib/setlistSources.js resolveSource, for the
 * native app. Public, read-only, cacheable.
 *
 *   node tests/setlists/setlistSource.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { handler } = require('../../netlify/functions/setlist-source');
const { resolveSource, SETLIST_SOURCES } = require('../../lib/setlistSources');
const { resyncOffer, setlistSourceAnswer } = require('../../lib/setlistSourceAnswer');

const get = (params, headers = {}) => handler({ httpMethod: 'GET', headers, queryStringParameters: params });
const body = (res) => JSON.parse(res.body);

test('a band with its own archive: offered, re-sync at once, "Get setlist" over a setlist.fm setlist', async () => {
  const res = await get({ artist: 'Goose', setlistSource: 'setlistfm' });
  assert.strictEqual(res.statusCode, 200);
  const b = body(res);
  assert.deepStrictEqual(b.source, {
    id: 'elgoose', label: 'El Goose', homeUrl: 'https://elgoose.net', isBandSource: true, requiresReview: false, matchedOn: 'name',
  });
  assert.deepStrictEqual(b.resync, {
    offered: true,
    action: 'resync',
    label: 'Get setlist from El Goose',
    busyLabel: 'Asking El Goose...',
    hint: "This setlist came from setlist.fm. El Goose is the band's own archive — it has segues, footnotes and jam charts. Your ratings and any songs you added are kept.",
  });
  assert.deepStrictEqual(b.stored, { id: 'setlistfm', label: 'setlist.fm', homeUrl: 'https://www.setlist.fm' });
});

test('a show already from the band source: "Re-fetch", no hint, credited to the source', async () => {
  const b = body(await get({ artist: 'Goose', setlistSource: 'elgoose' }));
  assert.strictEqual(b.resync.label, 'Re-fetch from El Goose');
  assert.strictEqual(b.resync.hint, null);
  assert.strictEqual(b.stored.label, 'El Goose');
});

test('no setlistSource means setlist.fm (shows from before 5.33.0), and no `stored`', async () => {
  const b = body(await get({ artist: 'Phish' }));
  assert.strictEqual(b.source.id, 'phishnet');
  assert.strictEqual(b.resync.label, 'Get setlist from Phish.net');
  assert.ok(!('stored' in b));
});

test('the Internet Archive needs review: action "review", its own hint', async () => {
  const b = body(await get({ artist: 'Grateful Dead' }));
  assert.strictEqual(b.source.id, 'archive');
  assert.strictEqual(b.source.requiresReview, true);
  assert.strictEqual(b.resync.action, 'review');
  assert.strictEqual(b.resync.label, 'Get setlist from Internet Archive');
  assert.ok(b.resync.hint.startsWith('Reads the setlist from fan recordings'));
  const sourced = body(await get({ artist: 'Grateful Dead', setlistSource: 'archive' }));
  assert.strictEqual(sourced.resync.label, 'Re-fetch from Internet Archive');
  assert.strictEqual(sourced.resync.hint, null);
});

test('a band setlist.fm covers: nothing offered', async () => {
  const b = body(await get({ artist: 'Radiohead', setlistSource: 'setlistfm' }));
  assert.strictEqual(b.source.isBandSource, false);
  assert.strictEqual(b.source.id, 'setlistfm');
  assert.deepStrictEqual(b.resync, { offered: false, action: null, label: null, busyLabel: null, hint: null });
});

test('the loose name match is reported as such ("Goose (US)")', async () => {
  const b = body(await get({ artist: 'Goose (US)' }));
  assert.strictEqual(b.source.id, 'elgoose');
  assert.strictEqual(b.source.matchedOn, 'name-loose');
});

test('a stored source id the registry no longer lists is still credited (setlist.fm fallback, never a crash)', async () => {
  const b = body(await get({ artist: 'Radiohead', setlistSource: 'retired-source' }));
  assert.deepStrictEqual(b.stored, { id: 'retired-source', label: 'setlist.fm', homeUrl: 'https://www.setlist.fm' });
});

test('every band the registry knows resolves through the function exactly as resolveSource does (no second list)', async () => {
  const sources = Object.values(SETLIST_SOURCES);
  assert.ok(sources.length >= 2, 'the registry has band sources');
  for (const source of sources) {
    for (const key of source.nameKeys) {
      const b = body(await get({ artist: key }));
      const direct = resolveSource(key);
      assert.strictEqual(b.source.id, direct.id, key);
      assert.strictEqual(b.source.requiresReview, !!direct.requiresReview, key);
      assert.strictEqual(b.resync.offered, direct.isBandSource, key);
    }
  }
});

test('the mbid is passed to resolveSource', async () => {
  const withMbid = Object.values(SETLIST_SOURCES).find((s) => s.mbids.length);
  if (!withMbid) return; // no source lists an mbid today
  const b = body(await get({ artist: 'A name no source has', mbid: withMbid.mbids[0] }));
  assert.strictEqual(b.source.id, withMbid.id);
  assert.strictEqual(b.source.matchedOn, 'mbid');
});

test('public and cacheable: no sign-in needed, Cache-Control public, CORS for the apps', async () => {
  const res = await get({ artist: 'Goose' }, { origin: 'capacitor://localhost' });
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.headers['Cache-Control'], /^public, max-age=3600, s-maxage=3600/);
  assert.strictEqual(res.headers['Access-Control-Allow-Origin'], 'capacitor://localhost');
  const other = await get({ artist: 'Goose' }, { origin: 'https://example.com' });
  assert.ok(!('Access-Control-Allow-Origin' in other.headers));
});

test('bad requests: 400, not cached', async () => {
  for (const params of [{}, { artist: '   ' }, { artist: 'x'.repeat(201) }, { artist: 'Goose', mbid: 'not an mbid!' }, { artist: 'Goose', setlistSource: 'a b' }]) {
    const res = await get(params);
    assert.strictEqual(res.statusCode, 400, JSON.stringify(params));
    assert.strictEqual(body(res).ok, false);
    assert.strictEqual(res.headers['Cache-Control'], 'no-store');
  }
  const ok = await get({ artist: '  Goose  ' });
  assert.strictEqual(body(ok).artist, 'Goose', 'trimmed');
});

test('GET only; OPTIONS answers the preflight', async () => {
  assert.strictEqual((await handler({ httpMethod: 'POST', headers: {}, body: '{}' })).statusCode, 405);
  assert.strictEqual((await handler({ httpMethod: 'OPTIONS', headers: {} })).statusCode, 204);
});

test('the wording is the web show page\'s (components/shows/ShowDetailView.jsx), so the two apps say the same thing', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../components/shows/ShowDetailView.jsx'), 'utf8')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ');
  const goose = setlistSourceAnswer({ artist: 'Goose' }).resync;
  const dead = setlistSourceAnswer({ artist: 'Grateful Dead' }).resync;
  // The page interpolates the label where the answer has it filled in.
  assert.ok(page.includes(goose.hint.replace('El Goose', '{artistSource.label}')), 'the setlist.fm hint');
  assert.ok(page.includes(dead.hint), 'the Internet Archive hint');
  assert.ok(page.includes('`Re-fetch from ${artistSource.label}`'));
  assert.ok(page.includes('`Get setlist from ${artistSource.label}`'));
  assert.ok(page.includes('`Asking ${artistSource.label}...`'));
});

test('resyncOffer is safe with no source', () => {
  assert.strictEqual(resyncOffer(null).offered, false);
});

run('setlist-source (5.60.22)');
