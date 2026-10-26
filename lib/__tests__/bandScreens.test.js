/**
 * Unit tests for lib/bandScreens.js — the data behind the in-app band and
 * song screens (/bands/?band=…&song=…).
 *
 * What is pinned here:
 *   - the user's numbers come from buildSongIndex, so a band screen's
 *     "heard N×" and gap equal Stats → Songs' for the same shows
 *   - a show's artist matches its band loosely ("Goose (US)" is Goose), and
 *     a title through the band's aliases (SOS is Same Old Shenanigans)
 *   - only a band /api/artists lists gets an entry point, and the index
 *     failing falls back to every configured band
 *   - the Phish 24-hour rule: a cached phish.net response past 24 hours is
 *     fetched again, never shown; a 503 is "unavailable"
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/bandScreens.test.js
 */

import assert from 'assert';
import {
  PUBLIC_BANDS, configBandFor, configBandBySlug, isShowable, bandForArtist,
  buildBandPersonal, songSlugIndex, songSlugFor, isoDate, publicBandUrl,
  loadBandIndex, loadBand, cachedBand, resetBandCaches, BandLoadError,
} from '@/lib/bandScreens';
import { buildSongIndex, songKeyFor } from '@/lib/songIndex';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const goose = configBandBySlug('goose');
const phish = configBandBySlug('phish');

function show(id, date, artist, songs) {
  return { id, date, artist, venue: `Venue ${id}`, city: 'Town', setlist: songs.map((name, i) => ({ id: `${id}-${i}`, name })) };
}

const SHOWS = [
  show('a', '2023-06-01', 'Goose', ['Arcadia', 'Hot Tea', 'SOS']),
  show('b', '2024-03-02', 'Goose', ['Arcadia', 'Madhuvan']),
  show('c', '2025-07-04', 'Goose', ['Hot Tea', 'Arcadia', 'Arcadia']),
  show('d', '2025-08-01', 'Phish', ['Tweezer']),
];

// ── Bands ─────────────────────────────────────────────────────────────

test('every configured band is listed, keyed loosely', () => {
  assert.ok(PUBLIC_BANDS.length >= 4);
  assert.strictEqual(configBandFor('Goose (US)').slug, 'goose');
  assert.strictEqual(configBandFor('The String Cheese Incident').slug, 'string-cheese-incident');
  assert.strictEqual(configBandFor('Nobody'), null);
});

test('an entry point only for a band the index lists, and Phish only inside 24 hours', () => {
  const index = new Map([
    ['goose', { slug: 'goose', source: 'songfish', fetchedAt: new Date(NOW - 50 * HOUR).toISOString() }],
    ['phish', { slug: 'phish', source: 'phishnet', fetchedAt: new Date(NOW - 23 * HOUR).toISOString() }],
  ]);
  assert.strictEqual(bandForArtist(index, 'Goose', NOW), goose, 'the same object every time');
  assert.strictEqual(bandForArtist(index, 'Phish', NOW), phish);
  assert.strictEqual(bandForArtist(index, 'Phish', NOW + 2 * HOUR), null);
  assert.strictEqual(bandForArtist(index, 'Billy Strings', NOW), null, 'configured, no snapshot');
  assert.strictEqual(bandForArtist(null, 'Goose', NOW), null, 'nothing before the index loads');
});

test('signed out on the web, a band screen URL is its public page', () => {
  assert.strictEqual(publicBandUrl('/bands/', '?band=goose'), '/artist/goose/');
  assert.strictEqual(publicBandUrl('/bands', '?band=goose&song=arcadia'), '/artist/goose/song/arcadia/');
  assert.strictEqual(publicBandUrl('/bands/', '?band=billy-strings&song=x'), '/artist/billy-strings/', 'no song pages there');
  assert.strictEqual(publicBandUrl('/bands/', '?band=nobody'), null);
  assert.strictEqual(publicBandUrl('/shows/', '?band=goose'), null);
});

test('isShowable: only phish.net data expires', () => {
  assert.strictEqual(isShowable('songfish', '2020-01-01T00:00:00Z', NOW), true);
  assert.strictEqual(isShowable('phishnet', new Date(NOW - 23.9 * HOUR).toISOString(), NOW), true);
  assert.strictEqual(isShowable('phishnet', new Date(NOW - 24 * HOUR).toISOString(), NOW), false);
  assert.strictEqual(isShowable('phishnet', undefined, NOW), false);
});

// ── The user's side ───────────────────────────────────────────────────

test('your counts and gaps are Stats → Songs\' counts for the same shows', () => {
  const personal = buildBandPersonal(SHOWS, goose);
  const stats = buildSongIndex(SHOWS);
  ['Arcadia', 'Hot Tea', 'Madhuvan'].forEach((title) => {
    const mine = personal.songFor(title);
    const theirs = stats[songKeyFor('Goose', title)];
    assert.strictEqual(mine.timesSeen, theirs.timesSeen, title);
    assert.deepStrictEqual(mine.currentGap.shows, theirs.currentGap.shows, title);
    assert.deepStrictEqual(mine.performances.map((p) => p.showId), theirs.performances.map((p) => p.showId), title);
  });
  assert.strictEqual(personal.songFor('Arcadia').timesSeen, 3, 'twice in one show is one show heard');
  assert.strictEqual(personal.shows.length, 3);
  assert.deepStrictEqual(personal.shows.map((s) => s.id), ['c', 'b', 'a'], 'newest first');
  assert.strictEqual(personal.songs[0].title, 'Arcadia', 'most heard first');
});

test('a band logged under two spellings is one band, one timeline', () => {
  const shows = [...SHOWS, show('e', '2026-01-10', 'Goose (US)', ['Madhuvan'])];
  const personal = buildBandPersonal(shows, goose);
  assert.strictEqual(personal.shows.length, 4);
  assert.strictEqual(personal.songFor('Madhuvan').timesSeen, 2);
  assert.strictEqual(personal.songFor('Arcadia').currentGap.shows, 1);
});

test('titles match through the band\'s aliases and normalization', () => {
  const personal = buildBandPersonal(SHOWS, goose);
  assert.strictEqual(personal.songFor('Same Old Shenanigans').timesSeen, 1, 'SOS is Same Old Shenanigans');
  assert.strictEqual(personal.songFor('ARCADIA!').timesSeen, 3);
  assert.strictEqual(personal.songFor('Tweezer'), null, 'another band\'s song is not this band\'s');
});

test('your shows by date, for the "You were there" marks; old DD-MM-YYYY dates too', () => {
  const personal = buildBandPersonal([...SHOWS, show('f', '05-09-2022', 'Goose', [])], goose);
  assert.strictEqual(personal.showByDate.get('2024-03-02').id, 'b');
  assert.strictEqual(personal.showByDate.get('2022-09-05').id, 'f');
  assert.strictEqual(isoDate('05-09-2022'), '2022-09-05');
  assert.strictEqual(isoDate('nope'), '');
});

test('a setlist title finds its song screen only when the band has song pages', () => {
  const body = { artist: { songPages: true }, songs: [{ slug: 'arcadia', name: 'Arcadia' }, { slug: 'same-old-shenanigans', name: 'Same Old Shenanigans' }] };
  const index = songSlugIndex(body, goose);
  assert.strictEqual(songSlugFor(index, goose, 'arcadia'), 'arcadia');
  assert.strictEqual(songSlugFor(index, goose, 'SOS'), 'same-old-shenanigans');
  assert.strictEqual(songSlugFor(index, goose, 'Not A Song'), null);
  assert.strictEqual(songSlugIndex({ ...body, artist: { songPages: false } }, goose).size, 0);
});

// ── Fetching and the session cache ────────────────────────────────────

function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const hit = routes(path);
    if (hit instanceof Error) throw hit;
    return { ok: hit.status === 200, status: hit.status, json: async () => hit.body };
  };
  return calls;
}

test('the index lists what /api/artists says; failing, every configured band', async () => {
  resetBandCaches();
  stubFetch(() => ({ status: 200, body: { ok: true, artists: [{ slug: 'goose', source: 'songfish', fetchedAt: new Date().toISOString() }] } }));
  const index = await loadBandIndex();
  assert.deepStrictEqual([...index.keys()], ['goose']);

  resetBandCaches();
  stubFetch(() => new TypeError('Network request failed'));
  const fallback = await loadBandIndex();
  assert.strictEqual(fallback.size, PUBLIC_BANDS.length);
  assert.ok(bandForArtist(fallback, 'Phish'));
});

test('a band is fetched once per session', async () => {
  resetBandCaches();
  const calls = stubFetch(() => ({ status: 200, body: { ok: true, artist: { slug: 'goose', source: 'songfish', fetchedAt: '2026-10-26T00:00:00Z' } } }));
  await loadBand('goose');
  await loadBand('goose');
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].endsWith('/api/artist?slug=goose'));
});

test('Phish: a cached copy past 24 hours is dropped and fetched again', async () => {
  resetBandCaches();
  const fetchedAt = new Date(Date.now() - 23.5 * HOUR).toISOString();
  const calls = stubFetch(() => ({ status: 200, body: { ok: true, artist: { slug: 'phish', source: 'phishnet', fetchedAt } } }));
  await loadBand('phish');
  assert.ok(cachedBand('phish'));
  assert.strictEqual(cachedBand('phish', Date.now() + HOUR), null, 'past 24 hours: not shown');
  assert.strictEqual(calls.length, 1);
});

test('Phish: a 503, or a copy already past 24 hours, is "unavailable"', async () => {
  resetBandCaches();
  stubFetch(() => ({ status: 503, body: { ok: false, error: 'unavailable' } }));
  await assert.rejects(loadBand('phish'), (e) => e instanceof BandLoadError && e.kind === 'unavailable');

  resetBandCaches();
  const old = new Date(Date.now() - 30 * HOUR).toISOString();
  stubFetch(() => ({ status: 200, body: { ok: true, artist: { slug: 'phish', source: 'phishnet', fetchedAt: old } } }));
  await assert.rejects(loadBand('phish'), (e) => e.kind === 'unavailable');
  assert.strictEqual(cachedBand('phish'), null);
});

test('offline is a "network" error, a 404 "not_found"', async () => {
  resetBandCaches();
  stubFetch(() => new TypeError('Load failed'));
  await assert.rejects(loadBand('goose'), (e) => e.kind === 'network');
  resetBandCaches();
  stubFetch(() => ({ status: 404, body: { ok: false } }));
  await assert.rejects(loadBand('goose'), (e) => e.kind === 'not_found');
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`✗ ${t.name}\n  ${err.stack || err.message}`);
    }
  }
  console.log(`\nbandScreens: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
