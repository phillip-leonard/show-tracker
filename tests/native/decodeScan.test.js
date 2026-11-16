/**
 * scripts/scan-show-decode.js's checker (5.60.15): it must pass every
 * variant the Swift models accept (ProductionVariantTests) and flag what
 * they refuse, or its "0 failures" against production means nothing.
 *
 *   node tests/native/decodeScan.test.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { checkDocument, SCHEMAS } = require('../../scripts/scan-show-decode');

const ts = { seconds: 1763121600, nanoseconds: 0, toDate: () => new Date(1763121600000) };
const base = { artist: 'Goose', venue: 'Red Rocks', city: 'Morrison', date: '2024-06-21', setlist: [] };
const show = (fields) => checkDocument(SCHEMAS.shows, { ...base, ...fields });

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('every fixtures/shows expected document passes, with nothing unknown', () => {
  const dir = path.join(__dirname, '..', '..', 'fixtures', 'shows');
  for (const f of fs.readdirSync(dir)) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).expected.show;
    if (!doc) continue;
    const r = checkDocument(SCHEMAS.shows, doc);
    assert.deepStrictEqual(r.failures, [], f);
    assert.deepStrictEqual(r.unknown, [], f);
  }
});

test('every stored show in fixtures/year-in-review passes', () => {
  const dir = path.join(__dirname, '..', '..', 'fixtures', 'year-in-review');
  for (const f of fs.readdirSync(dir)) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const s of fx.shows) assert.deepStrictEqual(checkDocument(SCHEMAS.shows, s).failures, [], f);
    if (fx.expected.yearInReview) {
      const r = checkDocument(SCHEMAS.yearInReviews, { userId: 'u', year: fx.year, stats: fx.expected.yearInReview, recap: fx.expected.recap });
      assert.deepStrictEqual(r.failures, [], `${f} yearInReview and recap`);
      assert.deepStrictEqual(r.unknown, [], `${f} nothing unread`);
    }
  }
});

test('the production variants pass (as ProductionVariantTests decodes them)', () => {
  for (const fields of [
    { id: '1700000000001' },
    { createdAt: ts }, { createdAt: '2025-11-14T12:00:00.000Z' }, { createdAt: null },
    { tour: null }, { tour: '' }, { country: '' }, { artistMbid: '' }, { festivalId: null }, { needsReviewReason: null },
    { rating: 8 }, { rating: 7.6 }, { rating: null }, { venueRating: 4 },
    { dateNormalizedFrom: '21-06-2024', importedByAdmin: true, artistImage: 'x', setlistScanAt: 'x', normalizedVersion: 1 },
    { setlist: [{ id: '1', name: 'A', set: 'Set I', cover: null, tape: false }, { id: '2', name: 'B' }, { id: '3', name: '', setBreak: null, sourceGap: 12 }] },
    { taggedFriendUids: ['a'], taggedBy: 'A', taggedByUid: 'a' },
  ]) {
    const r = show(fields);
    assert.deepStrictEqual(r.failures, [], JSON.stringify(Object.keys(fields)));
    assert.deepStrictEqual(r.unknown, [], JSON.stringify(Object.keys(fields)));
  }
  const profile = checkDocument(SCHEMAS.userProfiles, { favoriteArtists: [{ name: 'Goose', mbid: 'x', addedAt: 'y' }, 'Phish'], showCount: 3, odubleserId: 'u' });
  assert.deepStrictEqual(profile.failures, []);
  assert.deepStrictEqual(profile.unknown, []);
  assert.deepStrictEqual(checkDocument(SCHEMAS.userStats, { avgShowRating: '8.3', showsByYear: { 2025: 2 } }).failures, []);
  assert.deepStrictEqual(checkDocument(SCHEMAS.userStats, { avgShowRating: 8.3 }).failures, []);
  assert.deepStrictEqual(checkDocument(SCHEMAS.communityStats, { topShowsAttended: [{ odubleserId: 'u', count: 3 }], topSongsByRating: [{ songName: 'x', avgRating: '9.5', ratingCount: 2, artists: [] }] }).failures, []);
  assert.deepStrictEqual(checkDocument(SCHEMAS.showTags, { fromUid: 'a', fromName: 'A', toUid: 'b', status: 'pending', showData: { artist: 'G', venue: 'V', city: 'C', date: '21-06-2024', tour: '', setlist: [{ id: '1', name: '' }] } }).failures, []);
});

test('every fixtures/user-stats expected document passes, with nothing unknown (5.60.27)', () => {
  const dir = path.join(__dirname, '..', '..', 'fixtures', 'user-stats');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const { expected } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const r = checkDocument(SCHEMAS.userStats, { ...expected, ranked: false, rank: null, rankedOf: null });
    assert.deepStrictEqual(r.failures, [], f);
    assert.deepStrictEqual(r.unknown, [], f);
  }
});

test('the shapes the models refuse are failures', () => {
  assert.deepStrictEqual(show({ artist: 42 }).failures, ['artist: not a string (number)']);
  assert.deepStrictEqual(show({ setlist: 'Arcadia' }).failures, ['setlist: not a list (string)']);
  assert.deepStrictEqual(show({ rating: 'great' }).failures, ['rating: not a number (string)']);
  assert.deepStrictEqual(show({ setlist: [{ id: '1', name: 'A', sourceGap: 1.5 }] }).failures, ['setlist[].sourceGap: not a whole number (number)']);
  assert.deepStrictEqual(show({ createdAt: 12345 }).failures, ['createdAt: not a Timestamp or string (number)']);
  assert.deepStrictEqual(show({ needsReviewReason: { overlap: 0.5 } }).failures, ['needsReviewReason.with: missing']);
  assert.deepStrictEqual(checkDocument(SCHEMAS.userStats, { avgShowRating: 'high' }).failures, ['avgShowRating: not a number or numeric string (string)']);
  assert.deepStrictEqual(checkDocument(SCHEMAS.showTags, { fromUid: 'a' }).failures, ['showData: missing']);
  assert.deepStrictEqual(checkDocument(SCHEMAS.yearInReviews, { userId: 'u' }).failures, ['year: missing']);
  assert.ok(checkDocument(SCHEMAS.publicUserStats, { songCount: 1, ratedSongCount: 1, venueCount: 1 }).failures.includes('showCount: missing'));
});

test('notes, not failures: unreadable show dates, legacy tag dates, odd ISO strings, unknown fields', () => {
  assert.deepStrictEqual(show({ date: 'sometime in 2025' }).notes, ['date: does not read as a day']);
  assert.deepStrictEqual(show({ createdAt: 'yesterday' }).notes, ['createdAt: string that is not an ISO moment (reads as no date)']);
  assert.deepStrictEqual(show({ brandNewField: 1 }).unknown, ['brandNewField']);
  const tag = checkDocument(SCHEMAS.showTags, { showData: { artist: 'G', venue: 'V', city: 'C', date: '21-06-2024' } });
  assert.deepStrictEqual(tag.notes, ['showData.date: legacy format (reads)']);
});

test('the scan never prints document values: failures name a path and a type', () => {
  const r = show({ artist: { secret: 'alice@example.com' }, comment: 7 });
  assert.ok(r.failures.every((f) => !f.includes('alice') && !f.includes('@')));
});

let passed = 0;
let failed = 0;
for (const c of cases) {
  try { c.fn(); passed++; console.log(`  ✓ ${c.name}`); } catch (e) { failed++; console.error(`  ✗ ${c.name}\n    ${e.message}`); }
}
console.log(`decodeScan: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
