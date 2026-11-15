/**
 * Unit tests for the pure parts of
 * netlify/functions/admin-merge-festivals.js — the clustering that finds
 * duplicate canonical festivals, and the difference report.
 *
 * The cases this file exists to protect:
 *
 *   1. Two editions of the same festival must never land in one cluster.
 *      Bonnaroo 2025 and Bonnaroo 2026 have identical names; only the date
 *      gate keeps them apart, and a merge tool that clustered them would
 *      offer an admin a one-click way to destroy a year of history.
 *
 *   2. Cluster membership must not chain. If A matches B and B matches C
 *      but A does not match C, a naive "matches any member" test puts all
 *      three together and the admin merges A into C — which the rule would
 *      have refused. Matching against the cluster's anchor is what stops
 *      that, and it is easy to "simplify" away, so it is pinned here.
 *
 * Run with:
 *   node lib/__tests__/festivalMerge.test.js
 */

const assert = require('assert');
const {
  clusterFestivals,
  differencesFrom,
} = require('../../netlify/functions/admin-merge-festivals.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

const fest = (id, name, startDate, endDate, extra = {}) => ({
  id,
  name,
  startDate,
  endDate,
  location: '',
  createdAt: null,
  ...extra,
});

const ids = cluster => cluster.members.map(m => m.id).sort();

console.log('\nnetlify/functions/admin-merge-festivals.js\n');

// ── Clustering ────────────────────────────────────────────────────────

test('a catalog with no duplicates produces no clusters', () => {
  const clusters = clusterFestivals([
    fest('a', 'Bonnaroo', '2026-06-11', '2026-06-14'),
    fest('b', 'Coachella', '2026-04-10', '2026-04-12'),
  ]);
  assert.strictEqual(clusters.length, 0);
});

test('a single festival never clusters with itself', () => {
  assert.strictEqual(clusterFestivals([fest('a', 'Bonnaroo', '2026-06-11', '2026-06-14')]).length, 0);
});

test('an empty catalog is handled', () => {
  assert.strictEqual(clusterFestivals([]).length, 0);
});

test('two spellings of one festival on the same dates cluster', () => {
  const clusters = clusterFestivals([
    fest('a', 'Outside Lands', '2011-08-12', '2011-08-14'),
    fest('b', 'Outside Lands Music & Arts Festival', '2011-08-12', '2011-08-14'),
  ]);
  assert.strictEqual(clusters.length, 1);
  assert.deepStrictEqual(ids(clusters[0]), ['a', 'b']);
});

test('THE ONE THAT MATTERS: two editions never cluster', () => {
  const clusters = clusterFestivals([
    fest('y25', 'Bonnaroo', '2025-06-11', '2025-06-14'),
    fest('y26', 'Bonnaroo', '2026-06-11', '2026-06-14'),
  ]);
  assert.strictEqual(clusters.length, 0, 'Bonnaroo 2025 and 2026 must never be offered as a merge');
});

test('three editions of one festival stay three separate things', () => {
  const clusters = clusterFestivals([
    fest('a', 'Bonnaroo', '2024-06-11', '2024-06-14'),
    fest('b', 'Bonnaroo', '2025-06-11', '2025-06-14'),
    fest('c', 'Bonnaroo', '2026-06-11', '2026-06-14'),
  ]);
  assert.strictEqual(clusters.length, 0);
});

test('duplicates within an edition cluster while other editions stay out', () => {
  const clusters = clusterFestivals([
    fest('dup1', 'Bonnaroo', '2026-06-11', '2026-06-14'),
    fest('dup2', 'The Bonnaroo Music & Arts Festival', '2026-06-12', '2026-06-15'),
    fest('other', 'Bonnaroo', '2025-06-11', '2025-06-14'),
  ]);
  assert.strictEqual(clusters.length, 1);
  assert.deepStrictEqual(ids(clusters[0]), ['dup1', 'dup2']);
});

test('membership does not chain across a pair the rule would refuse', () => {
  // a..b are 3 days apart (inside the gap), b..c another 3 (inside), but
  // a..c is 6 days apart with no overlap — the rule refuses a/c. Anchoring
  // on `a` keeps c out; a "matches any member" test would pull it in and
  // then offer merging a into c.
  const a = fest('a', 'Riverside', '2026-06-01', '2026-06-01');
  const b = fest('b', 'Riverside', '2026-06-04', '2026-06-04');
  const c = fest('c', 'Riverside', '2026-06-07', '2026-06-07');

  const rule = require('../festivalMatch.js');
  assert.strictEqual(rule.festivalsMatch(a, b), true, 'fixture: a matches b');
  assert.strictEqual(rule.festivalsMatch(b, c), true, 'fixture: b matches c');
  assert.strictEqual(rule.festivalsMatch(a, c), false, 'fixture: a must NOT match c');

  const clusters = clusterFestivals([a, b, c]);
  assert.strictEqual(clusters.length, 1);
  assert.deepStrictEqual(ids(clusters[0]), ['a', 'b'], 'c must not be dragged in via b');
});

test('the oldest festival anchors its cluster, whatever order it arrives in', () => {
  const older = fest('older', 'Outside Lands', '2011-08-12', '2011-08-14', {
    createdAt: '2011-01-01T00:00:00Z',
  });
  const newer = fest('newer', 'Outside Lands Music & Arts Festival', '2011-08-12', '2011-08-14', {
    createdAt: '2012-01-01T00:00:00Z',
  });

  [[older, newer], [newer, older]].forEach(input => {
    const clusters = clusterFestivals(input);
    assert.strictEqual(clusters.length, 1);
    assert.strictEqual(clusters[0].anchor.id, 'older', 'the earliest-created document anchors');
  });
});

test('a festival with a mistyped year clusters with nothing', () => {
  // The production record that caused the 2011-into-2008 mis-merge. It must
  // not be offered as a duplicate of anything.
  const clusters = clusterFestivals([
    fest('typo', 'Outside Lands', '0011-08-12', '2011-08-14'),
    fest('real2008', 'Outside Lands Music & Arts Festival', '2008-08-22', '2008-08-24'),
    fest('real2011', 'Outside Lands', '2011-08-12', '2011-08-14'),
  ]);
  const clustered = clusters.flatMap(c => c.members.map(m => m.id));
  assert.ok(!clustered.includes('typo'), 'an undateable record must cluster with nothing');
});

test('clustering is stable when createdAt is missing on every document', () => {
  const input = [
    fest('b', 'Bonnaroo', '2026-06-11', '2026-06-14'),
    fest('a', 'Bonnaroo Music and Arts Festival', '2026-06-11', '2026-06-14'),
  ];
  const first = clusterFestivals(input);
  const second = clusterFestivals(input.slice().reverse());
  assert.strictEqual(first[0].anchor.id, second[0].anchor.id, 'id breaks the tie deterministically');
});

// ── Differences ───────────────────────────────────────────────────────

test('identical festivals report no differences', () => {
  const a = fest('a', 'Bonnaroo', '2026-06-11', '2026-06-14');
  assert.deepStrictEqual(differencesFrom(a, { ...a, id: 'b' }), []);
});

test('a differing name, date and location are each reported', () => {
  const survivor = fest('a', 'Bonnaroo', '2026-06-11', '2026-06-14', { location: 'Manchester, TN' });
  const duplicate = fest('b', 'Bonnaroo Fest', '2026-06-12', '2026-06-15', { location: 'Nashville, TN' });
  const differences = differencesFrom(survivor, duplicate);
  assert.strictEqual(differences.length, 4);
  assert.ok(differences.some(d => d.startsWith('name ')));
  assert.ok(differences.some(d => d.startsWith('startDate ')));
  assert.ok(differences.some(d => d.startsWith('endDate ')));
  assert.ok(differences.some(d => d.startsWith('location ')));
});

test('a blank location against a filled one still counts as a difference to report', () => {
  // locationsAgree treats blank as "unknown" for MATCHING, deliberately.
  // Reporting is a different job: an admin choosing a survivor wants to see
  // that one copy has a location and the other does not.
  const survivor = fest('a', 'Bonnaroo', '2026-06-11', '2026-06-14', { location: '' });
  const duplicate = fest('b', 'Bonnaroo', '2026-06-11', '2026-06-14', { location: 'Manchester, TN' });
  assert.deepStrictEqual(differencesFrom(survivor, duplicate), ['location "Manchester, TN" vs ""']);
});

test('whitespace-only name differences are not reported', () => {
  const survivor = fest('a', 'Bonnaroo', '2026-06-11', '2026-06-14');
  const duplicate = fest('b', '  Bonnaroo  ', '2026-06-11', '2026-06-14');
  assert.deepStrictEqual(differencesFrom(survivor, duplicate), []);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
