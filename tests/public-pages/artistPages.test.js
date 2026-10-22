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
const elgoose = require('../../netlify/functions/lib/songfishAdapter');
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

// Swap the source fetchers for fixtures; returns a restore function. The
// show lists and phish.net's songs list default to empty, so no test
// reaches the network.
function stubSources({ songfish, phishnet: pn, setlistfm, showList, songArtists } = {}) {
  const saved = { ...sources };
  if (songfish) sources.fetchSongfishYear = async (artist, year) => songfish(artist, year);
  if (pn) sources.fetchPhishnetYear = async (artist, year) => pn(artist, year);
  if (setlistfm) sources.fetchSetlistfmPage = async (artist, page) => setlistfm(artist, page);
  const list = async () => (showList ? showList() : { shows: [], excluded: new Set() });
  sources.fetchSongfishShowList = list;
  sources.fetchPhishnetShowList = list;
  sources.fetchPhishnetSongArtists = async () => songArtists || new Map();
  return () => Object.assign(sources, saved);
}

// A band with originals, covers and a song the source doesn't classify,
// in one year of shows: s1..s(n).
function mixedShow(id, date, songs) {
  return {
    id, date, order: 1, venue: `Venue ${id}`, city: 'Denver', state: 'CO', country: 'USA',
    url: `https://elgoose.net/setlists/${id}.html`,
    songs: songs.map(([name, original, originalArtist = '']) => ({ key: `sf:${name}`, slug: name.toLowerCase().replace(/\s+/g, '-'), name, original, originalArtist, sourceUrl: '' })),
  };
}

function mixedFixture() {
  const shows = [];
  for (let i = 1; i <= 120; i++) {
    const day = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    const songs = [['Arcadia', true], ['Hot Tea', true]];
    // Rockdale: played early, then nothing for 80 shows, then back.
    if (i <= 6 || i === 100) songs.push(['Rockdale', true]);
    // Madhuvan: played early and not since.
    if (i <= 6) songs.push(['Madhuvan', true]);
    // Cripple Creek: a cover, played early and not since.
    if (i <= 6) songs.push(['Up On Cripple Creek', false, 'The Band']);
    if (i % 2) songs.push(["Let's Dance", false, 'David Bowie']);
    // Mystery: the source doesn't say whose it is.
    if (i <= 6) songs.push(['Mystery', null]);
    shows.push(mixedShow(`s${i}`, day, songs));
  }
  return shows;
}

async function seededMixed(store, { showList } = {}) {
  const shows = mixedFixture();
  const restore = stubSources({ songfish: (_a, y) => shows.filter((s) => s.date.startsWith(String(y))), showList });
  try {
    return await snap.runSnapshot({ store, only: ['goose'], force: 'full', now: () => NOW, log: quiet });
  } finally { restore(); }
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

test('setlist.fm: a song with no cover artist is an original, one with a cover artist is not', () => {
  const shown = sources.setlistfmShow({
    id: 'x', eventDate: '01-02-2025', venue: { name: 'Red Rocks', city: { name: 'Morrison', stateCode: 'CO', country: { code: 'US' } } },
    sets: { set: [{ song: [{ name: 'Chilly Water' }, { name: 'Ophelia', cover: { name: 'The Band' } }, { name: 'Intro', tape: true }] }] },
  });
  assert.deepStrictEqual(shown.songs.map((s) => [s.name, s.original, s.originalArtist]), [['Chilly Water', true, ''], ['Ophelia', false, 'The Band']]);
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

test('a gap of as many shows as the band has played is refused, and the last good snapshot kept', async () => {
  const store = memoryStore();
  await seededGoose(store);
  const before = store.data.get('artists/goose.json');
  const { snapshot } = await snap.loadArtist(store, 'goose');
  assert.strictEqual(snap.looksComplete(snapshot, null), '');
  const total = snapshot.band.totalShows;
  const broken = (patch) => ({ ...snapshot, songs: snapshot.songs.map((s, i) => (i === 0 ? { ...s, ...patch } : s)) });
  assert.match(snap.looksComplete(broken({ currentGap: total }), null), /current gap of \d+ shows, but the band has/);
  assert.match(snap.looksComplete(broken({ longestGap: total + 5 }), null), /longest gap/);
  assert.strictEqual(snap.looksComplete(broken({ currentGap: total - 1 }), null), '');

  // Through the job: a stats bug that inflates gaps fails the artist.
  const stats = require('../../netlify/functions/lib/artistSnapshotStats');
  const real = stats.buildArtistStats;
  stats.buildArtistStats = (shows) => {
    const out = real(shows);
    out.band.mostPlayed[0] = { ...out.band.mostPlayed[0], currentGap: out.band.totalShows + 10 };
    return out;
  };
  const years = yearsFixture();
  const restore = stubSources({ songfish: (_a, y) => years[y] || [] });
  try {
    const report = await snap.runSnapshot({ store, only: ['goose'], force: 'full', now: () => NOW + HOUR, log: quiet });
    assert.strictEqual(report.artists[0].status, 'failed');
    assert.match(report.artists[0].error, /but the band has/);
  } finally { restore(); stats.buildArtistStats = real; }
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

test('a snapshot from an older schema is due at once, and its raw cache is refetched in full', async () => {
  const goose = snap.findArtist('goose');
  const fresh = { fetchedAt: new Date(NOW - HOUR).toISOString() };
  assert.strictEqual(snap.isDue({ ...fresh, schemaVersion: snap.SCHEMA_VERSION }, goose, NOW, false), false);
  assert.strictEqual(snap.isDue({ ...fresh, schemaVersion: 1 }, goose, NOW, false), true);

  const store = memoryStore();
  await seededGoose(store);
  const raw = await store.get('raw/goose.json');
  await store.set('raw/goose.json', { ...raw, schemaVersion: 1 });
  const years = yearsFixture();
  const restore = stubSources({ songfish: (_a, y) => years[y] || [] });
  try {
    const report = await snap.runSnapshot({ store, only: ['goose'], force: true, now: () => NOW + HOUR, log: quiet });
    assert.strictEqual(report.artists[0].full, true);
  } finally { restore(); }
});

test('only due artists run: Phish every 6 hours, everyone else daily', () => {
  const at = (h) => ({ fetchedAt: new Date(NOW - h * HOUR).toISOString(), schemaVersion: snap.SCHEMA_VERSION });
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

// ── Originals, covers and all-time gaps ──────────────────────────────────

test('current gaps split into originals and covers; an unknown song is in neither', async () => {
  const store = memoryStore();
  await seededMixed(store);
  const { band } = (await snap.loadArtist(store, 'goose')).snapshot;
  const names = (list) => list.map((s) => s.name);
  assert.deepStrictEqual(names(band.originalGapLeaders), ['Madhuvan', 'Rockdale', 'Arcadia', 'Hot Tea']);
  assert.deepStrictEqual(names(band.coverGapLeaders), ['Up On Cripple Creek', "Let's Dance"]);
  for (const list of [band.originalGapLeaders, band.coverGapLeaders, band.bustOuts]) {
    assert.ok(!names(list).includes('Mystery'));
  }
  assert.strictEqual(band.mostPlayed.find((s) => s.name === "Let's Dance").isOriginal, false);
  assert.strictEqual(band.mostPlayed.find((s) => s.name === 'Mystery').isOriginal, null);
});

test('bust-outs: originals only, longest gap ever with the shows either side, short gaps left out', async () => {
  const store = memoryStore();
  await seededMixed(store);
  const { band, songs } = (await snap.loadArtist(store, 'goose')).snapshot;
  // Rockdale: last at show 6, back at show 100, so 94 shows (counting the
  // bust-out, the way phish.net and elgoose.net print it). Arcadia and Hot
  // Tea come back every show (gap 1), under the bust-out minimum.
  assert.deepStrictEqual(band.bustOuts.map((s) => [s.name, s.longestGap, s.gapStart.date, s.gapEnd.date]), [['Rockdale', 94, '2025-01-07', '2025-04-11']]);
  const rockdale = songs.find((s) => s.slug === 'rockdale');
  assert.strictEqual(rockdale.gapStart.url, 'https://elgoose.net/setlists/s6.html');
  assert.strictEqual(rockdale.gapEnd.venue, 'Venue s100');
});

test('non-songs (Jam, solos, Drums, Unknown) stay out of the gap lists and bust-outs, not out of the snapshot', () => {
  const { buildArtistStats, isSong } = require('../../netlify/functions/lib/artistSnapshotStats');
  for (const name of ['Jam', 'jam ', 'Bass solo', 'Drum Solo', 'Dueling Drums', 'Drums', 'Space', 'Unknown']) assert.strictEqual(isSong({ name }), false, name);
  for (const name of ['Big Ball Jam', 'Spanish Jam', 'Slow Jam 1', 'Interlude I', 'Space Oddity', 'Drums of War']) assert.strictEqual(isSong({ name }), true, name);

  // Each played at the first 6 of 100 shows, then once more at show 100:
  // every one leads its gap list and has a 94-show bust-out, songs or not.
  const titles = [['Jam', true], ['Rockdale', true], ['Unknown', false], ['Up On Cripple Creek', false]];
  const shows = Array.from({ length: 100 }, (_, i) => mixedShow(`s${i + 1}`, new Date(Date.UTC(2025, 0, 2) + i * 86400000).toISOString().slice(0, 10),
    [['Arcadia', true], ...(i < 6 || i === 99 ? titles : [])]));
  shows.push(mixedShow('s101', '2025-04-12', [['Arcadia', true]]));
  const { band, songs } = buildArtistStats(shows);
  assert.deepStrictEqual(band.originalGapLeaders.map((s) => s.name), ['Rockdale', 'Arcadia']);
  assert.deepStrictEqual(band.coverGapLeaders.map((s) => s.name), ['Up On Cripple Creek']);
  assert.deepStrictEqual(band.bustOuts.map((s) => s.name), ['Rockdale']);
  assert.ok(songs.find((s) => s.name === 'Jam'), 'Jam keeps its song page');
  assert.ok(band.mostPlayed.find((s) => s.name === 'Jam'), 'and its place in most played');
});

test('listed shows with no setlist count in every gap, except ones after the latest setlist', async () => {
  const store = memoryStore();
  // Ten shows with no known setlist between Rockdale's two runs, and one
  // after the latest setlist (last night's, not entered yet).
  const unknown = Array.from({ length: 10 }, (_, i) => ({ ...mixedShow(`u${i}`, `2025-02-0${i % 9 + 1}`, []), id: `u${i}` }));
  const tonight = mixedShow('late', '2025-05-30', []);
  await seededMixed(store, { showList: () => ({ shows: [...unknown, tonight], excluded: new Set() }) });
  const { band, songs } = (await snap.loadArtist(store, 'goose')).snapshot;
  assert.strictEqual(band.totalShows, 130);
  assert.strictEqual(songs.find((s) => s.slug === 'rockdale').longestGap, 104);
  assert.strictEqual(songs.find((s) => s.slug === 'arcadia').currentGap, 0, 'the trailing show without a setlist is not counted');
});

test('phish.net: shows it leaves out of its stats are left out here, covers get their artist', async () => {
  const store = memoryStore();
  const shows = mixedFixture().map((s) => ({ ...s, songs: s.songs.map((x) => ({ ...x, key: x.key.replace('sf:', 'pn:'), originalArtist: '' })) }));
  const restore = stubSources({
    phishnet: (_a, y) => shows.filter((s) => s.date.startsWith(String(y))),
    showList: () => ({ shows: [], excluded: new Set(['s50', 's51']) }),
    songArtists: new Map([['pn:Up On Cripple Creek', 'The Band'], ['pn:Arcadia', 'Phish']]),
  });
  try {
    await snap.runSnapshot({ store, only: ['phish'], env: { PHISHNET_API_KEY: 'test' }, force: 'full', now: () => NOW, log: quiet });
  } finally { restore(); }
  const { band, songs } = (await snap.loadArtist(store, 'phish')).snapshot;
  assert.strictEqual(band.totalShows, 118);
  assert.strictEqual(songs.find((s) => s.slug === 'rockdale').longestGap, 92);
  assert.strictEqual(songs.find((s) => s.slug === 'up-on-cripple-creek').originalArtist, 'The Band');
  assert.strictEqual(songs.find((s) => s.slug === 'arcadia').originalArtist, '', 'an original has no original artist');
});

test('a setlist.fm window short of the full history has no bust-outs; a complete one does', async () => {
  const run = async (total) => {
    const store = memoryStore();
    const shows = mixedFixture().slice(0, 20).map((s) => ({ ...s, lastUpdated: 'a' }));
    const restore = stubSources({ setlistfm: (_a, page) => ({ total, itemsPerPage: 20, setlists: page === 1 ? shows : [], artistUrl: '' }) });
    try {
      await snap.runSnapshot({ store, only: ['dead-and-company'], env: { SETLISTFM_API_KEY: 'test' }, force: 'full', now: () => NOW, log: quiet });
    } finally { restore(); }
    return (await snap.loadArtist(store, 'dead-and-company')).snapshot;
  };
  const partial = await run(400);
  assert.strictEqual(partial.coverage.fullHistory, false);
  assert.strictEqual(partial.band.bustOuts, null);
  assert.ok(!pages.renderBand({ entry: { source: 'setlistfm', fetchedAt: new Date(NOW).toISOString() }, snapshot: partial }, NOW).body.includes('bust-outs'));
  const complete = await run(20);
  assert.strictEqual(complete.coverage.fullHistory, true);
  assert.ok(Array.isArray(complete.band.bustOuts));
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

test('band page: most played, original gaps, cover gaps, bust-outs, then recent shows; covers labeled', async () => {
  const store = memoryStore();
  await seededMixed(store);
  const body = pages.renderBand(await snap.loadArtist(store, 'goose'), NOW).body;
  const order = ['Most played Goose songs', 'Goose songs with the longest gaps', 'Goose covers with the longest gaps', 'Biggest Goose bust-outs', 'Recent Goose shows']
    .map((h) => body.indexOf(`<h2>${h}</h2>`));
  assert.ok(order.every((i) => i > 0), order.join());
  assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order);
  const originals = body.slice(order[1], order[2]);
  const covers = body.slice(order[2], order[3]);
  assert.ok(!originals.includes('Cripple Creek') && covers.includes('Up On Cripple Creek'));
  assert.ok(!body.slice(order[1], order[4]).includes('Mystery'));
  assert.match(body.slice(order[0], order[1]), /Let&#39;s Dance<\/a><span class="tag">Cover<\/span>|Let's Dance<\/a><span class="tag">Cover<\/span>/);
  assert.match(body.slice(order[3], order[4]), /Rockdale<\/a><\/td><td class="num">94<\/td>/);
});

test('a version 1 snapshot (before the split) still renders', async () => {
  const store = memoryStore();
  await seededGoose(store);
  const loaded = await snap.loadArtist(store, 'goose');
  const { originalGapLeaders, coverGapLeaders, bustOuts, ...v1band } = loaded.snapshot.band;
  const res = pages.renderBand({ ...loaded, snapshot: { ...loaded.snapshot, band: v1band } }, NOW);
  assert.strictEqual(res.statusCode, 200);
});

test('song page: original or cover (by whom), and the longest gap ever with its dates', async () => {
  const store = memoryStore();
  await seededMixed(store);
  const loaded = await snap.loadArtist(store, 'goose');
  const cover = pages.renderSong(loaded, 'up-on-cripple-creek', NOW).body;
  assert.ok(cover.includes('Cover (by The Band)'));
  const rockdale = pages.renderSong(loaded, 'rockdale', NOW).body;
  assert.ok(rockdale.includes('>Original</div>'));
  assert.match(rockdale, /Longest gap ever: 94 shows \(<a href="https:\/\/elgoose.net\/setlists\/s6.html">Jan 7, 2025<\/a> to <a href="https:\/\/elgoose.net\/setlists\/s100.html">Apr 11, 2025<\/a>\)/);
  const mystery = pages.renderSong(loaded, 'mystery', NOW).body;
  assert.ok(!mystery.includes('Original') && !mystery.includes('Cover'));
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

test('JSON carries the original/cover flag and the longest gap, matching the HTML', async () => {
  const store = memoryStore();
  await seededMixed(store);
  const loaded = await snap.loadArtist(store, 'goose');
  const band = JSON.parse(pages.artistJson(loaded, NOW).body);
  assert.deepStrictEqual(band.band.bustOuts, loaded.snapshot.band.bustOuts);
  const summary = band.songs.find((s) => s.slug === 'rockdale');
  assert.deepStrictEqual([summary.isOriginal, summary.longestGap, summary.gapStart, summary.gapEnd], [true, 94, '2025-01-07', '2025-04-11']);
  const song = JSON.parse(pages.artistSongJson(loaded, 'up-on-cripple-creek', NOW).body).song;
  assert.deepStrictEqual([song.isOriginal, song.originalArtist], [false, 'The Band']);
  const html = pages.renderSong(loaded, 'rockdale', NOW).body;
  assert.ok(html.includes(`Longest gap ever: ${summary.longestGap} shows`));
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
