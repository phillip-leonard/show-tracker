/**
 * enrich-artist (5.60.33): the Discogs side follows MusicBrainz's own link
 * to Discogs, so "Goose" is the American jam band on both, not the Belgian
 * electro band a Discogs name search finds first.
 *
 *   node tests/metadata/enrichArtist.test.js
 *
 * MusicBrainz and Discogs are stubbed at https.get; no request leaves the
 * machine.
 */
const { test, run } = require('../email/harness');
const assert = require('node:assert');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const enrich = require('../../netlify/functions/enrich-artist');

enrich.__test.setRetryDelay(5);

// Each URL is answered by route(url) → [status, body]; the requests are recorded.
function stub(route) {
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

const get = (name) => enrich.handler({
  httpMethod: 'GET',
  headers: { origin: 'https://mysetlists.net', 'x-nf-client-connection-ip': '9.9.9.9' },
  queryStringParameters: { name },
}).then((res) => ({ status: res.statusCode, body: JSON.parse(res.body) }));

const MB_GOOSE = 'b925a474-d245-4217-bc13-2e153d82bebb';
const mbSearch = (artists) => [200, { artists }];
const gooseLookup = (relations) => [200, {
  id: MB_GOOSE, name: 'Goose', country: 'US', 'life-span': { begin: '2014', ended: false },
  genres: [{ name: 'jam band' }], relations,
}];
const memberRel = (name, ended = false) => ({ type: 'member of band', artist: { name }, ended });
const discogsRel = (id) => ({ type: 'discogs', url: { resource: `https://www.discogs.com/artist/${id}` } });

// The American band (MusicBrainz's link) and the Belgian one (first by name).
const DISCOGS = {
  1198062: { id: 1198062, name: 'Goose (6)', profile: 'American jam rock band from Norwalk, CT.',
    members: [{ name: 'Rick Mitarotonda', active: true }, { name: 'Chris Enright (2)', active: false }] },
  408581: { id: 408581, name: 'Goose', profile: 'Goose is an electro/rock band from Kortrijk, Belgium.',
    members: [{ name: 'Tom Coghe', active: true }, { name: 'Dave Martijn', active: true }] },
};
const discogsSearch = [200, { results: [{ id: 408581, title: 'Goose' }, { id: 1198062, title: 'Goose (6)' }] }];

function route({ mbArtists, relations }) {
  return (url) => {
    if (url.includes('musicbrainz.org/ws/2/artist?')) return mbSearch(mbArtists);
    if (url.includes(`musicbrainz.org/ws/2/artist/${MB_GOOSE}`)) return gooseLookup(relations);
    if (url.includes('api.discogs.com/database/search')) return discogsSearch;
    const m = /api\.discogs\.com\/artists\/(\d+)/.exec(url);
    if (m && DISCOGS[m[1]]) return [200, DISCOGS[m[1]]];
    return [404, {}];
  };
}

test('Goose: Discogs is the artist MusicBrainz links to, never the name search', async () => {
  const s = stub(route({
    mbArtists: [{ id: MB_GOOSE, name: 'Goose' }],
    relations: [memberRel('Rick Mitarotonda'), memberRel('Peter Anspach'), memberRel('Ben Atkind', true), discogsRel(1198062)],
  }));
  try {
    const { status, body } = await get('Goose');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.discogsId, 1198062);
    assert.match(body.profile, /Norwalk/);
    assert.ok(!s.urls.some((u) => u.includes('database/search')), 'no Discogs name search');
    const names = body.members.map((m) => m.name);
    assert.ok(!names.includes('Tom Coghe') && !names.includes('Dave Martijn'), 'none of the Belgian band');
    // Discogs' "(2)" for a shared name is dropped; MusicBrainz's members come first.
    assert.deepStrictEqual(names, ['Rick Mitarotonda', 'Peter Anspach', 'Ben Atkind', 'Chris Enright']);
    assert.deepStrictEqual(body.sources, { musicbrainz: true, discogs: true });
  } finally { s.restore(); }
});

test('MusicBrainz found the artist but links to no Discogs page: no Discogs at all', async () => {
  const s = stub(route({ mbArtists: [{ id: MB_GOOSE, name: 'Goose' }], relations: [memberRel('Rick Mitarotonda')] }));
  try {
    const { body } = await get('Goose');
    assert.strictEqual(body.discogsId, null);
    assert.strictEqual(body.profile, null);
    assert.deepStrictEqual(body.sources, { musicbrainz: true, discogs: false });
    assert.ok(!s.urls.some((u) => u.includes('discogs.com')), 'Discogs not asked');
  } finally { s.restore(); }
});

test('MusicBrainz knows nothing: the Discogs name search still answers', async () => {
  const s = stub(route({ mbArtists: [] }));
  try {
    const { body } = await get('Goose');
    assert.strictEqual(body.found, true);
    assert.strictEqual(body.discogsId, 408581, 'the exact-title match, as before');
    assert.strictEqual(body.name, 'Goose');
    assert.deepStrictEqual(body.sources, { musicbrainz: false, discogs: true });
  } finally { s.restore(); }
});

test('MusicBrainz busy once: one retry, and the answer is the linked artist', async () => {
  let busy = true;
  const inner = route({ mbArtists: [{ id: MB_GOOSE, name: 'Goose' }], relations: [discogsRel(1198062)] });
  const s = stub((url) => {
    if (busy && url.includes('musicbrainz')) { busy = false; return [503, {}]; }
    return inner(url);
  });
  try {
    const { body } = await get('Goose');
    assert.strictEqual(body.discogsId, 1198062);
    assert.strictEqual(s.urls.filter((u) => u.includes('ws/2/artist?')).length, 2, 'the search, retried once');
  } finally { s.restore(); }
});

test('MusicBrainz not answering: no Discogs guess, and nothing found (so nothing cached)', async () => {
  // A name search here found the Belgian Goose, and it was cached for a week.
  const s = stub((url) => (url.includes('musicbrainz') ? [503, {}] : route({ mbArtists: [] })(url)));
  try {
    const { body } = await get('Goose');
    assert.deepStrictEqual(body, { found: false, name: 'Goose' });
    assert.ok(!s.urls.some((u) => u.includes('discogs.com')), 'Discogs not asked');
  } finally { s.restore(); }
});

test('a member both sources list is listed once, however the dash or accent is written', () => {
  const { mergeMembers } = enrich.__test;
  const merged = mergeMembers(
    [memberRel('Ambrose Kenny\u2010Smith'), memberRel('Sigur Rós Member')],
    [{ name: 'Ambrose Kenny-Smith', active: true }, { name: 'Sigur Ros Member', active: true }, { name: 'Lucas Skinner (3)', active: true }],
  );
  assert.deepStrictEqual(merged.map((m) => m.name), ['Ambrose Kenny\u2010Smith', 'Sigur Rós Member', 'Lucas Skinner']);
});

test('discogsIdFromRelations and cleanDiscogsName', () => {
  const { discogsIdFromRelations, cleanDiscogsName } = enrich.__test;
  assert.strictEqual(discogsIdFromRelations([discogsRel(1198062)]), '1198062');
  assert.strictEqual(discogsIdFromRelations([{ type: 'discogs', url: { resource: 'https://www.discogs.com/de/artist/42-Some-Band' } }]), '42');
  assert.strictEqual(discogsIdFromRelations([{ type: 'bandcamp', url: { resource: 'https://www.discogs.com/artist/9' } }]), null);
  assert.strictEqual(discogsIdFromRelations([{ type: 'discogs', url: { resource: 'https://www.discogs.com/label/9' } }]), null);
  assert.strictEqual(discogsIdFromRelations(undefined), null);
  assert.strictEqual(cleanDiscogsName('Goose (6)'), 'Goose');
  assert.strictEqual(cleanDiscogsName('Chris Enright (2)'), 'Chris Enright');
  assert.strictEqual(cleanDiscogsName('Sigur Rós'), 'Sigur Rós');
  assert.strictEqual(cleanDiscogsName('(hed) p.e.'), '(hed) p.e.');
});

run();
