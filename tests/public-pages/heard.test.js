#!/usr/bin/env node
/**
 * "Songs I've heard": the per-show data the snapshot job now writes, the
 * share code, the record, the pages, the images, the setlist.fm matching
 * and the stored-code round trip. In memory, with the sources stubbed.
 *
 *   node tests/public-pages/heard.test.js
 *
 * The record's numbers must mean what the band pages' numbers mean, so
 * several tests run the same fixture through both and compare.
 */

const assert = require('node:assert');
const sources = require('../../netlify/functions/lib/publicArtistSources');
const snap = require('../../netlify/functions/lib/publicArtistSnapshot');
const stats = require('../../netlify/functions/lib/artistSnapshotStats');
const heard = require('../../netlify/functions/lib/heardRecord');
const pages = require('../../netlify/functions/lib/heardPages');
const artistPages = require('../../netlify/functions/lib/publicArtistPages');
const shares = require('../../netlify/functions/lib/heardShares');
const { matchAttended } = require('../../netlify/functions/lib/heardImport');
const { createHeardApp } = require('../../netlify/functions/lib/heardClient');
const { routeParams } = require('../../netlify/functions/lib/publicRouteParams');
const { heardUrls } = require('../../netlify/functions/sitemap');

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

function stubSources({ songfish, phishnet: pn, setlistfm, showList } = {}) {
  const saved = { ...sources };
  if (songfish) sources.fetchSongfishYear = async (artist, year) => songfish(artist, year);
  if (pn) sources.fetchPhishnetYear = async (artist, year) => pn(artist, year);
  if (setlistfm) sources.fetchSetlistfmPage = async (artist, page) => setlistfm(artist, page);
  const list = async () => (showList ? showList() : { shows: [], excluded: new Set() });
  sources.fetchSongfishShowList = list;
  sources.fetchPhishnetShowList = list;
  sources.fetchPhishnetSongArtists = async () => new Map();
  return () => Object.assign(sources, saved);
}

// One song in a setlist: [name, original, set] (set defaults to Set I).
const song = ([name, original = true, set = 'Set I']) => ({
  key: `sf:${name}`, slug: stats.slugify(name), name, original, originalArtist: original === false ? 'Someone Else' : '', sourceUrl: '', set,
});

function show(n, date, songs, extra = {}) {
  return {
    id: `s${n}`, date, order: 1, venue: `Venue ${n % 4}`, city: 'Denver', state: 'CO', country: 'USA',
    url: `https://elgoose.net/setlists/s${n}.html`, tour: n > 100 ? 'Fall Tour' : 'Summer Tour',
    songs: songs.map(song), ...extra,
  };
}

// 120 shows, one a day from 2025-01-02:
//   Arcadia and Hot Tea every show; Hot Tea twice at show 10 (a reprise)
//   Rockdale at 1-6, then back at 100 (a 94-show gap: a bust-out)
//   Madhuvan at 1-6 only; Jam at every show (a non-song)
//   Cripple Creek, a cover, at 50 only (a debut, played once)
//   Encore: Hot Tea at shows 20-25
function fixture() {
  const shows = [];
  for (let i = 1; i <= 120; i++) {
    const date = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    const list = [['Arcadia'], ['Jam']];
    if (i <= 6 || i === 100) list.push(['Rockdale']);
    if (i <= 6) list.push(['Madhuvan']);
    if (i === 50) list.push(['Up On Cripple Creek', false]);
    list.push(i >= 20 && i <= 25 ? ['Hot Tea', true, 'Encore'] : ['Hot Tea']);
    if (i === 10) list.push(['Hot Tea', true, 'Set II']);
    shows.push(show(i, date, list));
  }
  return shows;
}

async function seeded(store, shows = fixture(), opts = {}) {
  const restore = stubSources({ songfish: (_a, y) => shows.filter((s) => s.date.startsWith(String(y))), showList: opts.showList });
  try {
    return await snap.runSnapshot({ store, only: ['goose'], force: 'full', now: () => opts.now || NOW, log: quiet });
  } finally { restore(); }
}

async function goose(opts) {
  const store = memoryStore();
  await seeded(store, undefined, opts);
  return { store, loaded: await snap.loadArtistShows(store, 'goose') };
}

const idsOn = (data, dates) => data.shows.filter((s) => dates.includes(s.date)).map((s) => s.id);
const dateOf = (i) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);

// ── Sources: set labels and setlist order ────────────────────────────────

test('Songfish rows come out in setlist order with canonical set labels', () => {
  const row = (o) => ({ show_id: 1, showdate: '2024-04-07', showorder: 1, venuename: 'The Capitol Theatre', city: 'Port Chester', state: 'NY', country: 'USA', permalink: 'x.html', artist_id: 1, isoriginal: 1, tourname: 'Spring Tour', ...o });
  const shows = sources.songfishShowsFromRows([
    row({ song_id: 3, songname: 'Encore Song', settype: 'Encore', setnumber: '1', position: 1 }),
    row({ song_id: 2, songname: 'Second', settype: 'Set', setnumber: '1', position: 2 }),
    row({ song_id: 4, songname: 'Set Two Opener', settype: 'Set', setnumber: '2', position: 1 }),
    row({ song_id: 1, songname: 'First', settype: 'Set', setnumber: '1', position: 1 }),
  ], { host: 'elgoose.net', artistId: 1 });
  assert.deepStrictEqual(shows[0].songs.map((s) => [s.name, s.set]), [['First', 'Set I'], ['Second', 'Set I'], ['Set Two Opener', 'Set II'], ['Encore Song', 'Encore']]);
  assert.strictEqual(shows[0].tour, 'Spring Tour');
  assert.ok(!('sortKey' in shows[0].songs[0]));
});

test('phish.net set codes and setlist.fm encores become the same labels', () => {
  const row = (o) => ({ showid: 1, showdate: '1997-11-22', venue: 'Hampton Coliseum', permalink: 'p', songid: 1, song: 'A', is_original: 1, artist_slug: 'phish', set: '1', position: 1, ...o });
  const pn = sources.phishnetShowsFromRows([row({ songid: 2, song: 'B', set: 'e', position: 1 }), row({})], { artistSlug: 'phish' });
  assert.deepStrictEqual(pn[0].songs.map((s) => [s.name, s.set]), [['A', 'Set I'], ['B', 'Encore']]);
  const fm = sources.setlistfmShow({ id: 'x', eventDate: '01-02-2025', venue: { name: 'V', city: {} }, sets: { set: [{ song: [{ name: 'One' }] }, { encore: 1, song: [{ name: 'Two' }] }] } });
  assert.deepStrictEqual(fm.songs.map((s) => s.set), ['Set I', 'Encore']);
});

// ── The show list in the snapshot ────────────────────────────────────────

test('the snapshot job writes shows/<slug>.json with gaps that match the band page', async () => {
  const { store, loaded } = await goose();
  assert.ok(store.writes.includes('shows/goose.json'));
  const data = loaded.shows;
  assert.strictEqual(data.shows.length, 120);
  assert.strictEqual(data.urlBase, 'https://elgoose.net/setlists/');
  assert.strictEqual(data.shows[0].url, 's1.html');
  assert.strictEqual(data.venues.length, 4);
  assert.deepStrictEqual(data.tours, ['Summer Tour', 'Fall Tour']);

  const idx = (name) => data.songs.findIndex((s) => s.name === name);
  const perf = (n, name) => data.shows[n - 1].sets.flatMap(([, songs]) => songs).filter(([i]) => i === idx(name));
  assert.deepStrictEqual(perf(1, 'Rockdale'), [[idx('Rockdale'), null]], 'a debut has no gap');
  assert.deepStrictEqual(perf(100, 'Rockdale'), [[idx('Rockdale'), 94]]);
  assert.deepStrictEqual(perf(10, 'Hot Tea'), [[idx('Hot Tea'), 1], [idx('Hot Tea'), 0]], 'a reprise is gap 0');
  assert.deepStrictEqual(data.shows[19].sets.map(([label]) => label), ['Set I', 'Encore']);

  // The band page's own bust-out for Rockdale is the same 94.
  const artist = await snap.loadArtist(store, 'goose');
  assert.strictEqual(artist.snapshot.band.bustOuts.find((b) => b.name === 'Rockdale').longestGap, 94);
  assert.strictEqual(data.songs[idx('Arcadia')].timesPlayed, 120);
});

test('a second run with nothing new writes no show list; an old raw cache is refetched in full', async () => {
  const store = memoryStore();
  await seeded(store);
  store.writes.length = 0;
  const shows = fixture();
  const restore = stubSources({ songfish: (_a, y) => shows.filter((s) => s.date.startsWith(String(y))) });
  try {
    const report = await snap.runSnapshot({ store, only: ['goose'], force: true, now: () => NOW + HOUR, log: quiet });
    assert.strictEqual(report.artists[0].full, false);
    assert.ok(!store.writes.includes('shows/goose.json'));
    const raw = await store.get('raw/goose.json');
    await store.set('raw/goose.json', { ...raw, format: 1 });
    const again = await snap.runSnapshot({ store, only: ['goose'], force: true, now: () => NOW + 2 * HOUR, log: quiet });
    assert.strictEqual(again.artists[0].full, true, 'raw cache from before sets were stored');
  } finally { restore(); }
});

test('the raw cache keeps each performance\'s set', async () => {
  const store = memoryStore();
  await seeded(store);
  const raw = await store.get('raw/goose.json');
  const s20 = raw.years['2025'].find((s) => s.id === 's20');
  assert.deepStrictEqual(s20.sets, ['Set I', 'Set I', 'Encore']);
  assert.ok(!('set' in raw.songs['sf:Hot Tea']));
});

test('setlist.fm artists get no show list', async () => {
  assert.strictEqual(snap.hasShowList(snap.findArtist('widespread-panic')), false);
  assert.deepStrictEqual(snap.heardArtists().map((a) => a.slug), ['goose', 'phish', 'umphreys-mcgee', 'king-gizzard-and-the-lizard-wizard']);
  assert.strictEqual(await snap.loadArtistShows(memoryStore(), 'widespread-panic'), null);
  for (const a of snap.heardArtists()) assert.match(a.setlistfmMbid, /^[0-9a-f-]{36}$/, a.slug);
});

// ── Share codes ──────────────────────────────────────────────────────────

test('a share code round-trips, is short, and survives a show being added to the archive', async () => {
  const { loaded } = await goose();
  const data = loaded.shows;
  const ids = data.shows.filter((_, i) => i % 3 === 0).map((s) => s.id);
  const code = heard.encodeSelection(data, ids);
  assert.match(code, /^a[A-Za-z0-9_-]+$/);
  assert.ok(code.length < 70, `40 shows in ${code.length} characters`);
  assert.deepStrictEqual(heard.decodeSelection(data, code).ids.sort(), ids.slice().sort());

  // The archive finds an older show: positions shift, dates don't.
  const shifted = { ...data, shows: [{ ...data.shows[0], id: 'old', date: '2024-06-01' }, ...data.shows] };
  assert.deepStrictEqual(heard.decodeSelection(shifted, code).ids.sort(), ids.slice().sort());
});

test('two shows on one date are told apart; a date with no show is reported', () => {
  const data = { venues: [['A', ''], ['B', '']], songs: [], urlBase: '', shows: [
    { id: 'early', date: '2025-05-01', venue: 0, sets: [] },
    { id: 'late', date: '2025-05-01', venue: 1, sets: [] },
    { id: 'next', date: '2025-05-02', venue: 0, sets: [] },
  ] };
  const code = heard.encodeSelection(data, ['late', 'next']);
  assert.deepStrictEqual(heard.decodeSelection(data, code).ids, ['late', 'next']);
  const fewer = { ...data, shows: data.shows.slice(2) };
  assert.deepStrictEqual(heard.decodeSelection(fewer, code), { ids: ['next'], missing: ['2025-05-01'] });
});

test('malformed codes decode to null, never throw', () => {
  const data = { venues: [], songs: [], shows: [] };
  for (const bad of ['', 'x', 'b123', 'a!!', 'a/..', 'a////', `a${'_'.repeat(20)}`]) {
    assert.strictEqual(heard.decodeSelection(data, bad), null, bad);
  }
  assert.strictEqual(heard.encodeSelection(data, []), '');
});

// ── The record ───────────────────────────────────────────────────────────

test('the record counts a reprise once per show and every performance in the total', async () => {
  const { loaded } = await goose();
  const data = loaded.shows;
  const r = heard.buildRecord(data, idsOn(data, [dateOf(9), dateOf(10), dateOf(11)]));
  assert.strictEqual(r.shows, 3);
  const hotTea = r.songs.find((s) => s.name === 'Hot Tea');
  assert.strictEqual(hotTea.count, 3);
  assert.strictEqual(r.totalSongs, 3 * 3 + 1, 'Arcadia, Jam, Hot Tea at each, plus the reprise');
  assert.strictEqual(r.uniqueSongs, 3);
  assert.strictEqual(r.venues, 3);
  assert.strictEqual(r.years, 1);
  assert.strictEqual(r.firstShow.date, dateOf(9));
  assert.ok(!r.top.some((s) => s.name === 'Jam'), 'a non-song is in every song, not the top list');
  assert.ok(r.songs.some((s) => s.name === 'Jam'));
});

test('bust-outs, debuts, rarest catches and songs still to chase', async () => {
  const { loaded } = await goose();
  const data = loaded.shows;
  const r = heard.buildRecord(data, idsOn(data, [dateOf(50), dateOf(100), dateOf(119)]));
  assert.deepStrictEqual(r.bustOuts.map((b) => [b.name, b.gap, b.show.date]), [['Rockdale', 94, dateOf(100)]]);
  assert.deepStrictEqual(r.debuts.map((d) => d.name), ['Up On Cripple Creek']);
  assert.strictEqual(r.rarest[0].name, 'Up On Cripple Creek');
  assert.strictEqual(r.rarest[0].timesPlayed, 1);
  assert.deepStrictEqual(r.chasing.map((s) => s.name), ['Madhuvan'], 'originals not heard, covers and Jam never');

  const none = heard.buildRecord(data, []);
  assert.strictEqual(none.shows, 0);
  assert.strictEqual(none.firstShow, null);
});

test('the record uses the band pages\' bust-out threshold and non-song list', () => {
  assert.strictEqual(heard.BUST_OUT_MIN_GAP, stats.BUST_OUT_MIN_GAP);
  for (const name of ['Jam', 'Drums', 'Space', 'Bass Solo', 'Big Ball Jam', 'Spanish Jam', 'Arcadia']) {
    assert.strictEqual(heard.isSong({ name }), stats.isSong({ name }), name);
  }
});

test('the headline has counts and the band, nothing else', () => {
  assert.strictEqual(heard.headline('Goose', { shows: 42, totalSongs: 211 }), 'A Goose record: 42 shows, 211 songs heard');
  assert.strictEqual(heard.headline('Phish', { shows: 1, totalSongs: 1 }), 'A Phish record: 1 show, 1 song heard');
});

// ── Poster ───────────────────────────────────────────────────────────────

test('posters render to PNG at 1080x1350, 1080x1920 and 1200x630 with the credit on them', async () => {
  const { loaded } = await goose();
  const data = loaded.shows;
  const record = heard.buildRecord(data, data.shows.slice(0, 40).map((s) => s.id));
  const { render } = require('../../netlify/functions/public-heard-image');
  for (const [kind, w, h] of [['feed', 1080, 1350], ['story', 1080, 1920], ['card', 1200, 630]]) {
    const svg = heard.posterSvg(data, record, kind);
    if (kind !== 'card') assert.ok(svg.includes('Setlists courtesy of elgoose.net'), kind);
    assert.ok(svg.includes('mysetlists.net/heard'), kind);
    const png = render(svg);
    assert.strictEqual(png.readUInt32BE(16), w, `${kind} width`);
    assert.strictEqual(png.readUInt32BE(20), h, `${kind} height`);
  }
  // Names are escaped, not trusted.
  assert.ok(!heard.posterSvg({ ...data, name: '<script>' }, record, 'feed').includes('<script>'));
});

// ── JSON ─────────────────────────────────────────────────────────────────

test('/api/artist-shows serves the list with the band pages\' cache rule; 404 for others', async () => {
  const { loaded } = await goose();
  const res = artistPages.artistShowsJson(loaded, NOW + HOUR);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['Cache-Control'], 'public, s-maxage=3600, stale-while-revalidate=86400');
  const body = JSON.parse(res.body);
  assert.strictEqual(body.artist.name, 'Goose');
  assert.strictEqual(body.shows.length, 120);
  assert.ok(Array.isArray(body.songs) && Array.isArray(body.venues));
  assert.strictEqual(artistPages.artistShowsJson(null).statusCode, 404);
});

test('Phish show lists follow the 24-hour rule: 503 once stale, capped cache before', async () => {
  const entry = { slug: 'phish', source: 'phishnet', fetchedAt: new Date(NOW).toISOString(), showsHash: 'x' };
  const shows = { slug: 'phish', name: 'Phish', source: 'phishnet', sourceName: 'Phish.net', attribution: { text: '', url: 'https://phish.net/' }, songs: [], venues: [], tours: [], urlBase: '', shows: [] };
  const fresh = artistPages.artistShowsJson({ entry, shows }, NOW + 23 * HOUR);
  assert.strictEqual(fresh.statusCode, 200);
  assert.match(fresh.headers['Cache-Control'], /s-maxage=3600, stale-while-revalidate=0/);
  assert.strictEqual(artistPages.artistShowsJson({ entry, shows }, NOW + 25 * HOUR).statusCode, 503);
  assert.strictEqual(pages.renderHeardBand({ entry, shows }, NOW + 25 * HOUR).statusCode, 503);
  assert.strictEqual(pages.renderHeardShare({ entry, shows }, 'aA', [], NOW + 25 * HOUR).statusCode, 503);
});

test('a share code expands to the shows to save, setlists in the app\'s shape', async () => {
  const { loaded } = await goose();
  const data = loaded.shows;
  const code = heard.encodeSelection(data, idsOn(data, [dateOf(20), dateOf(50)]));
  const res = pages.selectedShowsJson(loaded, code, NOW);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.artist.name, 'Goose');
  assert.deepStrictEqual(body.shows.map((s) => s.date), [dateOf(20), dateOf(50)]);
  assert.deepStrictEqual(body.shows[0].setlist, [
    { name: 'Arcadia', set: 'Set I', cover: null },
    { name: 'Jam', set: 'Set I', cover: null },
    { name: 'Hot Tea', set: 'Encore', cover: null },
  ]);
  assert.deepStrictEqual(body.shows[1].setlist.find((s) => s.name === 'Up On Cripple Creek').cover, 'Someone Else');
  assert.strictEqual(body.shows[0].venue, 'Venue 0');
  assert.strictEqual(pages.selectedShowsJson(loaded, 'not-a-code', NOW).statusCode, 404);
});

// ── Pages ────────────────────────────────────────────────────────────────

test('/heard/goose/ is an indexable page with the tool inlined and the source credited', async () => {
  const { loaded } = await goose();
  const res = pages.renderHeardBand(loaded, NOW + HOUR);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.includes('<title>How many times have you heard Goose songs live? | MySetlists</title>'));
  assert.ok(res.body.includes('<link rel="canonical" href="https://mysetlists.net/heard/goose/">'));
  assert.ok(!/name="robots"/.test(res.body));
  assert.ok(res.body.includes('Setlists courtesy of elgoose.net'));
  assert.ok(res.body.includes('/artist/goose/song/arcadia/'), 'links the most played songs');
  assert.ok(res.body.includes('function createHeard()') && res.body.includes('function createHeardApp('));
  assert.ok(!/<\/script/i.test(res.body.slice(res.body.indexOf('<script>\n') + 9, res.body.lastIndexOf('</script>'))), 'nothing closes the script early');
});

test('the inlined scripts run in a page: the record code works and the app code parses', async () => {
  const { loaded } = await goose();
  const H = new Function(`return (${heard.createHeard.toString()})();`)();
  const ids = loaded.shows.shows.slice(0, 5).map((s) => s.id);
  assert.strictEqual(H.buildRecord(loaded.shows, ids).shows, 5);
  assert.strictEqual(H.encodeSelection(loaded.shows, ids), heard.encodeSelection(loaded.shows, ids));
  assert.doesNotThrow(() => new Function(`return (${createHeardApp.toString()});`)());
});

test('a share page renders the record, noindex, with its own preview image', async () => {
  const { loaded } = await goose();
  const data = loaded.shows;
  const code = heard.encodeSelection(data, idsOn(data, [dateOf(50), dateOf(100)]));
  const res = pages.renderHeardShare(loaded, code, heard.decodeSelection(data, code).ids, NOW);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['X-Robots-Tag'], 'noindex, follow');
  assert.ok(res.body.includes('<meta name="robots" content="noindex, follow">'));
  assert.ok(res.body.includes(`<meta property="og:image" content="https://mysetlists.net/heard/goose/r/${code}/og.png">`));
  assert.ok(res.body.includes('<title>A Goose record: 2 shows, 8 songs heard | MySetlists</title>'));
  assert.ok(res.body.includes('Make your own'));
  assert.ok(res.body.includes('Bust-outs witnessed') && res.body.includes('Rockdale'));
});

test('/heard/ lists the bands with show lists', async () => {
  const { store } = await goose();
  const index = await snap.loadIndex(store);
  const res = pages.renderHeardIndex(index.artists.map((entry) => ({ entry })), NOW);
  assert.ok(res.body.includes('href="https://mysetlists.net/heard/goose/"'));
  assert.ok(res.body.includes('<link rel="canonical" href="https://mysetlists.net/heard/">'));
});

test('band and song pages link to the tool for archive bands only', async () => {
  const store = memoryStore();
  await seeded(store);
  const loaded = await snap.loadArtist(store, 'goose');
  assert.ok(artistPages.renderBand(loaded, NOW).body.includes('href="https://mysetlists.net/heard/goose/"'));
  assert.ok(artistPages.renderSong(loaded, 'arcadia', NOW).body.includes('How many times have you heard Arcadia?'));
  assert.ok(artistPages.renderSong(loaded, 'arcadia', NOW).body.includes('href="https://mysetlists.net/heard/goose/"'));
  const wsp = { ...loaded, snapshot: { ...loaded.snapshot, slug: 'widespread-panic', name: 'Widespread Panic' } };
  assert.ok(!artistPages.renderBand(wsp, NOW).body.includes('/heard/'));
});

test('heard routes come from the public URL or the function URL', () => {
  assert.deepStrictEqual(routeParams({ path: '/heard/goose/' }, 'heard'), { slug: 'goose' });
  assert.deepStrictEqual(routeParams({ path: '/.netlify/functions/public-heard/goose' }, 'heard'), { slug: 'goose' });
  assert.deepStrictEqual(routeParams({ path: '/heard/goose/r/aB-_/' }, 'heardShare'), { slug: 'goose', code: 'aB-_' });
  assert.deepStrictEqual(routeParams({ path: '/heard/goose/r/aB/' }, 'heard'), { slug: '' });
  assert.deepStrictEqual(routeParams({ path: '/heard/goose/r/aB/og.png' }, 'heardImage'), { slug: 'goose', code: 'aB', image: 'og' });
  assert.deepStrictEqual(routeParams({ path: '/.netlify/functions/public-heard-image/goose/aB/poster-story' }, 'heardImage'), { slug: 'goose', code: 'aB', image: 'poster-story' });
});

test('the pages sitemap lists /heard/ and each published band, not share links', async () => {
  const { store } = await goose();
  const urls = heardUrls(await snap.loadIndex(store)).map((u) => u.loc);
  assert.deepStrictEqual(urls, ['/heard/', '/heard/goose/']);
  assert.deepStrictEqual(heardUrls({ artists: [] }), []);
});

// ── Stored codes ─────────────────────────────────────────────────────────

test('a long code is stored under its hash id, the same id every time, and resolves back; nothing else resolves', async () => {
  const store = memoryStore();
  const code = `a${'Q'.repeat(3000)}`;
  const id = await shares.storeCode(store, 'goose', code, NOW);
  assert.match(id, shares.STORED_ID);
  assert.strictEqual(await shares.storeCode(store, 'goose', code, NOW), id);
  assert.deepStrictEqual([...new Set(store.writes)], [`goose/${id}`]);
  const open = () => store;
  assert.strictEqual(await shares.resolveCode(open, 'goose', id), code);
  assert.strictEqual(await shares.resolveCode(open, 'phish', id), '', 'ids are per band');
  assert.strictEqual(await shares.resolveCode(open, 'goose', 'aABC'), 'aABC');
  assert.strictEqual(await shares.resolveCode(() => { throw new Error('no store needed'); }, 'goose', 'aABC'), 'aABC');
  assert.strictEqual(await shares.resolveCode(open, 'goose', 'b0000000000000000'), '');
  assert.strictEqual(await shares.resolveCode(open, 'goose', '../x'), '');
});

// ── setlist.fm import ────────────────────────────────────────────────────

test('setlist.fm attendance matches by mbid, date and venue, and reports what it can\'t', () => {
  const MBID = 'b925a474-d245-4217-bc13-2e153d82bebb';
  const data = { venues: [['Red Rocks Amphitheatre', 'Morrison, CO'], ['The Capitol Theatre', 'Port Chester, NY'], ['Early Room', 'X'], ['Late Room', 'X']], songs: [], urlBase: '', shows: [
    { id: 'rr1', date: '2025-06-20', venue: 0, sets: [] },
    { id: 'cap', date: '2025-07-01', venue: 1, sets: [] },
    { id: 'early', date: '2025-08-01', venue: 2, sets: [] },
    { id: 'late', date: '2025-08-01', venue: 3, sets: [] },
  ] };
  const sl = (date, venue, mbid = MBID) => ({ artist: { mbid }, eventDate: date, venue: { name: venue, city: { name: 'Somewhere' } } });
  const out = matchAttended(data, [
    sl('20-06-2025', 'Red Rocks Amphitheatre'),
    sl('20-06-2025', 'Red Rocks Amphitheatre'), // the same night entered twice
    sl('02-07-2025', 'Capitol Theatre'), // a day off, same venue
    sl('01-08-2025', 'Late Room'),
    sl('01-08-2025', 'Somewhere Else', '6849ebec-b385-4b41-b5a1-125f91e46119'), // the Belgian GOOSE
    sl('05-09-2025', 'Nowhere'),
  ], MBID);
  assert.deepStrictEqual(out.ids, ['rr1', 'cap', 'late']);
  assert.strictEqual(out.attended, 4);
  assert.deepStrictEqual(out.unmatched, [{ date: '2025-09-05', venue: 'Nowhere', city: 'Somewhere' }]);
});

test('personal variants of the tool page are noindex, all canonical to /heard/<slug>/', async () => {
  const { loaded } = await goose();
  const canonical = '<link rel="canonical" href="https://mysetlists.net/heard/goose/">';
  const plain = pages.renderHeardBand(loaded, NOW + HOUR);
  const mine = pages.renderHeardBand(loaded, NOW + HOUR, { mine: true });
  assert.ok(plain.body.includes(canonical) && mine.body.includes(canonical));
  assert.ok(!/name="robots"/.test(plain.body));
  assert.strictEqual(plain.headers['X-Robots-Tag'], undefined);
  assert.ok(mine.body.includes('<meta name="robots" content="noindex, follow">'));
  assert.strictEqual(mine.headers['X-Robots-Tag'], 'noindex, follow');
  // The CDN keeps the two apart.
  assert.strictEqual(plain.headers['Netlify-Vary'], 'query=mine');
  // The app's #mine= link never reaches the server; the page noindexes itself.
  assert.ok(plain.body.includes("/[#&](mine|have)=/.test(location.hash)") && plain.body.includes("m.content='noindex, follow'"));
});

// ── A signed-in user's logged shows ──────────────────────────────────────

test('logged shows match by date and venue, the way setlist.fm and the archives spell rooms', () => {
  const data = { songs: [], urlBase: '', venues: [
    ['Red Rocks Park and Amphitheater', 'Morrison, CO'], ['Elysée-Montmartre', 'Paris'], ['Dillon Amphitheatre', 'Dillon, CO'],
    ['Melkweg', 'Amsterdam'], ['Brooklyn Academy of Music', 'Brooklyn, NY'], ['Early Room', ''], ['Late Room', ''], ['Saenger Theatre', 'New Orleans, LA'],
  ], shows: [
    { id: 'rr', date: '2026-08-27', venue: 0, sets: [] },
    { id: 'paris', date: '2026-06-01', venue: 1, sets: [] },
    { id: 'dillon', date: '2026-09-02', venue: 2, sets: [] },
    { id: 'melkweg', date: '2026-05-27', venue: 3, sets: [] },
    { id: 'bam', date: '2026-10-02', venue: 4, sets: [] },
    { id: 'early', date: '2026-07-04', venue: 5, sets: [] },
    { id: 'late', date: '2026-07-04', venue: 6, sets: [] },
    { id: 'saenger', date: '2026-04-21', venue: 7, sets: [] },
  ] };
  const out = heard.matchLoggedShows(data, [
    { date: '2026-08-27', venue: 'Red Rocks Amphitheatre' },
    { date: '2026-08-27', venue: 'Red Rocks Amphitheatre' }, // logged twice
    { date: '2026-06-01', venue: 'Élysée Montmartre' },
    { date: '2026-09-02', venue: 'Dillon Amphitheater' },
    { date: '2026-04-21', venue: 'Saenger Performing Arts Theater' },
    { date: '2026-05-27', venue: 'The Max' }, // a room inside Melkweg: not guessed
    { date: '2026-10-02', venue: 'Jimmy Kimmel Live' }, // a TV taping that day
    { date: '2026-07-04', venue: '' }, // two shows that day, no venue to choose by
    { date: '2026-03-01', venue: 'Nowhere' },
    { date: 'not a date', venue: 'x' },
  ]);
  assert.deepStrictEqual(out.ids, ['rr', 'paris', 'dillon', 'saenger']);
  assert.deepStrictEqual(out.unmatched.map((u) => [u.date, u.venue, u.nearest && u.nearest.id]), [
    ['2026-03-01', 'Nowhere', null],
    ['2026-05-27', 'The Max', 'melkweg'],
    ['2026-07-04', '', null],
    ['2026-10-02', 'Jimmy Kimmel Live', 'bam'],
  ]);
  // No venue and one show that day is that show.
  assert.deepStrictEqual(heard.matchLoggedShows(data, [{ date: '2026-08-27', venue: '' }]).ids, ['rr']);
});

test('archive band pages swap in "Make my poster" for a signed-in visitor; others don\'t', async () => {
  const store = memoryStore();
  await seeded(store);
  const loaded = await snap.loadArtist(store, 'goose');
  const body = artistPages.renderBand(loaded, NOW).body;
  assert.ok(body.includes('id="heard-cta"'));
  assert.ok(body.includes("localStorage.getItem('mysetlists_signed_in')") && body.includes("a.href+='?mine=1'"));
  const wsp = { ...loaded, snapshot: { ...loaded.snapshot, slug: 'widespread-panic', name: 'Widespread Panic' } };
  assert.ok(!artistPages.renderBand(wsp, NOW).body.includes('mysetlists_signed_in'));
});

// ── Runner ───────────────────────────────────────────────────────────────

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.stack.split('\n').slice(0, 4).join('\n    ')}`);
    }
  }
  console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
