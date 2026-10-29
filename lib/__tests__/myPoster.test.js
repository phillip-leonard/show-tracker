/**
 * Unit tests for lib/myPoster.js — the personal "Songs I've heard" record
 * (/my-poster/?artist=…) built from a user's own logged shows — and the
 * server's half of it in netlify/functions/lib (cleanPersonalRecord, the
 * poster SVG, the /p/ page and its route).
 *
 * What is pinned here:
 *   - counts match Stats → Songs (lib/songCounts.js buildSongStats): a song
 *     played twice at one show is heard once there; performances count
 *     every play; manual and notInSource songs count like any other
 *   - one band is one artistNameKeyLoose ("Widespread Panic (US)" is
 *     Widespread Panic), and its poster name drops the qualifier
 *   - shows with no setlist count in shows and venues, and are listed
 *   - the button's rule: at least 2 shows with a setlist
 *   - an archive band (Goose) is pointed at /heard/
 *   - the record the server stores keeps only its listed fields
 *   - the poster has no band-history block, and the personal credit
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/myPoster.test.js
 */

import assert from 'assert';
import { createRequire } from 'module';
import { buildMyPoster, canMakeMyPoster, myShowsOf, MIN_SHOWS_WITH_SETLIST } from '@/lib/myPoster';
import { buildSongStats } from '@/lib/songCounts';
import { myPosterHref } from '@/lib/showRouting';
import { resolveRoute } from '@/lib/navRoutes';
import { deepLinkTarget } from '@/lib/deepLinks';

const require = createRequire(import.meta.url);
const heard = require('../../netlify/functions/lib/heardRecord');
const posters = require('../../netlify/functions/lib/myPosters');
const { routeParams } = require('../../netlify/functions/lib/publicRouteParams');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function show(id, date, artist, songs, extra = {}) {
  return {
    id, date, artist, venue: `Venue ${id}`, city: 'Town', comment: 'my private note', rating: 9,
    setlist: songs.map((s, i) => (typeof s === 'string' ? { id: `${id}-${i}`, name: s } : { id: `${id}-${i}`, ...s })),
    ...extra,
  };
}

const SHOWS = [
  show('wsp1', '2016-04-15', 'Widespread Panic', ['Chilly Water', 'Porch Song', 'Chilly Water', 'Drums']),
  show('wsp2', '2019-06-29', 'Widespread Panic (US)', ['Chilly Water', { name: 'Tall Boy', manual: true }, { name: 'Space Wrangler', notInSource: true }]),
  // Stored the other way the app has stored dates.
  show('wsp3', '02-07-2021', 'widespread panic', ['Porch Song', 'Ain’t Life Grand']),
  show('wsp4', '2023-10-31', 'Widespread Panic', [], { venue: 'Fox Theatre', city: 'Atlanta' }),
  show('bs1', '2022-05-01', 'Billy Strings', ['Dust in a Baggie']),
  show('g1', '2023-06-01', 'Goose', ['Arcadia', 'Hot Tea']),
  show('g2', '2023-06-02', 'Goose', ['Arcadia']),
];

test('one band under every spelling, oldest first, the qualifier dropped from its name', () => {
  const mine = myShowsOf(SHOWS, 'Widespread Panic (US)');
  assert.deepStrictEqual(mine.map((s) => s.id), ['wsp1', 'wsp2', 'wsp3', 'wsp4']);
  assert.strictEqual(buildMyPoster(SHOWS, 'widespread panic (US)').name, 'Widespread Panic');
});

test('counts match Stats → Songs: repeats once per show, every play a performance', () => {
  const { record } = buildMyPoster(SHOWS, 'Widespread Panic');
  const stats = buildSongStats(myShowsOf(SHOWS, 'Widespread Panic'));
  for (const name of ['Chilly Water', 'Porch Song', 'Tall Boy']) {
    const mine = record.songs.find((s) => s.name === name);
    const theirs = stats.find((s) => s.name === name);
    assert.strictEqual(mine.count, theirs.count, name);
  }
  assert.strictEqual(record.songs.find((s) => s.name === 'Chilly Water').count, 2);
  assert.strictEqual(record.totalSongs, 9); // every play, both Chilly Waters at wsp1
  assert.strictEqual(record.uniqueSongs, 6);
  assert.ok(record.songs.some((s) => s.name === 'Space Wrangler'), 'a notInSource song counts');
});

test('headline numbers, first and last heard, and the first and latest show', () => {
  const { record, noSetlist } = buildMyPoster(SHOWS, 'Widespread Panic');
  assert.strictEqual(record.shows, 4);
  assert.strictEqual(record.showsWithSetlist, 3);
  assert.strictEqual(record.venues, 4);
  assert.strictEqual(record.years, 4);
  assert.deepStrictEqual(noSetlist.map((s) => s.id), ['wsp4']);
  const porch = record.songs.find((s) => s.name === 'Porch Song');
  assert.deepStrictEqual([porch.firstHeard, porch.lastHeard], ['2016-04-15', '2021-07-02']);
  assert.strictEqual(record.firstShow.date, '2016-04-15');
  assert.deepStrictEqual(record.lastShow, { date: '2023-10-31', venue: 'Fox Theatre', city: 'Atlanta' });
  assert.ok(!record.top.some((s) => s.name === 'Drums'), 'Drums is in every song, not the top');
  assert.ok(record.songs.some((s) => s.name === 'Drums'));
});

test('the record holds no notes, ratings or ids', () => {
  const { record } = buildMyPoster(SHOWS, 'Widespread Panic');
  const text = JSON.stringify(record);
  assert.ok(!text.includes('my private note'));
  assert.ok(!/rating|comment|"id"|wsp1-/.test(text));
});

test(`the button needs ${MIN_SHOWS_WITH_SETLIST} shows with a setlist`, () => {
  assert.strictEqual(canMakeMyPoster(SHOWS, 'Widespread Panic'), true);
  assert.strictEqual(canMakeMyPoster(SHOWS, 'Billy Strings'), false);
  assert.strictEqual(canMakeMyPoster([show('x', '2020-01-01', 'Eggy', []), show('y', '2020-01-02', 'Eggy', [])], 'Eggy'), false);
});

test('a band with shows but no setlists lists them all', () => {
  const shows = [show('e1', '2024-03-01', 'Eggy', []), show('e2', '2024-03-02', 'Eggy', [])];
  const { record, noSetlist } = buildMyPoster(shows, 'Eggy');
  assert.strictEqual(record.shows, 2);
  assert.strictEqual(record.uniqueSongs, 0);
  assert.strictEqual(noSetlist.length, 2);
});

test('an archive band is pointed at /heard/', () => {
  assert.strictEqual(buildMyPoster(SHOWS, 'Goose').archive.slug, 'goose');
  assert.strictEqual(buildMyPoster(SHOWS, 'Widespread Panic').archive, null);
});

test('cleanPersonalRecord keeps only its fields and rejects junk', () => {
  const clean = heard.cleanPersonalRecord({
    name: '  Billy\u0000 Strings ', shows: '3', email: 'a@b.c', uid: 'u1',
    firstShow: { date: '2022-05-01', venue: 'Red Rocks', notes: 'x' },
    songs: [{ name: 'Dust in a Baggie', count: 2, rating: 10 }, { name: '', count: 1 }, { name: 'Bad', count: -1 }],
  });
  assert.strictEqual(clean.name, 'Billy Strings');
  assert.deepStrictEqual(Object.keys(clean).sort(), ['firstShow', 'lastShow', 'name', 'personal', 'shows', 'showsWithSetlist', 'songs', 'top', 'totalSongs', 'uniqueSongs', 'venues', 'years']);
  assert.deepStrictEqual(clean.firstShow, { date: '2022-05-01', venue: 'Red Rocks', city: '' });
  assert.deepStrictEqual(clean.songs, [{ name: 'Dust in a Baggie', count: 2, firstHeard: '', lastHeard: '' }]);
  assert.strictEqual(heard.cleanPersonalRecord({ name: 'X', shows: 0 }), null);
  assert.strictEqual(heard.cleanPersonalRecord(null), null);
  // Cleaning twice changes nothing: the app cleans, the server cleans again.
  const { record } = buildMyPoster(SHOWS, 'Widespread Panic');
  assert.deepStrictEqual(heard.cleanPersonalRecord(JSON.parse(JSON.stringify(record))), record);
});

test('the poster: no band-history block, first and latest show, the personal credit', () => {
  const { record } = buildMyPoster(SHOWS, 'Widespread Panic');
  for (const kind of ['feed', 'story', 'card']) {
    const svg = heard.posterSvg(heard.personalData(record), record, kind);
    assert.ok(!/RAREST|BUST-OUT/.test(svg), kind);
    assert.ok(svg.includes('mysetlists.net<'), kind);
    assert.ok(!svg.includes('mysetlists.net/heard'), kind);
    if (kind !== 'card') {
      assert.ok(svg.includes(heard.PERSONAL_CREDIT), kind);
      assert.ok(svg.includes('FIRST SHOW') && svg.includes('LATEST SHOW') && svg.includes('Oct 31, 2023'), kind);
    }
  }
});

test('the /p/ page: noindex, the record, Make your own, nothing personal', () => {
  const { record } = buildMyPoster(SHOWS, 'Widespread Panic');
  const res = posters.renderPosterPage(record, 'abcdefghijkl');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['X-Robots-Tag'], 'noindex, follow');
  assert.ok(res.body.includes('<meta name="robots" content="noindex, follow">'));
  assert.ok(res.body.includes('https://mysetlists.net/p/abcdefghijkl/og.png'));
  assert.ok(res.body.includes('/my-poster/?artist=Widespread%20Panic'));
  assert.ok(res.body.includes('Make your own'));
  assert.ok(res.body.includes(posters.ARCHIVE_NOTE.replace(/'/g, '&#39;')) || res.body.includes(posters.ARCHIVE_NOTE));
  assert.ok(!res.body.includes('my private note'));
});

test('a code is 12 random url-safe characters, and the store round-trips a cleaned record', async () => {
  const data = new Map();
  const store = { get: async (k) => data.get(k) || null, set: async (k, v) => { data.set(k, JSON.parse(JSON.stringify(v))); } };
  const { record } = buildMyPoster(SHOWS, 'Widespread Panic');
  const code = await posters.storeRecord(store, record);
  assert.match(code, posters.CODE);
  assert.notStrictEqual(code, await posters.storeRecord(store, record));
  assert.deepStrictEqual(await posters.loadRecord(store, code), record);
  assert.strictEqual(await posters.loadRecord(store, '../../etc'), null);
  assert.strictEqual(await posters.loadRecord(store, 'abcdefghijkm'), null);
});

test('/p/ routes and /my-poster/ deep links and back', () => {
  assert.deepStrictEqual(routeParams({ path: '/p/abcdefghijkl/' }, 'poster'), { code: 'abcdefghijkl' });
  assert.deepStrictEqual(routeParams({ path: '/.netlify/functions/public-poster/abcdefghijkl/og' }, 'posterImage'), { code: 'abcdefghijkl', image: 'og' });
  assert.deepStrictEqual(routeParams({ path: '/p/abcdefghijkl/poster-story.png' }, 'posterImage'), { code: 'abcdefghijkl', image: 'poster-story' });
  assert.strictEqual(myPosterHref('Widespread Panic'), '/my-poster/?artist=Widespread%20Panic');
  assert.strictEqual(deepLinkTarget('https://mysetlists.net/my-poster/?artist=Eggy'), '/my-poster/?artist=Eggy');
  const withBand = resolveRoute('/my-poster', new URLSearchParams('artist=Widespread Panic'));
  assert.strictEqual(withBand.parentHref, '/bands/?band=widespread-panic');
  const without = resolveRoute('/my-poster', new URLSearchParams('artist=Some Local Band'));
  assert.strictEqual(without.parentHref, '/stats/top-artists');
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
  console.log(`\nmyPoster: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
