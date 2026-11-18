/**
 * lib/stats — golden tests for the numbers people see (5.59.15).
 *
 * A fixture user with every edge case the production data has: legacy
 * DD-MM-YYYY dates, an ambiguous NN-NN-YYYY date, a festival import, a
 * duplicate night, a sandwich, band and venue spellings, an unreadable
 * date, empty setlist entries. Plus parity with the app's own keys, and
 * the rank rules.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/stats.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { computeUserStats, publicStats, isRanked, rankUsers, formatAverageRating } from '@/lib/stats/index';
import { songKey, bandKey } from '@/lib/stats/keys';
import { songTitleKey } from '@/lib/songCounts';
import { artistNameKeyLoose } from '@/lib/setlistSources';
import { showYear } from '@/lib/showDate';

let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const FIXTURE = [
  // ISO date; a sandwich (Arcadia twice) is two performances, one song.
  { artist: 'Goose', venue: 'Red Rocks Amphitheatre', city: 'Morrison', date: '2025-06-01', rating: 9,
    setlist: [{ name: 'Arcadia', rating: 10 }, { name: 'Hungersite' }, { name: 'Arcadia' }] },
  // Legacy DD-MM-YYYY, the same venue spelled differently, the same band in another spelling.
  { artist: 'goose (US)', venue: 'red rocks  amphitheatre ', city: 'morrison', date: '02-06-2025', rating: 7,
    setlist: [{ name: 'Ashes//Dust', rating: 8 }] },
  // Ambiguous NN-NN-YYYY: read day-first, as the app shows it (3 April 2024).
  { artist: 'Phish', venue: 'MSG', city: 'New York', date: '03-04-2024',
    setlist: [{ name: 'Ashes // Dust' }, { name: 'Tweezer' }] },
  // A festival import (built by buildShowDoc like any show).
  { artist: 'The Band', venue: 'Bonnaroo Farm', city: 'Manchester', date: '2023-06-15', festivalId: 'f1', setlistfmId: 'x1',
    setlist: [{ name: 'The Weight - Live' }] },
  // The same night logged twice: two documents, two shows.
  { artist: 'Band', venue: 'Bonnaroo Farm', city: 'Manchester', date: '15-06-2023', setlist: [] },
  // Unreadable date; no venue; empty and missing song names.
  { artist: 'Goose', venue: '', city: 'Austin', date: 'TBA', rating: 11, setlist: [{ name: '' }, {}, { name: 'Hungersite', rating: 6 }] },
];

test('golden: the fixture user', () => {
  // `years` is checked on its own below and in fixtures/user-stats/years.json.
  const { years, ...allTime } = computeUserStats(FIXTURE);
  assert.ok(years);
  assert.deepStrictEqual(allTime, {
    statsVersion: 2,
    showCount: 6,
    songCount: 10,              // every setlist entry, the sandwich and the empty ones included
    ratedSongCount: 3,
    uniqueSongCount: 5,         // arcadia, hungersite, ashes dust (both spellings), tweezer, the weight
    bandCount: 3,               // goose, phish, band
    venueCount: 3,              // red rocks::morrison, msg::new york, bonnaroo farm::manchester
    yearsActive: 3,
    showsByYear: { 2023: 2, 2024: 1, 2025: 2 },
    firstShowDate: '2023-06-15',
    lastShowDate: '2025-06-02',
    avgShowRating: 8,           // 9 and 7; 11 is out of range. A number since 5.60.12
    ratedShowCount: 2,
    topBands: [{ name: 'Goose', count: 3 }, { name: 'The Band', count: 2 }, { name: 'Phish', count: 1 }],
    topVenues: [
      { name: 'Bonnaroo Farm, Manchester', count: 2 },
      { name: 'Red Rocks Amphitheatre, Morrison', count: 2 },
      { name: 'MSG, New York', count: 1 },
    ],
    // Shows each song was seen at, per band + song (5.60.27): the Arcadia
    // sandwich is one show; "Ashes//Dust" by Goose and by Phish stay apart;
    // the blank and missing names are skipped.
    topSongs: [
      { name: 'Hungersite', artist: 'Goose', count: 2 },
      { name: 'Arcadia', artist: 'Goose', count: 1 },
      { name: 'Ashes // Dust', artist: 'Phish', count: 1 },
      { name: 'Ashes//Dust', artist: 'goose (US)', count: 1 },
      { name: 'The Weight - Live', artist: 'The Band', count: 1 },
      { name: 'Tweezer', artist: 'Phish', count: 1 },
    ],
  });
});

test('years: one entry per dated year, each the same definitions on that year (5.60.32)', () => {
  const stats = computeUserStats(FIXTURE);
  assert.deepStrictEqual(Object.keys(stats.years), Object.keys(stats.showsByYear));
  for (const [y, entry] of Object.entries(stats.years)) {
    const yearShows = FIXTURE.filter((s) => showYear(s.date) === y);
    const { statsVersion, yearsActive, showsByYear, years, ...expected } = computeUserStats(yearShows);
    assert.deepStrictEqual({ ...entry, showsByMonth: undefined }, { ...expected, showsByMonth: undefined }, y);
    assert.strictEqual(entry.showsByMonth.length, 12, y);
    assert.strictEqual(entry.showsByMonth.reduce((a, n) => a + n, 0), entry.showCount, y);
  }
});

test('top lists: ten each, most first, ties by name (5.60.27)', () => {
  // 12 bands at 12 venues; band i has i shows, each with song "S<i>" twice
  // (a reprise) and the shared opener "Intro".
  const shows = [];
  for (let i = 1; i <= 12; i += 1) {
    for (let k = 0; k < i; k += 1) {
      shows.push({ artist: `Band ${String(i).padStart(2, '0')}`, venue: `Venue ${i}`, city: 'Town', date: '2025-01-01',
        setlist: [{ name: 'Intro' }, { name: `S${i}` }, { name: `S${i}` }] });
    }
  }
  const s = computeUserStats(shows);
  assert.strictEqual(s.topBands.length, 10);
  assert.strictEqual(s.topVenues.length, 10);
  assert.strictEqual(s.topSongs.length, 10);
  assert.deepStrictEqual(s.topBands[0], { name: 'Band 12', count: 12 });
  assert.deepStrictEqual(s.topBands[9], { name: 'Band 03', count: 3 });
  // "Intro" is a different song for every band, and a reprise counts once.
  assert.deepStrictEqual(s.topSongs.slice(0, 2), [
    { name: 'Intro', artist: 'Band 12', count: 12 },
    { name: 'S12', artist: 'Band 12', count: 12 },
  ]);
  assert.deepStrictEqual(s.topSongs[9], { name: 'S8', artist: 'Band 08', count: 8 });
  assert.ok(s.topSongs.every((e, i, a) => i === 0 || a[i - 1].count >= e.count));
});

test('top songs: one band in two spellings is one song; ties by name, then band', () => {
  const s = computeUserStats([
    { artist: 'Goose', setlist: [{ name: 'Arcadia' }] },
    { artist: 'goose (US)', setlist: [{ name: 'arcadia' }] },
    { artist: 'Phish', setlist: [{ name: 'Wilson' }] },
    { artist: 'Ween', setlist: [{ name: 'Wilson' }] },
  ]);
  assert.deepStrictEqual(s.topSongs, [
    { name: 'Arcadia', artist: 'Goose', count: 2 },
    { name: 'Wilson', artist: 'Phish', count: 1 },
    { name: 'Wilson', artist: 'Ween', count: 1 },
  ]);
});

test('golden: the song keys behind uniqueSongCount', () => {
  const keys = new Set(FIXTURE.flatMap((s) => (s.setlist || []).map((x) => songKey(x && x.name))).filter(Boolean));
  assert.deepStrictEqual([...keys].sort(), ['arcadia', 'ashes dust', 'hungersite', 'the weight', 'tweezer']);
});

test('average rating: a number, one decimal', () => {
  const s = computeUserStats([{ artist: 'A', venue: 'V', date: '2024-01-01', rating: 9 }, { artist: 'A', venue: 'V', date: '2024-01-02', rating: 8 }, { artist: 'A', venue: 'V', date: '2024-01-03', rating: 8 }]);
  assert.strictEqual(s.avgShowRating, 8.3);
  assert.strictEqual(typeof s.avgShowRating, 'number');
  assert.strictEqual(formatAverageRating(8), '8.0');
  assert.strictEqual(formatAverageRating(8.3), '8.3');
  assert.strictEqual(formatAverageRating('7.5'), '7.5', 'a document written before 5.60.12');
  assert.strictEqual(formatAverageRating(null), '');
});

test('an empty account', () => {
  const s = computeUserStats([]);
  assert.strictEqual(s.showCount, 0);
  assert.strictEqual(s.avgShowRating, null);
  assert.strictEqual(s.firstShowDate, null);
  assert.deepStrictEqual(s.topBands, []);
  assert.deepStrictEqual(s.topSongs, []);
  assert.deepStrictEqual(computeUserStats(undefined).showCount, 0);
});

test('the stored date format never changes a number', () => {
  const iso = computeUserStats([{ artist: 'A', venue: 'V', date: '2024-04-03' }]);
  const legacy = computeUserStats([{ artist: 'A', venue: 'V', date: '03-04-2024' }]);
  assert.deepStrictEqual(iso, legacy);
});

test('publicStats: only the four counts and the rank', () => {
  const p = publicStats(computeUserStats(FIXTURE), { rank: 2, of: 30 });
  assert.deepStrictEqual(Object.keys(p).sort(), ['rank', 'rankedOf', 'ratedSongCount', 'showCount', 'songCount', 'statsVersion', 'venueCount']);
  assert.strictEqual(p.rank, 2);
  assert.strictEqual(publicStats(computeUserStats(FIXTURE)).rank, null);
});

test('keys match the app: songKey = songTitleKey, bandKey = artistNameKeyLoose', () => {
  const songs = ['Ashes//Dust', 'Ashes // Dust', 'The Weight - Live', 'Tweezer (Remastered 2009)', '  Arcadia ', '', null, 'Déjà Vu', 'Run Like an Antelope ->'];
  for (const s of songs) assert.strictEqual(songKey(s), songTitleKey(s), String(s));
  const bands = ['Goose', 'goose (US)', 'The Band', 'Band', "Umphrey's McGee", 'King Gizzard & the Lizard Wizard', '[live] Phish', '', null];
  for (const b of bands) assert.strictEqual(bandKey(b), artistNameKeyLoose(b), String(b));
});

test('isRanked: real accounts with shows only', () => {
  const s = { showCount: 3 };
  assert.ok(isRanked({}, s));
  assert.ok(!isRanked({ isTestUser: true }, s));
  assert.ok(!isRanked({ banned: true }, s));
  assert.ok(!isRanked({}, { showCount: 0 }));
  assert.ok(!isRanked({}, null));
});

test('rankUsers: highest first, ties share a rank (1, 2, 2, 4)', () => {
  const r = rankUsers([{ uid: 'a', showCount: 10 }, { uid: 'b', showCount: 7 }, { uid: 'c', showCount: 7 }, { uid: 'd', showCount: 2 }]);
  assert.deepStrictEqual([...r.entries()].map(([u, v]) => [u, v.rank, v.of]), [['a', 1, 4], ['b', 2, 4], ['c', 2, 4], ['d', 4, 4]]);
  assert.strictEqual(rankUsers([]).size, 0);
});

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('B-05: no client code outside the admin view reads every profile; rank is one document', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, ent.name);
      if (ent.name === '__tests__' || ent.name === 'node_modules') continue;
      if (ent.isDirectory()) walk(rel);
      else if (/\.(js|jsx)$/.test(ent.name) && rel !== path.join('components', 'AdminView.jsx')
        && read(rel).includes("collection(db, 'userProfiles')")) offenders.push(rel);
    }
  };
  for (const d of ['lib', 'components', 'context', 'app', 'hooks']) walk(d);
  assert.deepStrictEqual(offenders, []);
  const ctx = read('context/AppContext.jsx');
  assert.ok(!ctx.includes('calculateUserRank'));
  assert.ok(ctx.includes("onSnapshot(doc(db, 'userStats', user.uid)"));
  assert.ok(ctx.includes("authedFetch('/.netlify/functions/recompute-my-stats', { method: 'POST' })"));
});

test('the leaderboard view hides blocked users and says when it was updated', () => {
  const view = read('components/CommunityStatsView.jsx');
  assert.ok(view.includes('const visible = (list) => (list || []).filter((entry) => !blocked.has(entryUid(entry)));'));
  assert.ok(view.includes('visible(communityStats.topShowsAttended)') && view.includes('visible(communityStats.topSongsRated)'));
  assert.ok(view.includes('updatedLabel(communityStats.updatedAt)'));
});

test('the web client writes no counts and reads other users\' counts from the server', () => {
  const ctx = read('context/AppContext.jsx');
  const start = ctx.indexOf('async function updateUserProfile(');
  const body = ctx.slice(start, ctx.indexOf('\n}\n', start));
  for (const f of ['showCount:', 'songCount:', 'ratedSongCount:', 'venueCount:']) assert.ok(!body.includes(f), `updateUserProfile writes ${f}`);
  assert.ok(ctx.includes("getDoc(doc(db, 'publicUserStats', f.friendUid))"), 'Friends list');
  assert.ok(!ctx.includes("getDoc(doc(db, 'userProfiles', f.friendUid))"));
  const sheet = read('components/moderation/UserProfileSheet.jsx');
  assert.ok(sheet.includes("getDoc(doc(db, 'publicUserStats', uid))"), 'profile sheet');
  assert.ok(read('components/AdminView.jsx').includes("getDocs(collection(db, 'userStats'))"), 'admin overlays server counts');
  assert.ok(read('netlify/functions/lib/communityStats.js').includes('statsFor(profile.id)'), 'leaderboards from server stats');
});

test('headline numbers: server document when it matches the shows on screen, else lib/stats', () => {
  const ctx = read('context/AppContext.jsx');
  assert.ok(ctx.includes('serverStats && serverStats.statsVersion === STATS_VERSION && serverStats.showCount === shows.length'));
  assert.ok(read('app/stats/page.jsx').includes('computeUserStats(periodShows)'));
  assert.ok(read('components/profile/ProfileView.js').includes('const headline = headlineStats || computeUserStats(shows);'));
});

for (const t of tests) {
  try { await t.fn(); passed++; } catch (err) { failed++; console.error(`✗ ${t.name}\n  ${err.message}`); }
}
console.log(`\nstats: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
