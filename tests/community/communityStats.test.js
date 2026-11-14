/**
 * The community leaderboard rebuild (netlify/functions/lib/communityStats.js):
 *   - the same fields, under the same names, that CommunityStatsView and
 *     the landing page read (including `odubleserId`)
 *   - test users and their shows are left out, as on the admin Stats tab
 *   - only users/{uid}/shows counts, read with one collection-group query
 *
 *   node tests/community/communityStats.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { buildCommunityStats, rebuildCommunityStats } = require('../../netlify/functions/lib/communityStats');

const PROFILES = [
  { id: 'alice', firstName: 'Alice', photoURL: 'a.jpg', showCount: 3, songCount: 5, ratedSongCount: 4, venueCount: 2 },
  { id: 'bob', firstName: 'Bob', photoURL: '', showCount: 1, songCount: 2, ratedSongCount: 1, venueCount: 1 },
  { id: 'qa', firstName: 'QA', photoURL: '', showCount: 50, songCount: 500, ratedSongCount: 50, venueCount: 40, isTestUser: true },
];

const SHOWS = {
  alice: [
    { artist: 'Goose', venue: 'Red Rocks', city: 'Morrison', setlist: [
      { name: 'Arcadia', rating: 5 }, { name: 'Hot Tea (Live)', rating: 4 },
    ] },
    { artist: 'Goose', venue: 'Red Rocks', city: 'Morrison', setlist: [{ name: 'Arcadia', rating: 3 }] },
    { artist: 'Phish', venue: 'MSG', setlist: [{ name: 'Tweezer' }, { name: '' }, {}] },
  ],
  bob: [
    { artist: 'Goose', venue: 'Red Rocks', city: 'Morrison', setlist: [{ name: 'arcadia', rating: 4 }, { name: 'Hot Tea' }] },
  ],
  qa: [
    { artist: 'Test Band', venue: 'Test Hall', setlist: [{ name: 'Test Song', rating: 5 }, { name: 'Test Song', rating: 5 }] },
  ],
};

test('produces every field the app reads, in the old shape', () => {
  const s = buildCommunityStats(PROFILES, SHOWS);
  assert.deepStrictEqual(Object.keys(s).sort(), [
    'topShowsAttended', 'topSongsByRating', 'topSongsBySightings', 'topSongsRated',
    'topVenues', 'topVenuesVisited', 'totalShows', 'totalSongs', 'totalUsers',
  ]);
  assert.deepStrictEqual(s.topShowsAttended[0], { userId: 'alice', odubleserId: 'alice', firstName: 'Alice', photoURL: 'a.jpg', count: 3 });
  assert.deepStrictEqual(s.topSongsRated.map((u) => u.odubleserId), ['alice', 'bob']);
  // Both names, same value, on every entry (B-03): old builds read odubleserId.
  for (const list of [s.topShowsAttended, s.topSongsRated, s.topVenuesVisited]) {
    for (const u of list) assert.strictEqual(u.userId, u.odubleserId);
  }
  assert.deepStrictEqual(s.topVenuesVisited.map((u) => u.count), [2, 1]);
});

test('test users and their shows are left out', () => {
  const s = buildCommunityStats(PROFILES, SHOWS);
  assert.strictEqual(s.totalUsers, 2);
  assert.strictEqual(s.totalShows, 4);
  assert.strictEqual(s.totalSongs, 7);
  assert.ok(!s.topVenues.some((v) => v.venueName === 'Test Hall'));
  assert.ok(!s.topSongsByRating.some((v) => v.songName === 'Test Song'));
  assert.ok(!s.topShowsAttended.some((u) => u.odubleserId === 'qa'));
});

test('songs merge on normalized title; ratings need two votes', () => {
  const s = buildCommunityStats(PROFILES, SHOWS);
  const arcadia = s.topSongsBySightings.find((x) => x.songName === 'Arcadia');
  assert.deepStrictEqual(arcadia, { songName: 'Arcadia', userCount: 2, artists: ['Goose'] });
  const hotTea = s.topSongsBySightings.find((x) => x.songName === 'Hot Tea (Live)');
  assert.strictEqual(hotTea.userCount, 2);
  assert.deepStrictEqual(s.topSongsByRating, [
    { songName: 'Arcadia', avgRating: '4.0', ratingCount: 3, artists: ['Goose'] },
  ]);
});

test('venues count shows and distinct artists', () => {
  const s = buildCommunityStats(PROFILES, SHOWS);
  assert.deepStrictEqual(s.topVenues, [
    { venueName: 'Red Rocks, Morrison', showCount: 3, artistCount: 1 },
    { venueName: 'MSG', showCount: 1, artistCount: 1 },
  ]);
});

test('lists are capped at five', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `u${i}`, firstName: `U${i}`, showCount: i }));
  const s = buildCommunityStats(many, {});
  assert.strictEqual(s.topShowsAttended.length, 5);
  assert.strictEqual(s.topShowsAttended[0].count, 7);
});

// A minimal Admin-SDK-shaped fake: just what rebuildCommunityStats touches.
function fakeDb() {
  const ref = (path) => {
    const parts = path.split('/');
    const r = { id: parts[parts.length - 1], path };
    r.parent = parts.length > 1
      ? { id: parts[parts.length - 2], parent: parts.length > 2 ? ref(parts.slice(0, -2).join('/')) : null }
      : null;
    return r;
  };
  const snap = (path, data) => ({ id: ref(path).id, ref: ref(path), data: () => data });
  const showDocs = [
    snap('users/alice/shows/s1', SHOWS.alice[0]),
    snap('users/bob/shows/s2', SHOWS.bob[0]),
    snap('sharedCollections/c1/shows/x', { artist: 'Nope', venue: 'Elsewhere', setlist: [] }),
  ];
  const writes = [];
  return {
    writes,
    collection(name) {
      if (name === 'userProfiles') {
        return { get: async () => ({ docs: PROFILES.map((p) => { const { id, ...d } = p; return snap(`userProfiles/${id}`, d); }) }) };
      }
      return { doc: (id) => ({ set: async (data) => writes.push({ path: `${name}/${id}`, data }) }) };
    },
    collectionGroup(name) {
      assert.strictEqual(name, 'shows');
      return { get: async () => ({ forEach: (fn) => showDocs.forEach(fn) }) };
    },
  };
}

test('rebuild reads users/{uid}/shows only and writes communityStats/global', async () => {
  const db = fakeDb();
  await rebuildCommunityStats(db, { serverTimestamp: () => 'TS' });
  assert.strictEqual(db.writes.length, 1);
  const { path, data } = db.writes[0];
  assert.strictEqual(path, 'communityStats/global');
  assert.strictEqual(data.updatedAt, 'TS');
  assert.deepStrictEqual(data.topVenues, [{ venueName: 'Red Rocks, Morrison', showCount: 2, artistCount: 1 }]);
});

test('CommunityStatsView reads userId first and falls back to odubleserId', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../components/CommunityStatsView.jsx'), 'utf8');
  assert.ok(src.includes('const entryUid = (entry) => entry?.userId || entry?.odubleserId;'));
  assert.ok(!/user\.odubleserId/.test(src), 'every read goes through entryUid');
});

run('community leaderboard rebuild');
