/**
 * Unit tests for the 2026 recap: lib/yearRecap.js (the counts, top lists,
 * highlights and show buddy, against a hand-counted account),
 * lib/yearRecapRarity.js (rarest catch and bust-outs from a band archive)
 * and lib/recapLaunch.js (when it launches and is promoted).
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/yearRecap.test.js
 */

process.env.TZ = 'America/Los_Angeles';

import assert from 'assert';
import { computeYearRecap, computeShowBuddy, showsInYear } from '@/lib/yearRecap';
import { rarityFrom, archiveBandsFor } from '@/lib/yearRecapRarity';
import {
  RECAP_LAUNCH_AT, RECAP_PROMO_ENDS_AT, recapLive, recapPromoActive, usesRecapLayout, defaultReviewYear, recapHref,
} from '@/lib/recapLaunch';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

const songs = (...names) => names.map((name, i) => ({ id: `s${i}`, name }));

// A hand-counted 2026:
//   Shows:   7 (the 2025 show and the 2027 show are not in 2026)
//   Bands:   4 — Goose, Phish, Billy Strings, Mt. Joy
//            ("goose (US)" is Goose; "Phish" twice is one band)
//   Venues:  5 — Red Rocks, MSG, The Capitol Theatre, The Salt Shed, Ryman
//            (Red Rocks twice; MSG as "madison square garden" is one venue)
//   Cities:  5 — Morrison, New York, Port Chester, Chicago, Nashville
//   New bands:  3 — Phish, Billy Strings, Mt. Joy (Goose was seen in 2025)
//   New venues: 4 — all but Red Rocks (seen in 2025)
//   No setlist: 1 — Mt. Joy at the Ryman
//   Songs heard: 6 distinct — Hot Tea, Arcadia, Tweezer, Fuego, Hungry
//            Child, Dust in a Baggie
//   Top songs:  Hot Tea 3 (three shows; played twice at the 06-20 show,
//               counted once), Arcadia 2, then the 1s A–Z
//   Busiest month: June (3 shows)
//   Longest run: none (see the highlights test)
const SHOWS = [
  { id: 'old', artist: 'Goose', venue: 'Red Rocks Amphitheatre', city: 'Morrison', date: '2025-07-04', setlist: songs('Hot Tea') },
  { id: 'g1', artist: 'Goose', venue: 'Red Rocks Amphitheatre', city: 'Morrison', date: '2026-06-20', setlist: songs('Hot Tea', 'Arcadia', 'Hot Tea') },
  { id: 'g2', artist: 'goose (US)', venue: 'Red Rocks Amphitheatre', city: 'Morrison', date: '21-06-2026', setlist: songs('Arcadia', 'Hot Tea') },
  { id: 'p1', artist: 'Phish', venue: 'Madison Square Garden', city: 'New York', date: '2026-12-31', setlist: songs('Tweezer', 'Fuego') },
  { id: 'p2', artist: 'Phish', venue: 'madison square garden', city: 'New York', date: '2026-06-28', setlist: songs('Tweezer') },
  { id: 'b1', artist: 'Billy Strings', venue: 'The Capitol Theatre', city: 'Port Chester', date: '2026-03-14', setlist: songs('Hungry Child', 'Dust in a Baggie') },
  { id: 'g3', artist: 'Goose', venue: 'The Salt Shed', city: 'Chicago', date: '2026-01-01', setlist: songs('Hot Tea') },
  { id: 'm1', artist: 'Mt. Joy', venue: 'Ryman Auditorium', city: 'Nashville', date: '2026-08-09', setlist: [] },
  { id: 'next', artist: 'Phish', venue: 'Madison Square Garden', city: 'New York', date: '2027-01-01', setlist: songs('Tweezer') },
];

test('headline counts match the hand count', () => {
  const r = computeYearRecap(SHOWS, 2026);
  assert.strictEqual(r.totalShows, 7);
  assert.strictEqual(r.totalBands, 4);
  assert.strictEqual(r.totalVenues, 5);
  assert.strictEqual(r.totalCities, 5);
  assert.strictEqual(r.newBands, 3);
  assert.deepStrictEqual(r.newBandNames, ['Billy Strings', 'Mt. Joy', 'Phish']);
  assert.strictEqual(r.newVenues, 4);
});

test('songs heard counts distinct songs, never the no-setlist show', () => {
  const r = computeYearRecap(SHOWS, 2026);
  // Hot Tea, Arcadia, Tweezer, Fuego, Hungry Child, Dust in a Baggie
  assert.strictEqual(r.songsHeard, 6);
  assert.strictEqual(r.showsWithSetlist, 6);
  assert.deepStrictEqual(r.noSetlist.map((s) => s.id), ['m1']);
});

test('top songs count a song once per show', () => {
  const r = computeYearRecap(SHOWS, 2026);
  assert.deepStrictEqual(r.topSongs.slice(0, 3).map((s) => [s.name, s.count]), [['Hot Tea', 3], ['Arcadia', 2], ['Tweezer', 2]]);
  assert.strictEqual(r.topSongs[0].artist, 'Goose');
  assert.strictEqual(r.topSongs.length, 6);
});

test('top bands by shows, ties A–Z, one band per loose key', () => {
  const r = computeYearRecap(SHOWS, 2026);
  assert.deepStrictEqual(r.topBands.map((b) => [b.name, b.shows]), [['Goose', 3], ['Phish', 2], ['Billy Strings', 1], ['Mt. Joy', 1]]);
});

test('highlights: first, latest, busiest month, longest run, updated through', () => {
  const r = computeYearRecap(SHOWS, 2026);
  assert.strictEqual(r.highlights.firstShow.id, 'g3');
  assert.strictEqual(r.highlights.firstShow.date, '2026-01-01');
  assert.strictEqual(r.highlights.latestShow.id, 'p1');
  assert.strictEqual(r.updatedThrough, '2026-12-31');
  assert.deepStrictEqual([r.highlights.busiestMonth.name, r.highlights.busiestMonth.shows], ['June', 3]);
  // g1 and g2 are spelled differently ("Goose" / "goose (US)"), and runs
  // group by exact band name (lib/runIndex.js), so this account has no run.
  assert.strictEqual(r.highlights.longestRun, null);
});

test('longest run: consecutive nights, same band and venue', () => {
  const run = [
    { id: 'a', artist: 'Phish', venue: 'MSG', city: 'New York', date: '2026-12-29', setlist: [] },
    { id: 'b', artist: 'Phish', venue: 'MSG', city: 'New York', date: '2026-12-30', setlist: [] },
    { id: 'c', artist: 'Phish', venue: 'MSG', city: 'New York', date: '2026-12-31', setlist: [] },
    { id: 'd', artist: 'Goose', venue: 'Capitol', city: 'Port Chester', date: '2026-02-01', setlist: [] },
    { id: 'e', artist: 'Goose', venue: 'Capitol', city: 'Port Chester', date: '2026-02-02', setlist: [] },
  ];
  const r = computeYearRecap(run, 2026);
  assert.deepStrictEqual([r.highlights.longestRun.artist, r.highlights.longestRun.nights], ['Phish', 3]);
  assert.strictEqual(r.highlights.longestRun.start, '2026-12-29');
});

test('a year with no shows is null; showsInYear ignores undated shows', () => {
  assert.strictEqual(computeYearRecap(SHOWS, 2024), null);
  assert.strictEqual(showsInYear([{ id: 'x', artist: 'A', date: '' }], 2026).length, 0);
});

// ── Show buddy ────────────────────────────────────────────────────────

const FRIENDS = [
  { friendUid: 'ann', friendName: 'Ann Smith' },
  { friendUid: 'bo', friendName: 'Bo Diddley' },
  { friendUid: 'cy', friendName: 'Cy Young' },
];

test('show buddy counts only accepted tags and tags received', () => {
  const year = showsInYear([
    // tagged Ann and Bo; only Ann accepted
    { id: '1', artist: 'Goose', venue: 'Red Rocks', date: '2026-06-20', taggedFriendUids: ['ann', 'bo'] },
    // tagged Bo (pending)
    { id: '2', artist: 'Goose', venue: 'Red Rocks', date: '2026-06-21', taggedFriendUids: ['bo'] },
    // Cy tagged me
    { id: '3', artist: 'Phish', venue: 'MSG', date: '2026-12-31', taggedByUid: 'cy' },
    // tagged Ann, accepted, matched by setlist.fm id
    { id: '4', artist: 'Phish', venue: 'MSG', date: '2026-12-30', setlistfmId: 'sfm4', taggedFriendUids: ['ann'] },
  ], 2026);
  const accepted = [
    { toUid: 'ann', showData: { artist: 'Goose', venue: 'Red Rocks', date: '2026-06-20' } },
    { toUid: 'ann', showData: { artist: 'Phish', venue: 'Madison Square Garden', date: '2026-12-30', setlistfmId: 'sfm4' } },
  ];
  assert.deepStrictEqual(computeShowBuddy(year, accepted, FRIENDS), { uid: 'ann', name: 'Ann Smith', firstName: 'Ann', shows: 2 });
});

test('show buddy: none without accepted tags; former friends never count', () => {
  const year = showsInYear([
    { id: '1', artist: 'Goose', venue: 'Red Rocks', date: '2026-06-20', taggedFriendUids: ['bo'] },
    { id: '2', artist: 'Goose', venue: 'Red Rocks', date: '2026-06-21', taggedByUid: 'gone' },
  ], 2026);
  assert.strictEqual(computeShowBuddy(year, [], FRIENDS), null);
});

test('show buddy ties go to the name that sorts first', () => {
  const year = showsInYear([
    { id: '1', artist: 'A', venue: 'V', date: '2026-01-01', taggedByUid: 'cy' },
    { id: '2', artist: 'A', venue: 'V', date: '2026-01-02', taggedByUid: 'bo' },
  ], 2026);
  assert.strictEqual(computeShowBuddy(year, [], FRIENDS).uid, 'bo');
});

// ── Rarity ────────────────────────────────────────────────────────────

// A tiny Goose archive: song 2 has been played 3 times ever, song 1 a lot.
// gap is shows since the song was last played (null = debut).
const ARCHIVE = {
  ok: true,
  urlBase: '',
  venues: [['Red Rocks Amphitheatre', 'Morrison, CO'], ['The Salt Shed', 'Chicago, IL']],
  songs: [
    { slug: 'hot-tea', name: 'Hot Tea', isOriginal: true, timesPlayed: 400 },
    { slug: 'arcadia', name: 'Arcadia', isOriginal: true, timesPlayed: 150 },
    { slug: 'rare', name: 'Rare One', isOriginal: true, timesPlayed: 3 },
    { slug: 'jam', name: 'Jam', isOriginal: false, timesPlayed: 1 },
  ],
  shows: [
    { id: 'x1', date: '2026-01-01', venue: 1, sets: [['Set I', [[0, 2], [3, 10]]]] },
    { id: 'x2', date: '2026-06-20', venue: 0, sets: [['Set I', [[0, 1], [1, 120]]]] },
    { id: 'x3', date: '2026-06-21', venue: 0, sets: [['Set I', [[2, 80], [1, 1]]]] },
  ],
};

test('rarity: rarest catch and bust-outs from the archive, Jam left out', () => {
  const year = showsInYear(SHOWS, 2026);
  const bands = archiveBandsFor(year);
  const goose = bands.find((b) => b.slug === 'goose');
  assert.ok(goose, 'Goose is an archive band');
  // "21-06-2026" is matched after conversion to ISO
  assert.strictEqual(goose.shows.length, 3);
  const r = rarityFrom([{ band: goose, data: ARCHIVE }]);
  assert.deepStrictEqual([r.rarest.name, r.rarest.timesPlayed, r.rarest.band, r.rarest.date], ['Rare One', 3, 'Goose', '2026-06-21']);
  assert.deepStrictEqual(r.bustOuts.map((b) => [b.name, b.gap]), [['Arcadia', 120], ['Rare One', 80]]);
});

test('rarity: nothing when no archive band was seen or nothing matched', () => {
  assert.deepStrictEqual(rarityFrom([]), { rarest: null, bustOuts: [] });
  const r = rarityFrom([{ band: { slug: 'goose', name: 'Goose', shows: [{ date: '2026-03-03', venue: 'Nowhere' }] }, data: ARCHIVE }]);
  assert.deepStrictEqual(r, { rarest: null, bustOuts: [] });
});

// ── Launch ────────────────────────────────────────────────────────────

test('launch: 2026-12-02 00:00 Pacific, promo through Jan 15', () => {
  assert.strictEqual(new Date(RECAP_LAUNCH_AT).toISOString(), '2026-12-02T08:00:00.000Z');
  assert.strictEqual(recapLive(RECAP_LAUNCH_AT - 1), false);
  assert.strictEqual(recapLive(RECAP_LAUNCH_AT), true);
  assert.strictEqual(recapPromoActive(Date.UTC(2027, 0, 15, 20)), true);
  assert.strictEqual(recapPromoActive(RECAP_PROMO_ENDS_AT), false);
  assert.strictEqual(recapPromoActive(Date.UTC(2026, 11, 1, 12)), false, 'not on Dec 1');
});

test('layout: recap only for 2026, after launch or for an admin preview', () => {
  const before = Date.UTC(2026, 10, 20);
  assert.strictEqual(usesRecapLayout(2026, { now: before }), false);
  assert.strictEqual(usesRecapLayout(2026, { now: before, preview: true }), false, 'preview needs admin');
  assert.strictEqual(usesRecapLayout(2026, { now: before, preview: true, isAdmin: true }), true);
  assert.strictEqual(usesRecapLayout(2026, { now: RECAP_LAUNCH_AT }), true);
  assert.strictEqual(usesRecapLayout(2025, { now: RECAP_LAUNCH_AT }), false);
});

test('default year: 2026 once live, last year before', () => {
  assert.strictEqual(defaultReviewYear(Date.UTC(2026, 10, 20)), 2025);
  assert.strictEqual(defaultReviewYear(Date.UTC(2026, 11, 5)), 2026);
  assert.strictEqual(defaultReviewYear(Date.UTC(2027, 0, 10)), 2026);
  assert.strictEqual(recapHref(), '/year-in-review/?year=2026');
});

console.log(`yearRecap: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
