/**
 * The followed-band job (netlify/functions/lib/followedBandAlerts.js) and
 * its unfollow link (netlify/functions/unfollow-band.js), end to end
 * against an in-memory Firestore and a fake Ticketmaster:
 *   - tour detection: a batch of new dates, never the first run
 *   - bucket-list venue matching
 *   - dedup: running the job again (or after a crash) tells nobody twice
 *   - every email carries the unsubscribe footer and an unfollow link,
 *     and the unfollow link works
 *
 *   node tests/notifications/followedBands.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestTransport, sendNotificationEmail } = require('../../netlify/functions/lib/outgoingEmail');
const { verify: verifyUnsubscribe } = require('../../netlify/functions/lib/unsubscribeToken');
const { signUnfollow, verifyUnfollow } = require('../../netlify/functions/lib/unfollowToken');
const alerts = require('../../netlify/functions/lib/followedBandAlerts');
const unfollow = require('../../netlify/functions/unfollow-band').handler;

const {
  artistKey, ledgerId, venueKeyFor, newEventsSince, isNewTour, planAlerts, runFollowedBandJob, LEDGER_COLLECTION,
} = alerts;

const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com' };
const BOB = { uid: 'bobUid00000001', email: 'bob@example.com' };

const ev = (id, date, venue, city) => ({ id, date, venue, city, url: `https://tm.example/${id}` });
const SUMMER = [
  ev('e1', '2027-06-01', 'Red Rocks Amphitheatre', 'Morrison'),
  ev('e2', '2027-06-02', 'Red Rocks Amphitheatre', 'Morrison'),
];
const FALL_TOUR = [
  ev('e3', '2027-10-01', 'Madison Square Garden', 'New York'),
  ev('e4', '2027-10-02', 'Madison Square Garden', 'New York'),
  ev('e5', '2027-10-04', 'The Gorge Amphitheatre', 'George'),
];

function setup({ goose = SUMMER } = {}) {
  const db = createFakeDb();
  __setTestFirebase({ db });
  db._put(`userProfiles/${ALICE.uid}`, {
    email: ALICE.email,
    favoriteArtists: [{ name: 'Goose', mbid: null, addedAt: '2026-01-01' }],
  });
  db._put(`userProfiles/${BOB.uid}`, {
    email: BOB.email,
    favoriteArtists: [{ name: 'goose ', mbid: null, addedAt: '2026-01-01' }],
    notificationPrefs: { followedBands: { enabled: false } },
  });
  // Alice wants to see anything at the Gorge.
  db._put(`bucketListVenues/${ALICE.uid}_the gorge amphitheatre::george`, {
    userId: ALICE.uid, venueKey: venueKeyFor('The Gorge Amphitheatre', 'George'), venueName: 'The Gorge Amphitheatre',
  });

  const sent = [];
  __setTestTransport((path, payload) => { sent.push(payload); return { status: 200, body: '{"id":"x"}' }; });

  const state = { goose };
  const job = (extra = {}) => runFollowedBandJob({
    db,
    fetchEvents: async () => ({ events: state.goose, attractionId: 'K8vZ9171' }),
    sendEmail: (msg) => sendNotificationEmail({ db, ...msg }),
    sendPush: null,
    createdAt: new Date('2026-10-21T13:30:00Z'),
    ...extra,
  });
  return { db, sent, state, job };
}

const notifications = (db) => db._list('notifications');

// ── Pure rules ───────────────────────────────────────────────────────────

test('a band typed two ways is one band, with a doc-id-safe ledger id', () => {
  assert.strictEqual(artistKey('  Goose '), 'goose');
  assert.strictEqual(ledgerId('ac/dc'), ledgerId(artistKey('AC/DC')));
  assert.ok(/^[a-f0-9]{32}$/.test(ledgerId('ac/dc')));
});

test('the first look at a band is a baseline: nothing is new', () => {
  const r = newEventsSince(null, FALL_TOUR);
  assert.strictEqual(r.baseline, true);
  assert.deepStrictEqual(r.newEvents, []);
});

test('only ids not already seen are new', () => {
  const r = newEventsSince({ seenEventIds: ['e1', 'e2'] }, [...SUMMER, ...FALL_TOUR]);
  assert.deepStrictEqual(r.newEvents.map((e) => e.id), ['e3', 'e4', 'e5']);
});

test('a tour is three or more new dates; one or two is not', () => {
  assert.strictEqual(isNewTour(FALL_TOUR.slice(0, 2)), false);
  assert.strictEqual(isNewTour(FALL_TOUR), true);
});

test('a show at a bucket-list venue matches by name and city, case-insensitively', () => {
  const planned = planAlerts({
    band: { key: 'goose', name: 'Goose' },
    events: [ev('x', '2027-01-01', 'the gorge amphitheatre ', 'GEORGE')],
    newEvents: [],
    baseline: false,
    followers: [{ uid: 'u', profile: {}, venueKeys: new Set(['the gorge amphitheatre::george']) }],
  });
  assert.deepStrictEqual(planned.map((a) => a.id), ['venueMatch_u_x']);
});

test('turning off band alerts or bucket-list alerts is respected', () => {
  const planned = planAlerts({
    band: { key: 'goose', name: 'Goose' },
    events: FALL_TOUR,
    newEvents: FALL_TOUR,
    baseline: false,
    followers: [{
      uid: 'u',
      profile: { notificationPrefs: { followedBands: { enabled: false }, venueBucketList: { enabled: false } } },
      venueKeys: new Set([venueKeyFor('The Gorge Amphitheatre', 'George')]),
    }],
  });
  assert.deepStrictEqual(planned, []);
});

// ── The job, run more than once ─────────────────────────────────────────

test('day one is a silent baseline for the band', async () => {
  const { db, sent, job } = setup();
  const totals = await job();
  assert.strictEqual(totals.baselines, 1);
  assert.strictEqual(notifications(db).length, 0);
  assert.strictEqual(sent.length, 0);
  const ledger = db._get(`${LEDGER_COLLECTION}/${ledgerId('goose')}`);
  assert.deepStrictEqual(ledger.seenEventIds.sort(), ['e1', 'e2']);
  assert.strictEqual(ledger.tmAttractionId, 'K8vZ9171');
});

test('a new tour with a bucket-list date: one notification and one email each, then nothing on the rerun', async () => {
  const { db, sent, state, job } = setup();
  await job(); // baseline: the summer dates
  state.goose = [...SUMMER, ...FALL_TOUR]; // the fall tour is announced

  await job();
  const after1 = notifications(db);
  // Alice: the tour, and the Gorge date as an in-app bucket-list match.
  // Bob has band alerts off and no bucket list, so nothing.
  assert.deepStrictEqual(after1.map((n) => n.type).sort(), ['followed_band_tour', 'venue_bucket_list_match']);
  assert.ok(after1.every((n) => n.uid === ALICE.uid));
  const tour = after1.find((n) => n.type === 'followed_band_tour');
  assert.strictEqual(tour.dateCount, 3);
  assert.strictEqual(sent.length, 1, 'the bucket-list date rides in the tour email, not a second one');
  assert.strictEqual(sent[0].to, ALICE.email);
  assert.match(sent[0].subject, /Goose announced 3 new dates — including one on your bucket list/);
  assert.match(sent[0].html, /on your bucket list/);

  // Run it again, twice: nothing new is written and nobody is emailed.
  const again = await job();
  await job();
  assert.strictEqual(notifications(db).length, 2);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(again.created, 0);
});

test('a run that dies after alerting but before saving the ledger does not alert again', async () => {
  const { db, sent, state, job } = setup();
  await job();
  state.goose = [...SUMMER, ...FALL_TOUR];

  // Fail the ledger write once, after the alerts went out.
  const realCollection = db.collection;
  let failed = false;
  db.collection = (name) => {
    const col = realCollection(name);
    if (name !== LEDGER_COLLECTION || failed) return col;
    return { ...col, doc: (id) => ({ ...col.doc(id), set: async () => { failed = true; throw new Error('deadline exceeded'); } }) };
  };
  await assert.rejects(job());
  db.collection = realCollection;
  assert.strictEqual(sent.length, 1);

  // Next morning the same three dates still look new, but every alert id
  // already exists.
  const r = await job();
  assert.strictEqual(r.duplicates, 2);
  assert.strictEqual(sent.length, 1);
});

test('an existing bucket-list date is matched once, and a match the old job already sent is not resent', async () => {
  const { db, sent, job } = setup({ goose: [...SUMMER, FALL_TOUR[2]] });
  // The pre-5.46 job already told Alice about e5 under the same id.
  db._put(`notifications/venueMatch_${ALICE.uid}_e5`, { uid: ALICE.uid, type: 'venue_bucket_list_match', read: true });
  await job();
  await job();
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(db._get(`notifications/venueMatch_${ALICE.uid}_e5`).read, true, 'a read alert stays read');
});

test('a bucket-list date on its own is emailed once, with the venue link', async () => {
  const { sent, state, job } = setup();
  await job();
  state.goose = [...SUMMER, FALL_TOUR[2]]; // one new date, not a tour
  await job();
  await job();
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].subject, /Goose is playing The Gorge Amphitheatre — on your bucket list/);
});

test('a Ticketmaster failure leaves the ledger alone', async () => {
  const { db, job } = setup();
  await job();
  const before = db._get(`${LEDGER_COLLECTION}/${ledgerId('goose')}`);
  await job({ fetchEvents: async () => null });
  assert.deepStrictEqual(db._get(`${LEDGER_COLLECTION}/${ledgerId('goose')}`), before);
});

test('a user who unsubscribed from all email still gets the in-app alert, but no email', async () => {
  const { db, sent, state, job } = setup();
  db._put(`userProfiles/${ALICE.uid}`, { ...db._get(`userProfiles/${ALICE.uid}`), emailOptOut: true });
  await job();
  state.goose = [...SUMMER, ...FALL_TOUR];
  await job();
  assert.strictEqual(notifications(db).filter((n) => n.type === 'followed_band_tour').length, 1);
  assert.strictEqual(sent.length, 0);
});

// ── The email's links ───────────────────────────────────────────────────

test('every alert email has the unsubscribe footer, List-Unsubscribe and an unfollow link', async () => {
  const { sent, state, job } = setup();
  await job();
  state.goose = [...SUMMER, ...FALL_TOUR];
  await job();
  const [mail] = sent;
  assert.ok(mail.headers['List-Unsubscribe'].includes('/api/unsubscribe?token='));
  const unsub = decodeURIComponent(mail.html.match(/\/api\/unsubscribe\?token=([^"&]+)/)[1]);
  assert.strictEqual(verifyUnsubscribe(unsub).id, ALICE.uid);
  const link = mail.html.match(/\/api\/unfollow\?token=([^"&]+)/);
  assert.ok(link, 'unfollow link present');
  assert.deepStrictEqual(verifyUnfollow(decodeURIComponent(link[1])), { uid: ALICE.uid, artistKey: 'goose' });
  assert.match(mail.html, /Unfollow Goose/);
});

test('the unfollow link asks first, then unfollows only that band', async () => {
  const { db } = setup();
  db._put(`userProfiles/${ALICE.uid}`, {
    ...db._get(`userProfiles/${ALICE.uid}`),
    favoriteArtists: [{ name: 'Goose' }, { name: 'Phish' }],
  });
  const token = signUnfollow({ uid: ALICE.uid, artistKey: 'goose' });

  const get = await unfollow({ httpMethod: 'GET', queryStringParameters: { token } });
  assert.strictEqual(get.statusCode, 200);
  assert.match(get.body, /Unfollow Goose\?/);
  assert.strictEqual(db._get(`userProfiles/${ALICE.uid}`).favoriteArtists.length, 2, 'a GET changes nothing');

  const post = await unfollow({ httpMethod: 'POST', queryStringParameters: { token } });
  assert.strictEqual(post.statusCode, 200);
  assert.match(post.body, /unfollowed Goose/);
  assert.deepStrictEqual(db._get(`userProfiles/${ALICE.uid}`).favoriteArtists.map((f) => f.name), ['Phish']);

  const repeat = await unfollow({ httpMethod: 'POST', queryStringParameters: { token } });
  assert.strictEqual(repeat.statusCode, 200);
});

test('a tampered, foreign or unsubscribe token unfollows nobody', async () => {
  const { db } = setup();
  const token = signUnfollow({ uid: ALICE.uid, artistKey: 'goose' });
  const [body, sig] = token.split('.');
  const forged = `${Buffer.from(JSON.stringify({ v: 1, u: BOB.uid, a: 'goose' })).toString('base64url')}.${sig}`;
  for (const t of [`${body}.x${sig.slice(1)}`, forged, 'not-a-token']) {
    const r = await unfollow({ httpMethod: 'POST', queryStringParameters: { token: t } });
    assert.strictEqual(r.statusCode, 400);
  }
  const { sign } = require('../../netlify/functions/lib/unsubscribeToken');
  const unsubToken = sign({ kind: 'uid', id: ALICE.uid, scope: 'all', source: 'notification:x' });
  assert.strictEqual(verifyUnfollow(unsubToken), null);
  assert.strictEqual(verifyUnsubscribe(token), null);
  assert.strictEqual(db._get(`userProfiles/${ALICE.uid}`).favoriteArtists.length, 1);
});

run('followed-band alerts');
