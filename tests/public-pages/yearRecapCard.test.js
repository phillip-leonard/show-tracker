/**
 * The Year in Review recap card and its /p/ share page
 * (netlify/functions/lib/yearRecapCard.js), and how myPosters.js stores
 * a recap beside the personal posters.
 *
 *   node tests/public-pages/yearRecapCard.test.js
 */

const assert = require('assert');
const card = require('../../netlify/functions/lib/yearRecapCard');
const posters = require('../../netlify/functions/lib/myPosters');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err.stack || err.message}`);
  }
}

const INPUT = {
  year: 2026, shows: 12, bands: 5, venues: 7, songsHeard: 140, newBands: 2,
  topBands: [{ name: 'Goose', shows: 6 }, { name: 'Phish', shows: 3 }],
  topSongs: [{ name: 'Hot Tea', artist: 'Goose', count: 5 }],
  rarest: { name: 'Feel It Now', band: 'Goose', timesPlayed: 3, slug: 'goose' },
  bustOuts: [{ name: 'Slow Ready', band: 'Goose', gap: 140, date: '2026-06-20', venue: 'Red Rocks' }],
  busiestMonth: { month: 5, name: 'June', shows: 4 },
  longestRun: { artist: 'Phish', venue: 'MSG', nights: 4, key: 'x' },
  updatedThrough: '2026-12-31',
  // None of these may survive:
  email: 'someone@example.com',
  uid: 'u1',
  notes: 'private',
  buddy: { firstName: 'Mallory', shows: 9 },
  noSetlist: [{ id: 'show1', artist: 'X' }],
};

(async () => {
  await test('cleanRecap keeps the listed fields and drops everything else', () => {
    const r = card.cleanRecap(INPUT);
    assert.deepStrictEqual(Object.keys(r).sort(), [
      'bands', 'buddy', 'busiestMonth', 'bustOuts', 'longestRun', 'newBands', 'rarest', 'shows', 'songsHeard',
      'topBands', 'topSongs', 'type', 'updatedThrough', 'venues', 'year',
    ]);
    const json = JSON.stringify(r);
    for (const secret of ['someone@example.com', 'u1', 'private', 'show1']) assert.ok(!json.includes(secret), secret);
    assert.deepStrictEqual(r.rarest, { name: 'Feel It Now', band: 'Goose', timesPlayed: 3 });
    assert.deepStrictEqual(r.longestRun, { artist: 'Phish', venue: 'MSG', nights: 4 });
    assert.strictEqual(card.cleanRecap({ year: 2026, shows: 0 }), null);
    assert.strictEqual(card.cleanRecap(null), null);
  });

  await test('withBuddy never trusts a buddy name from the request', async () => {
    const r = await card.withBuddy(INPUT, { uid: 'me' }, null);
    assert.strictEqual(r.buddy, null);
  });

  await test('withBuddy adds the first name only when the lookup allows it', async () => {
    const lookup = async (uid, buddyUid) => (uid === 'me' && buddyUid === 'ann' ? { firstName: 'Ann' } : null);
    const yes = await card.withBuddy(INPUT, { uid: 'me', buddyUid: 'ann', buddyShows: 6 }, lookup);
    assert.deepStrictEqual(yes.buddy, { firstName: 'Ann', shows: 6 });
    const no = await card.withBuddy(INPUT, { uid: 'me', buddyUid: 'bo', buddyShows: 6 }, lookup);
    assert.strictEqual(no.buddy, null);
  });

  await test('the Firestore lookup requires a friend with a public profile', async () => {
    const docs = {
      'users/me/friends/ann': { firstName: 'x' },
      'userProfiles/ann': { publicProfile: true, firstName: 'Ann', displayName: 'Ann Smith' },
      'users/me/friends/bo': {},
      'userProfiles/bo': { publicProfile: false, firstName: 'Bo' },
      'userProfiles/cy': { publicProfile: true, displayName: 'Cy Young' },
    };
    const db = { doc: (path) => ({ get: async () => ({ exists: path in docs, data: () => docs[path] }) }) };
    const lookup = card.firestoreBuddyLookup(db);
    assert.deepStrictEqual(await lookup('me', 'ann'), { firstName: 'Ann' });
    assert.strictEqual(await lookup('me', 'bo'), null, 'private profile');
    assert.strictEqual(await lookup('me', 'cy'), null, 'not a friend');
    assert.strictEqual(await lookup('me', '../x'), null, 'bad id');
  });

  await test('recapSvg draws every size, buddy only when set', () => {
    const r = card.cleanRecap({ ...INPUT, buddy: null });
    for (const kind of ['story', 'feed', 'card']) {
      const svg = card.recapSvg(r, kind);
      assert.ok(svg.startsWith('<svg'), kind);
      assert.ok(svg.includes('mysetlists.net'), kind);
      // References nothing outside itself: no URL for the renderer to fetch (5.59.12).
      assert.ok(!/<image\b|<use\b|<foreignObject\b|xlink:href|\shref=|url\(\s*['"]?(https?:|\/\/|file:)/i.test(svg), `${kind} references nothing external`);
    }
    assert.ok(!card.recapSvg(r, 'story').includes('SHOW BUDDY'));
    assert.ok(card.recapSvg({ ...r, buddy: { firstName: 'Ann', shows: 6 } }, 'story').includes('SHOW BUDDY'));
    assert.ok(card.recapSvg(r, 'story').includes('RAREST CATCH'));
  });

  await test('the share page is noindex, links to make your own, names no buddy unless set', () => {
    const r = card.cleanRecap({ ...INPUT, buddy: null });
    const res = card.renderRecapPage(r, 'abcdefghijkl');
    assert.strictEqual(res.statusCode, 200);
    assert.match(res.headers['X-Robots-Tag'], /noindex/);
    assert.match(res.body, /<meta name="robots" content="noindex, follow">/);
    assert.match(res.body, /og:image" content="https:\/\/mysetlists\.net\/p\/abcdefghijkl\/og\.png"/);
    assert.match(res.body, /Make your own 2026 recap/);
    assert.match(res.body, /\/year-in-review\/\?year=2026/);
    assert.ok(!res.body.includes('Mallory'));
    assert.ok(!res.body.includes('Show buddy'));
  });

  await test('a recap and a poster share the store and are told apart', async () => {
    const mem = new Map();
    const store = { get: async (k) => mem.get(k) || null, set: async (k, v) => { mem.set(k, v); } };
    const recap = card.cleanRecap(INPUT);
    const rc = await posters.storeRecap(store, recap);
    const entry = await posters.loadEntry(store, rc);
    assert.strictEqual(entry.type, 'recap');
    assert.strictEqual(entry.recap.shows, 12);
    assert.strictEqual(await posters.loadRecord(store, rc), null, 'a recap is not a poster record');

    const record = { name: 'Goose', shows: 2, songs: [{ name: 'Hot Tea', count: 2 }] };
    const pc = await posters.storeRecord(store, record);
    assert.strictEqual((await posters.loadEntry(store, pc)).type, 'poster');
    assert.strictEqual((await posters.loadRecord(store, pc)).name, 'Goose');
  });

  console.log(`yearRecapCard: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
