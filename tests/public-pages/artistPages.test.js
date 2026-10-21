#!/usr/bin/env node
/**
 * Public band and song pages: the snapshot job, the pages, the JSON API and
 * the artist sitemap, against an in-memory store with the sources stubbed.
 *
 *   node tests/public-pages/artistPages.test.js
 *
 * What matters most here is the snapshot job's promises: a failed or
 * partial fetch never replaces the last good snapshot, a second run with
 * nothing new writes no artist data, Phish is skipped without a key and
 * goes "temporarily unavailable" once its data is 24 hours old, and the
 * HTML and the JSON come from the same snapshot.
 */

const assert = require('node:assert');
const sources = require('../../netlify/functions/lib/publicArtistSources');
const snap = require('../../netlify/functions/lib/publicArtistSnapshot');
const pages = require('../../netlify/functions/lib/publicArtistPages');
const { routeParams } = require('../../netlify/functions/lib/publicRouteParams');
const { artistUrls, whichDocument } = require('../../netlify/functions/sitemap');
const elgoose = require('../../netlify/functions/lib/elgooseAdapter');
const phishnet = require('../../netlify/functions/lib/phishnetAdapter');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-10-20T12:00:00Z');
const quiet = { warn() {}, error() {}, log() {} };

function memoryStore() {
  const data = new Map();
  const writes = [];
  return {
    data,
    writes,
    async get(key) { return data.has(key) ? JSON.parse(data.get(key)) : null; },
    async set(key, value) { writes.push(key); data.set(key, JSON.stringify(value)); },
    async delete(key) { data.delete(key); },
  };
}

// A few years of a made-up band, as normalized shows.
function show(id, date, titles) {
  return {
    id, date, order: 1, venue: `Venue ${id}`, city: 'Denver', state: 'CO', country: 'USA',
    url: `https://elgoose.net/setlists/${id}.html`,
    songs: titles.map((t) => ({ key: `sf:${t}`, slug: t.toLowerCase().replace(/\s+/g, '-'), name: t, original: true, originalArtist: '', sourceUrl: '' })),
  };
}

function yearsFixture() {
  const byYear = {};
  let n = 0;
  for (let y = 2014; y <= 2026; y++) {
    byYear[y] = [];
    for (let i = 0; i < 6; i++) {
      n++;
      const titles = ['Arcadia', 'Hot Tea', i % 2 ? 'Madhuvan' : 'Tumble', n % 7 === 0 ? 'Rockdale' : 'So Ready'];
      byYear[y].push(show(`s${n}`, `${y}-0${(i % 9) + 1}-1${i}`, titles));
    }
  }
  return byYear;
}

// Swap the source fetchers for fixtures; returns a restore function.
function stubSources({ songfish, phishnet: pn, setlistfm } = {}) {
  const saved = { ...sources };
  if (songfish) sources.fetchSongfishYear = async (artist, year) => songfish(artist, year);
  if (pn) sources.fetchPhishnetYear = async (artist, year) => pn(artist, year);
  if (setlistfm) sources.fetchSetlistfmPage = async (artist, page) => setlistfm(artist, page);
  return () => Object.assign(sources, saved);
}

async function seededGoose(store, opts = {}) {
  const years = yearsFixture();
  const restore = stubSources({ songfish: (_a, y) => years[y] || [] });
  try {
    return await snap.runSnapshot({ store, only: ['goose'], force: 'full', now: () => opts.now || NOW, log: quiet });
  } finally { restore(); }
}

// ── Routing ──────────────────────────────────────────────────────────────

test('artist and song slugs come from the public URL or the function URL', () => {
  assert.deepStrictEqual(routeParams({ path: '/artist/goose/' }, 'artist'), { slug: 'goose' });
  assert.deepStrictEqual(routeParams({ path: '/.netlify/functions/public-artist/goose' }, 'artist'), { slug: 'goose' });
  assert.deepStrictEqual(routeParams({ path: '/artist/goose/song/arcadia/' }, 'song'), { slug: 'goose', song: 'arcadia' });
  assert.deepStrictEqual(routeParams({ path: '/.netlify/functions/public-artist-song/goose/arcadia' }, 'song'), { slug: 'goose', song: 'arcadia' });
  // A song URL is not a band URL.
  assert.deepStrictEqual(routeParams({ path: '/artist/goose/song/arcadia/' }, 'artist'), { slug: '' });
});

test('the sitemap function serves the index, pages and artists documents', () => {
  assert.strictEqual(whichDocument({ path: '/.netlify/functions/sitemap' }), 'index');
  assert.strictEqual(whichDocument({ path: '/sitemap.xml' }), 'index');
  assert.strictEqual(whichDocument({ path: '/.netlify/functions/sitemap/pages' }), 'pages');
  assert.strictEqual(whichDocument({ path: '/sitemap-artists.xml' }), 'artists');
});

// ── Config ───────────────────────────────────────────────────────────────

test('config slugs are unique, lowercase and hyphenated, and every source has what it needs', () => {
  const artists = snap.publicArtists();
  const slugs = artists.map((a) => a.slug);
  assert.strictEqual(new Set(slugs).size, slugs.length);
  for (const a of artists) {
    assert.match(a.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, a.slug);
    if (a.source === 'songfish') assert.ok(a.host && a.artistId && a.firstYear, a.slug);
    else if (a.source === 'phishnet') assert.ok(a.artistSlug && a.firstYear, a.slug);
    else if (a.source === 'setlistfm') { assert.match(a.mbid, /^[0-9a-f-]{36}$/, a.slug); assert.strictEqual(a.songPages, false, a.slug); }
    else assert.fail(`unknown source ${a.source}`);
  }
  assert.strictEqual(artists.filter((a) => a.featured).length, 8);
});

// ── Source normalization ─────────────────────────────────────────────────

test('Songfish rows: other acts dropped, soundcheck lists kept, entities decoded', () => {
  const artist = { host: 'allthings.umphreys.com', artistId: 1 };
  const row = (o) => ({ show_id: 10, showdate: '2000-10-31', showorder: 1, venuename: 'Martyrs&#039;', city: 'Chicago', state: 'IL', country: 'USA', permalink: 'um-2000.html', settype: 'Set', song_id: 1, songname: 'Example 1', slug: 'example-1', isoriginal: 1, artist_id: 1, soundcheck: 'Rosanna', ...o });
  const shows = sources.songfishShowsFromRows([
    row({}),
    row({ song_id: 2, songname: 'Jimmy Stewart', slug: 'jimmy-stewart' }),
    row({ song_id: 3, songname: 'Soundcheck Jam', settype: 'Soundcheck' }),
    row({ show_id: 11, artist_id: 2, songname: 'Side project' }),
  ], artist);
  assert.strictEqual(shows.length, 1);
  assert.strictEqual(shows[0].venue, "Martyrs'");
  assert.strictEqual(shows[0].url, 'https://allthings.umphreys.com/setlists/um-2000.html');
  assert.deepStrictEqual(shows[0].songs.map((s) => s.name), ['Example 1', 'Jimmy Stewart']);
  assert.strictEqual(shows[0].songs[0].sourceUrl, 'https://allthings.umphreys.com/song/example-1');
});

test('phish.net rows: Phish only, soundcheck set dropped, covers flagged', () => {
  const row = (o) => ({ showid: 1, showdate: '1997-11-22', venue: 'Hampton Coliseum', city: 'Hampton', state: 'VA', country: 'USA', permalink: 'https://phish.net/setlists/x.html', set: '1', songid: 5, song: "Mike's Song", slug: 'mikes-song', is_original: 1, artist_slug: 'phish', ...o });
  const shows = sources.phishnetShowsFromRows([
    row({}),
    row({ songid: 6, song: 'Sabotage', slug: 'sabotage', is_original: 0, set: 'e' }),
    row({ songid: 7, song: 'Soundcheck tune', set: 'soundcheck' }),
    row({ showid: 2, artist_slug: 'trey-anastasio-band' }),
  ], { artistSlug: 'phish' });
  assert.strictEqual(shows.length, 1);
  assert.deepStrictEqual(shows[0].songs.map((s) => [s.name, s.original]), [["Mike's Song", true], ['Sabotage', false]]);
});

test('an error code other than 1 is a failure, not an empty result', () => {
  // phish.net's actual answer to a bad key.
  assert.strictEqual(phishnet.readEnvelope({ error: 2, error_message: 'Invalid API Key', data: [] }).ok, false);
  assert.strictEqual(elgoose.readEnvelope({ error: 2, error_message: 'nope', data: [] }).ok, false);
  assert.strictEqual(phishnet.readEnvelope({ error: false, error_message: '', data: [] }).ok, true);
  assert.strictEqual(elgoose.readEnvelope({ error: false, error_message: '', data: [] }).ok, true);
});

test('the requester spaces calls, retries a 429 and counts both', async () => {
  let t = 0;
  const slept = [];
  const ctx = sources.createRequester({ sleep: async (ms) => { slept.push(ms); t += ms; }, now: () => t });
  let n = 0;
  const res = await ctx.request('setlistfm', async () => (++n === 1 ? { statusCode: 429 } : { statusCode: 200, data: 1 }));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(ctx.calls.setlistfm, 2);
  assert.strictEqual(ctx.retries.setlistfm, 1);
  await ctx.request('setlistfm', async () => ({ statusCode: 200 }));
  assert.ok(slept.every((ms) => ms > 0));
});

// ── The snapshot job ─────────────────────────────────────────────────────

test('a run publishes an artist snapshot, the index and a run report', async () => {
  const store = memoryStore();
  const report = await seededGoose(store);
  assert.strictEqual(report.artists[0].status, 'updated');
  const index = await snap.loadIndex(store);
  const entry = index.artists.find((e) => e.slug === 'goose');
  assert.strictEqual(entry.fetchedAt, new Date(NOW).toISOString());
  assert.strictEqual(entry.totalShows, 13 * 6);
  const loaded = await snap.loadArtist(store, 'goose');
  assert.strictEqual(loaded.snapshot.band.mostPlayed[0].name, 'Arcadia');
  assert.ok(loaded.snapshot.songs.find((s) => s.slug === 'arcadia'));
  assert.ok(await store.get('runs/latest.json'));
});

test('a second run with nothing new rewrites no artist data and yields identical data', async () => {
  const store = memoryStore();
  await seededGoose(store);
  const before = store.data.get('artists/goose.json');
  store.writes.length = 0;
  const years = yearsFixture();
  const restore = stubSources({ songfish: (_a, y) => years[y] || [] });
  try {
    const report = await snap.runSnapshot({ store, only: ['goose'], force: true, now: () => NOW + HOUR, log: quiet });
    assert.strictEqual(report.artists[0].status, 'unchanged');
    // Only the incremental years were asked for.
    assert.strictEqual(report.artists[0].full, false);
  } finally { restore(); }
  assert.strictEqual(store.data.get('artists/goose.json'), before);
  assert.ok(!store.writes.includes('artists/goose.json'));
  assert.ok(!store.writes.includes('raw/goose.json'));
  // fetchedAt still moves, in the index, so freshness is tracked.
  const entry = (await snap.loadIndex(store)).artists.find((e) => e.slug === 'goose');
  assert.strictEqual(entry.fetchedAt, new Date(NOW + HOUR).toISOString());
});

test('a failed fetch keeps the last good snapshot and records the error', async () => {
  const store = memoryStore();
  await seededGoose(store);
  const before = store.data.get('artists/goose.json');
  const restore = stubSources({ songfish: () => { throw new sources.SourceError('elgoose.net returned HTTP 502'); } });
  try {
    const report = await snap.runSnapshot({ store, only: ['goose'], force: 'full', now: () => NOW + HOUR, log: quiet });
    assert.strictEqual(report.artists[0].status, 'failed');
  } finally { restore(); }
  assert.strictEqual(store.data.get('artists/goose.json'), before);
  const entry = (await snap.loadIndex(store)).artists.find((e) => e.slug === 'goose');
  assert.match(entry.lastError, /502/);
  assert.strictEqual(entry.fetchedAt, new Date(NOW).toISOString(), 'fetchedAt stays at the last good fetch');
});

test('a fetch that comes back with far fewer shows is treated as partial', async () => {
  const store = memoryStore();
  await seededGoose(store);
  const before = store.data.get('artists/goose.json');
  const years = yearsFixture();
  const restore = stubSources({ songfish: (_a, y) => (y < 2024 ? [] : years[y]) });
  try {
    const report = await snap.runSnapshot({ store, only: ['goose'], force: 'full', now: () => NOW + HOUR, log: quiet });
    assert.strictEqual(report.artists[0].status, 'failed');
    assert.match(report.artists[0].error, /partial/);
  } finally { restore(); }
  assert.strictEqual(store.data.get('artists/goose.json'), before);
});

test('an empty first fetch publishes nothing', async () => {
  const store = memoryStore();
  const restore = stubSources({ songfish: () => [] });
  try {
    const report = await snap.runSnapshot({ store, only: ['goose'], force: 'full', now: () => NOW, log: quiet });
    assert.strictEqual(report.artists[0].status, 'failed');
  } finally { restore(); }
  assert.strictEqual(await store.get('artists/goose.json'), null);
  assert.strictEqual(await snap.loadArtist(store, 'goose'), null);
});

test('Phish is skipped without PHISHNET_API_KEY', async () => {
  const store = memoryStore();
  let called = false;
  const restore = stubSources({ phishnet: () => { called = true; return []; } });
  try {
    const report = await snap.runSnapshot({ store, only: ['phish'], env: {}, now: () => NOW, log: quiet });
    assert.strictEqual(report.artists[0].status, 'skipped-no-key');
  } finally { restore(); }
  assert.strictEqual(called, false);
});

test('only due artists run: Phish every 6 hours, everyone else daily', () => {
  const at = (h) => ({ fetchedAt: new Date(NOW - h * HOUR).toISOString() });
  const phish = snap.findArtist('phish');
  const goose = snap.findArtist('goose');
  assert.strictEqual(snap.isDue(at(5.5), phish, NOW, false), true);
  assert.strictEqual(snap.isDue(at(4), phish, NOW, false), false);
  assert.strictEqual(snap.isDue(at(6), goose, NOW, false), false);
  assert.strictEqual(snap.isDue(at(23.5), goose, NOW, false), true);
  assert.strictEqual(snap.isDue(at(1), goose, NOW, true), true);
});

test('setlist.fm: a window of recent setlists, the total from the API, upcoming dates left out', async () => {
  const store = memoryStore();
  const page1 = [
    { ...show('f0', '2026-11-01', []), lastUpdated: 'a' }, // upcoming, no setlist yet
    ...Array.from({ length: 19 }, (_, i) => ({ ...show(`f${i + 1}`, `2026-0${(i % 9) + 1}-0${(i % 8) + 1}`, ['Chilly Water', 'Porch Song', i % 3 ? 'Ain’t Life Grand' : 'Space Wrangler', 'Tall Boy', 'Climb to Safety']), lastUpdated: 'a' })),
  ];
  const restore = stubSources({
    setlistfm: (_a, page) => ({ total: 400, itemsPerPage: 20, setlists: page === 1 ? page1 : page === 20 ? [{ ...show('old', '1986-02-01', []), lastUpdated: 'a' }] : [], artistUrl: 'https://www.setlist.fm/setlists/widespread-panic-bd6bd12.html' }),
  });
  try {
    const report = await snap.runSnapshot({ store, only: ['widespread-panic'], env: { SETLISTFM_API_KEY: 'test' }, force: 'full', now: () => NOW, log: quiet });
    assert.strictEqual(report.artists[0].status, 'updated', report.artists[0].error);
  } finally { restore(); }
  const { snapshot } = await snap.loadArtist(store, 'widespread-panic');
  assert.strictEqual(snapshot.band.totalShows, 399);
  assert.strictEqual(snapshot.band.firstShow.date, '1986-02-01');
  assert.strictEqual(snapshot.coverage.kind, 'window');
  assert.strictEqual(snapshot.coverage.shows, 19);
  assert.strictEqual(snapshot.songs.length, 0, 'no song pages for setlist.fm bands');
  assert.ok(snapshot.band.mostPlayed.every((s) => s.hasPage === false));
  assert.strictEqual(snapshot.attribution.url, 'https://www.setlist.fm/setlists/widespread-panic-bd6bd12.html');
});

// ── Freshness and caching ────────────────────────────────────────────────

test('phish.net data is unavailable past 24 hours; nobody else expires', () => {
  const entry = (h, source = 'phishnet') => ({ source, fetchedAt: new Date(NOW - h * HOUR).toISOString() });
  assert.strictEqual(snap.availability(entry(23), NOW).available, true);
  assert.strictEqual(snap.availability(entry(24.01), NOW).available, false);
  assert.strictEqual(snap.availability(entry(500, 'songfish'), NOW).available, true);
});

test('cache headers: the standard rule, cut short so phish.net data is never served past 24 hours', () => {
  const standard = snap.cacheHeaders({ source: 'songfish', fetchedAt: new Date(NOW).toISOString() }, NOW)['Cache-Control'];
  assert.strictEqual(standard, 'public, s-maxage=3600, stale-while-revalidate=86400');
  const phish = snap.cacheHeaders({ source: 'phishnet', fetchedAt: new Date(NOW - 20 * HOUR).toISOString() }, NOW)['Cache-Control'];
  const [, sMax, swr] = phish.match(/s-maxage=(\d+), stale-while-revalidate=(\d+)/).map(Number);
  assert.ok(20 * 3600 + sMax + swr <= 24 * 3600, phish);
});

// ── Pages and JSON ───────────────────────────────────────────────────────

test('band page: 200, title, canonical, MusicGroup and breadcrumb JSON-LD, attribution, song links', async () => {
  const store = memoryStore();
  await seededGoose(store);
  const res = pages.renderBand(await snap.loadArtist(store, 'goose'), NOW);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['Cache-Control'], 'public, s-maxage=3600, stale-while-revalidate=86400');
  assert.match(res.body, /<title>Goose Setlists, Song Stats &amp; Gaps \| MySetlists<\/title>/);
  assert.match(res.body, /<link rel="canonical" href="https:\/\/mysetlists.net\/artist\/goose\/">/);
  assert.match(res.body, /<h1>Goose setlists, song stats &amp; show tracker<\/h1>/);
  assert.match(res.body, /"@type":"MusicGroup"/);
  assert.match(res.body, /"@type":"BreadcrumbList"/);
  assert.match(res.body, /Setlist data from elgoose.net/);
  assert.match(res.body, /href="https:\/\/mysetlists.net\/artist\/goose\/song\/arcadia\/"/);
  assert.match(res.body, /og:image" content="https:\/\/mysetlists.net\/og-image.png"/);
});

test('song page: 200 with stats; unknown song is a 404', async () => {
  const store = memoryStore();
  await seededGoose(store);
  const loaded = await snap.loadArtist(store, 'goose');
  const res = pages.renderSong(loaded, 'arcadia', NOW);
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.body, /<title>Arcadia – Goose Song Stats, Gap &amp; Last Played \| MySetlists<\/title>/);
  assert.match(res.body, /<h1>Arcadia by Goose: times played, last played &amp; gap<\/h1>/);
  assert.match(res.body, /How many times have you heard Arcadia\?/);
  assert.strictEqual(pages.renderSong(loaded, 'not-a-song', NOW).statusCode, 404);
});

test('an unknown or unpublished slug loads nothing (the handlers 404 on that)', async () => {
  const store = memoryStore();
  await seededGoose(store);
  assert.strictEqual(await snap.loadArtist(store, 'not-a-band'), null);
  assert.strictEqual(await snap.loadArtist(store, 'umphreys-mcgee'), null, 'configured but never fetched');
  assert.strictEqual(pages.artistJson(null, NOW).statusCode, 404);
});

test('stale Phish: pages and JSON answer 503 "temporarily unavailable"', async () => {
  const store = memoryStore();
  const years = yearsFixture();
  const restore = stubSources({ phishnet: (_a, y) => years[y] || [] });
  try {
    await snap.runSnapshot({ store, only: ['phish'], env: { PHISHNET_API_KEY: 'test' }, force: 'full', now: () => NOW, log: quiet });
  } finally { restore(); }
  const loaded = await snap.loadArtist(store, 'phish');
  assert.strictEqual(pages.renderBand(loaded, NOW + HOUR).statusCode, 200);
  const later = NOW + 25 * HOUR;
  const band = pages.renderBand(loaded, later);
  assert.strictEqual(band.statusCode, 503);
  assert.match(band.body, /temporarily unavailable/);
  assert.strictEqual(pages.renderSong(loaded, 'arcadia', later).statusCode, 503);
  assert.strictEqual(pages.artistJson(loaded, later).statusCode, 503);
  assert.strictEqual(pages.renderIndex(await snap.loadIndex(store), later).body.includes('/artist/phish/'), false);
});

test('JSON and HTML come from the same snapshot', async () => {
  const store = memoryStore();
  await seededGoose(store);
  const loaded = await snap.loadArtist(store, 'goose');
  const band = JSON.parse(pages.artistJson(loaded, NOW).body);
  assert.deepStrictEqual(band.band, loaded.snapshot.band);
  assert.strictEqual(band.artist.fetchedAt, loaded.entry.fetchedAt);
  const song = JSON.parse(pages.artistSongJson(loaded, 'arcadia', NOW).body);
  const html = pages.renderSong(loaded, 'arcadia', NOW).body;
  assert.ok(html.includes(`>${song.song.timesPlayed}</div><div class="l">Times played`));
  assert.strictEqual(pages.artistJson(loaded, NOW).headers['Cache-Control'], pages.renderBand(loaded, NOW).headers['Cache-Control']);
  assert.strictEqual(pages.artistSongJson(loaded, 'nope', NOW).statusCode, 404);
});

// ── Sitemap ──────────────────────────────────────────────────────────────

test('artist sitemap lists /artists, every band page and every song page, with lastmod', async () => {
  const store = memoryStore();
  await seededGoose(store);
  const index = await snap.loadIndex(store);
  const urls = artistUrls(index);
  const locs = urls.map((u) => u.loc);
  assert.strictEqual(locs[0], '/artists/');
  assert.ok(locs.includes('/artist/goose/'));
  const entry = index.artists.find((e) => e.slug === 'goose');
  for (const s of entry.songSlugs) assert.ok(locs.includes(`/artist/goose/song/${s}/`));
  assert.ok(urls.every((u) => /^\d{4}-\d{2}-\d{2}$/.test(u.lastmod)));
});

(async () => {
  let passed = 0;
  let failed = 0;
  console.log('\npublic artist pages');
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
