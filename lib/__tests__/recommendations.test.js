/**
 * lib/recommendations.js: the band-affinity aggregation and the scores read
 * from it (Discover, "Fans of X also see…", festival picks).
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/recommendations.test.js
 */

import assert from 'assert';
import { createRequire } from 'module';
import { artistNameKeyLoose } from '@/lib/setlistSources';

const require = createRequire(import.meta.url);
const R = require('../recommendations.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

// A show `times` times, on different days.
function saw(artist, times = 1) {
  return Array.from({ length: times }, (_, i) => ({ artist, date: `2024-01-${String(i + 1).padStart(2, '0')}` }));
}
function user({ favorites = [], shows = [] } = {}) {
  return { favorites: favorites.map((name) => ({ name })), shows };
}
function docsFor(agg, seeds) {
  const out = {};
  for (const s of seeds) if (agg.affinity[s.key]) out[s.key] = agg.affinity[s.key];
  return out;
}
function discoverFor(agg, me, extra = {}) {
  const bands = R.profileBands(me);
  const seeds = R.seedsFor(bands);
  return R.recommend({ seeds, affinityDocs: docsFor(agg, seeds), bands, ...extra });
}

// The spec's example: 10 users favorite or see Goose a lot. 6 of them see a
// small band, Niche, often (and 2 other users do). 8 of them see Phish often,
// and so do 30 people who don't care about Goose.
function gooseWorld() {
  const users = [];
  for (let i = 0; i < 10; i++) {
    const shows = [...saw('Goose', 2)];
    if (i < 6) shows.push(...saw('Niche', 2));
    if (i < 8) shows.push(...saw('Phish', 3));
    users.push(user({ favorites: i % 2 ? ['Goose'] : [], shows }));
  }
  for (let i = 0; i < 30; i++) users.push(user({ shows: saw('Phish', 2) }));
  for (let i = 0; i < 2; i++) users.push(user({ shows: saw('Niche', 2) }));
  return users;
}

console.log('recommendations');

test('the Goose example ranks the niche band above Phish', () => {
  const users = gooseWorld();
  const me = user({ favorites: ['Goose'] });
  const agg = R.aggregate([...users, me]);
  const recs = discoverFor(agg, me);
  const names = recs.map((r) => r.name);
  assert.ok(names.includes('Niche'), `Niche missing from ${names}`);
  assert.ok(names.includes('Phish'), `Phish missing from ${names}`);
  assert.ok(names.indexOf('Niche') < names.indexOf('Phish'), `order was ${names}`);
  assert.deepStrictEqual(recs[0].because, ['Goose']);
});

test('the stored candidates are ordered the same way', () => {
  const agg = R.aggregate(gooseWorld());
  const goose = agg.affinity.goose;
  assert.strictEqual(goose.fans, 10);
  assert.deepStrictEqual(goose.candidates.map((c) => c.key), ['niche', 'phish']);
  assert.strictEqual(goose.candidates.find((c) => c.key === 'phish').co, 8);
});

test('POPULARITY_DAMPING of 0 ignores popularity (Phish wins on raw share)', () => {
  const s = (co, seen2) => R.pairScore({ co, fans: 10, seen2, totalActiveUsers: 42, damping: 0 });
  assert.ok(s(8, 38) > s(6, 8));
});

test('a followed seed counts more than a band seen once', () => {
  assert.strictEqual(R.seedWeight({ favorite: true, timesSeen: 0 }), R.FAVORITE_WEIGHT);
  assert.strictEqual(R.seedWeight({ favorite: false, timesSeen: 1 }), R.SEEN_WEIGHT);
  assert.ok(R.seedWeight({ favorite: true }) > R.seedWeight({ timesSeen: 1 }));

  // Two seeds with identical affinity data: the followed one decides the reason.
  const users = [];
  for (let i = 0; i < 4; i++) users.push(user({ shows: [...saw('Alpha', 2), ...saw('Target', 2)] }));
  for (let i = 0; i < 4; i++) users.push(user({ shows: [...saw('Beta', 2), ...saw('Other', 2)] }));
  const agg = R.aggregate(users);
  const me = user({ favorites: ['Beta'], shows: saw('Alpha', 1) });
  const recs = discoverFor(agg, me);
  assert.deepStrictEqual(recs.map((r) => r.name), ['Other', 'Target']);
});

test('the repeat bonus is capped', () => {
  const capped = R.SEEN_WEIGHT * (1 + R.MAX_REPEAT_BONUS);
  assert.strictEqual(R.seedWeight({ timesSeen: 100 }), capped);
  assert.ok(R.seedWeight({ timesSeen: 3 }) > R.seedWeight({ timesSeen: 1 }));
});

test('bands the user has seen never appear, even once', () => {
  const users = gooseWorld();
  const me = user({ favorites: ['Goose'], shows: saw('Niche', 1) });
  const agg = R.aggregate([...users, me]);
  const names = discoverFor(agg, me).map((r) => r.name);
  assert.ok(!names.includes('Niche'));
  assert.ok(!names.includes('Goose'));
});

test('followed bands never appear', () => {
  const me = user({ favorites: ['Goose', 'Phish'] });
  const agg = R.aggregate([...gooseWorld(), me]);
  const names = discoverFor(agg, me).map((r) => r.name);
  assert.ok(!names.includes('Phish'));
});

test('dismissed bands never appear', () => {
  const me = user({ favorites: ['Goose'] });
  const agg = R.aggregate([...gooseWorld(), me]);
  const names = discoverFor(agg, me, { dismissed: ['niche'] }).map((r) => r.name);
  assert.deepStrictEqual(names, ['Phish']);
});

test('pairs under MIN_CO_FANS are never stored', () => {
  const users = [];
  for (let i = 0; i < 5; i++) {
    const shows = saw('Goose', 2);
    if (i < R.MIN_CO_FANS - 1) shows.push(...saw('Tiny', 2));
    users.push(user({ shows }));
  }
  const agg = R.aggregate(users);
  assert.strictEqual(agg.affinity.goose, undefined);
  assert.strictEqual(agg.popularity.tiny, undefined);
  for (const doc of Object.values(agg.affinity)) {
    for (const c of doc.candidates) assert.ok(c.co >= R.MIN_CO_FANS);
  }
});

test('a pair under MIN_CO_FANS in a doc is ignored when read', () => {
  const bands = R.profileBands(user({ favorites: ['Goose'] }));
  const seeds = R.seedsFor(bands);
  const doc = { name: 'Goose', fans: 9, candidates: [{ key: 'tiny', name: 'Tiny', co: 2, pairScore: 5 }] };
  assert.deepStrictEqual(R.recommend({ seeds, affinityDocs: { goose: doc }, bands }), []);
  assert.deepStrictEqual(R.alsoSee(doc), []);
});

test('nothing stored identifies a user', () => {
  const agg = R.aggregate(gooseWorld());
  const json = JSON.stringify({ a: agg.affinity, p: agg.popularity });
  assert.ok(!/uid|email|user/i.test(json));
});

test('a user who saw a band 40 times counts once', () => {
  const users = [user({ shows: [...saw('Goose', 2), ...saw('Small', 28)] })];
  for (let i = 0; i < 2; i++) users.push(user({ shows: [...saw('Goose', 2), ...saw('Small', 2)] }));
  const agg = R.aggregate(users);
  assert.strictEqual(agg.popularity.small.seen2, 3);
  assert.strictEqual(agg.affinity.goose.candidates[0].co, 3);
});

test('two docs for the same night count as one show', () => {
  const bands = R.profileBands({ shows: [{ artist: 'Goose', date: '2024-05-01' }, { artist: 'goose', date: '2024-05-01' }] });
  assert.strictEqual(bands.get('goose').timesSeen, 1);
});

test('artist-key normalization merges duplicates before counting', () => {
  const spellings = ['Goose', 'Goose (US)', 'goose ', 'The Goose'];
  for (const s of spellings) assert.strictEqual(R.bandKey(s), 'goose');
  // One user per spelling, each seeing "Goose" twice and Niche twice:
  // four fans of one band, not one fan each of four bands.
  const users = spellings.map((s) => user({ shows: [{ artist: s, date: '2024-01-01' }, { artist: s, date: '2024-01-02' }, ...saw('Niche', 2)] }));
  const agg = R.aggregate(users);
  assert.strictEqual(agg.affinity.goose.fans, 4);
  assert.strictEqual(Object.keys(agg.affinity).length, 2); // goose and niche
});

test('bandKey matches lib/setlistSources.js artistNameKeyLoose', () => {
  const names = [
    'Goose', 'Goose (US)', 'The Goose', 'Goose [live]', "Umphrey's McGee", 'AC/DC',
    'Billy Strings & Friends', '  The Disco Biscuits  ', 'moe.', 'Sigur Rós', 'King Gizzard & the Lizard Wizard',
    '', 'The The', 'Dogs In A Pile {acoustic}',
  ];
  for (const n of names) assert.strictEqual(R.bandKey(n), artistNameKeyLoose(n), `differs for "${n}"`);
});

test('every stored key is a usable Firestore document id', () => {
  for (const n of ['AC/DC', 'moe.', '__init__', '..', 'Sigur Rós']) {
    const k = R.bandKey(n);
    assert.ok(!k.includes('/') && !k.includes('.') && !/^__.*__$/.test(k), `bad key "${k}"`);
  }
  assert.strictEqual(R.bandKey('ザ・クロマニヨンズ'), '');
});

test('a user with no shows gets nothing and is not an active user', () => {
  const me = user();
  const agg = R.aggregate([...gooseWorld(), me]);
  assert.strictEqual(agg.totalActiveUsers, 42);
  assert.deepStrictEqual(discoverFor(agg, me), []);
});

test('a seed with no affinity doc is skipped, not an error', () => {
  const me = user({ favorites: ['Nobody Knows Them', 'Goose'] });
  const agg = R.aggregate([...gooseWorld(), me]);
  assert.ok(discoverFor(agg, me).length > 0);
});

test('only the heaviest MAX_SEED_READS seeds are read', () => {
  const favorites = Array.from({ length: R.MAX_SEED_READS }, (_, i) => `Band ${i}`);
  const bands = R.profileBands(user({ favorites, shows: saw('Goose', 1) }));
  const seeds = R.seedsFor(bands);
  assert.strictEqual(seeds[seeds.length - 1].name, 'Goose'); // seen once is lightest
  const doc = { candidates: [{ key: 'niche', name: 'Niche', co: 5, pairScore: 1 }] };
  assert.deepStrictEqual(R.recommend({ seeds, affinityDocs: { goose: doc }, bands }), []);
});

test('the reason names the top two contributing seeds', () => {
  const me = user({ favorites: ['Goose', "Umphrey's McGee"], shows: saw('Phish', 1) });
  const bands = R.profileBands(me);
  const seeds = R.seedsFor(bands);
  const docs = {
    goose: { candidates: [{ key: 'niche', name: 'Niche', co: 5, pairScore: 0.5 }] },
    'umphreys-mcgee': { candidates: [{ key: 'niche', name: 'Niche', co: 4, pairScore: 0.4 }] },
    // Seen once (weight 1.0), so it contributes 0.3 against 1.0 and 0.8.
    phish: { candidates: [{ key: 'niche', name: 'Niche', co: 3, pairScore: 0.3 }] },
  };
  const [rec] = R.recommend({ seeds, affinityDocs: docs, bands });
  assert.deepStrictEqual(rec.because, ['Goose', "Umphrey's McGee"]);
  assert.strictEqual(R.becauseText(rec.because), "Because you like Goose and Umphrey's McGee");
});

test('alsoSee drops bands the viewer has seen', () => {
  const doc = { candidates: [{ key: 'niche', name: 'Niche', co: 6, pairScore: 1 }, { key: 'phish', name: 'Phish', co: 8, pairScore: 0.6 }] };
  const bands = R.profileBands(user({ shows: saw('Phish', 1) }));
  assert.deepStrictEqual(R.alsoSee(doc, bands).map((c) => c.key), ['niche']);
  assert.strictEqual(R.alsoSee(doc).length, 2);
});

test('festival picks split the lineup into three groups', () => {
  const me = user({ favorites: ['Goose'], shows: [...saw('Trey Anastasio Band', 2), ...saw('Phish', 1)] });
  const agg = R.aggregate([...gooseWorld(), me]);
  const bands = R.profileBands(me);
  const seeds = R.seedsFor(bands);
  const picks = R.festivalPicks({
    lineup: ['Goose', 'Niche', 'Phish', 'Trey Anastasio Band', 'Zebra Band', 'Aardvark', 'goose '],
    seeds,
    affinityDocs: docsFor(agg, seeds),
    bands,
  });
  assert.deepStrictEqual(picks.recommended.map((p) => p.name), ['Niche']);
  // Phish, seen once, is a lighter seed that also points at Niche.
  assert.deepStrictEqual(picks.recommended[0].because, ['Goose', 'Phish']);
  assert.deepStrictEqual(picks.love.map((p) => p.name).sort(), ['Goose', 'Trey Anastasio Band']);
  // Phish seen once -> everyone else with a badge; no-data bands kept, alphabetical.
  assert.deepStrictEqual(picks.everyoneElse.map((p) => p.name), ['Aardvark', 'Phish', 'Zebra Band']);
  assert.strictEqual(picks.everyoneElse.find((p) => p.name === 'Phish').seenOnce, true);
});

test('festival picks with no lineup are three empty groups', () => {
  assert.deepStrictEqual(R.festivalPicks({}), { recommended: [], love: [], everyoneElse: [] });
});

test('a dismissed band stays on the festival lineup', () => {
  const me = user({ favorites: ['Goose'] });
  const agg = R.aggregate([...gooseWorld(), me]);
  const bands = R.profileBands(me);
  const seeds = R.seedsFor(bands);
  const picks = R.festivalPicks({ lineup: ['Niche'], seeds, affinityDocs: docsFor(agg, seeds), bands, dismissed: ['niche'] });
  assert.deepStrictEqual(picks.everyoneElse.map((p) => p.name), ['Niche']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
