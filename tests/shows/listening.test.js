/**
 * "Listen to this night" and "Where to stream this show" (5.60.32, Stage 4
 * call A): archival-audio-lookup answers the streaming list with every 200,
 * built from lib/streamingPlatforms.js and never cached, and the web hook
 * sends an ISO date whatever the stored shape.
 *
 *   node tests/shows/listening.test.js
 *
 * Relisten is stubbed at https.get; no request leaves the machine.
 */
const { test, run } = require('../email/harness');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { getStreamingPlatforms } = require('../../lib/streamingPlatforms');
const lookup = require('../../netlify/functions/archival-audio-lookup');

const ROOT = path.join(__dirname, '..', '..');

// Relisten answers each URL with route(url) → [status, body]; the requests
// are recorded.
function stubRelisten(route) {
  const urls = [];
  const original = https.get;
  https.get = (url, _opts, cb) => {
    urls.push(String(url));
    const [status, body] = route(String(url));
    const req = new EventEmitter();
    process.nextTick(() => {
      const res = new EventEmitter();
      res.statusCode = status;
      cb(res);
      res.emit('data', JSON.stringify(body));
      res.emit('end');
    });
    return req;
  };
  return { urls, restore: () => { https.get = original; } };
}

const get = (q) => lookup.handler({
  httpMethod: 'GET',
  headers: { origin: 'https://mysetlists.net', 'x-nf-client-connection-ip': '9.9.9.9' },
  queryStringParameters: q,
});

test('getStreamingPlatforms: Dead family on every service, legacy dates read as ISO, archive.org for anyone', () => {
  const dead = getStreamingPlatforms('Grateful Dead', '08-05-1977');
  assert.deepStrictEqual(dead.map((p) => p.name), ['nugs.net', 'playdead.co', 'relisten.net', 'archive.org']);
  assert.strictEqual(dead.find((p) => p.name === 'relisten.net').url, 'https://relisten.net/grateful-dead/1977/05/08');
  assert.strictEqual(dead.find((p) => p.name === 'playdead.co').url, 'https://playdead.co/1977-05-08');
  assert.deepStrictEqual(getStreamingPlatforms('Some Local Band', '2025-01-01').map((p) => p.name), ['archive.org']);
  assert.deepStrictEqual(getStreamingPlatforms('', '2025-01-01'), []);
});

test('the lookup answers `streaming` with a recording found, none found, and Relisten down', async () => {
  // An artist Relisten doesn't carry.
  let stub = stubRelisten(() => [200, [{ name: 'Phish', slug: 'phish' }]]);
  try {
    const r = await get({ artist: 'Goose', date: '2025-08-29' });
    assert.strictEqual(r.statusCode, 200);
    const body = JSON.parse(r.body);
    assert.strictEqual(body.found, false);
    assert.strictEqual(body.reason, 'artist_not_carried');
    assert.deepStrictEqual(body.streaming, getStreamingPlatforms('Goose', '2025-08-29'));
    assert.deepStrictEqual(body.streaming.map((p) => p.name), ['nugs.net', 'archive.org']);
  } finally { stub.restore(); }

  // Carried, with a recording that night.
  const sources = { sources: [{ uuid: 'u1', is_soundboard: true, source: 'SBD', links: [{ for_source: true, url: 'https://archive.org/details/x', label: 'View on archive.org' }] }] };
  stub = stubRelisten((url) => (url.includes('/shows/1977-05-08')
    ? [200, sources]
    : [200, [{ name: 'Grateful Dead', slug: 'grateful-dead' }]]));
  try {
    const body = JSON.parse((await get({ artist: 'Grateful Dead', date: '1977-05-08' })).body);
    assert.strictEqual(body.found, true, JSON.stringify(body));
    assert.strictEqual(body.recordings.length, 1);
    assert.deepStrictEqual(body.streaming.map((p) => p.name), ['nugs.net', 'playdead.co', 'relisten.net', 'archive.org']);
    assert.ok(stub.urls.some((u) => u.endsWith('/artists/grateful-dead/shows/1977-05-08')), stub.urls.join(' '));
  } finally { stub.restore(); }

  // Relisten down: still the streaming list.
  stub = stubRelisten(() => [503, {}]);
  try {
    const body = JSON.parse((await get({ artist: 'Phish', date: '2024-12-31' })).body);
    assert.strictEqual(body.found, false);
    assert.ok(body.streaming.some((p) => p.name === 'relisten.net'));
  } finally { stub.restore(); }
});

test('the legacy DD-MM-YYYY date is refused (400), so the web hook converts first', async () => {
  const r = await get({ artist: 'Grateful Dead', date: '08-05-1977' });
  assert.strictEqual(r.statusCode, 400);
  const hook = fs.readFileSync(path.join(ROOT, 'hooks', 'useArchivalAudio.js'), 'utf8');
  assert.ok(/const date = toIsoDate\(rawDate\)/.test(hook), 'useArchivalAudio sends toIsoDate(date)');
  assert.ok(hook.includes("from '@/lib/showDate'"));
});

run('listening (5.60.32)');
