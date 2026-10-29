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

// ── Push (5.49.0) ───────────────────────────────────────────────────────

const IPHONE = 'fcm-token-alice-iphone';
const IPAD = 'fcm-token-alice-ipad';

/** A sendPush that records every call and rejects for the tokens in `dead`. */
function fakePush(dead = []) {
  const calls = [];
  const sendPush = async (token, msg) => {
    calls.push({ token, ...msg });
    if (dead.includes(token)) {
      const err = new Error('Requested entity was not found.');
      err.code = 'messaging/registration-token-not-registered';
      throw err;
    }
    return 'projects/x/messages/1';
  };
  return { calls, sendPush };
}

test('push copy: a tour names its season and size, a venue match its date', () => {
  const band = { key: 'goose', name: 'Goose' };
  const spring = ['2027-03-20', '2027-04-02', '2027-04-03', '2027-05-01'].map((d, i) => ev(`s${i}`, d, 'V', 'C'));
  assert.strictEqual(
    alerts.pushFor({ kind: 'tour', band, dates: spring }).body,
    'Goose announced a spring tour: 4 dates',
  );
  const sprawling = ['2027-01-10', '2027-04-02', '2027-07-03', '2027-10-01'].map((d, i) => ev(`x${i}`, d, 'V', 'C'));
  assert.strictEqual(alerts.pushFor({ kind: 'tour', band, dates: sprawling }).body, 'Goose announced a tour: 4 dates');
  assert.strictEqual(alerts.tourSeason([ev('a', '2027-12-30'), ev('b', '2028-01-02'), ev('c', '2028-02-10')]), 'winter');

  const now = Date.parse('2027-02-01T00:00:00Z');
  const strings = { key: 'billy strings', name: 'Billy Strings' };
  const venue = alerts.pushFor({ kind: 'venue', band: strings, event: ev('r', '2027-06-03', 'Red Rocks', 'Morrison') }, now);
  assert.strictEqual(venue.body, 'Billy Strings plays Red Rocks on Jun 3');
  const nextYear = alerts.pushFor({ kind: 'venue', band: strings, event: ev('r', '2028-06-03', 'Red Rocks', 'Morrison') }, now);
  assert.strictEqual(nextYear.body, 'Billy Strings plays Red Rocks on Jun 3, 2028');
});

test('push links: a band with a screen opens it, anything else opens Notifications', () => {
  const tour = (name) => alerts.pushFor({ kind: 'tour', band: { key: artistKey(name), name }, dates: FALL_TOUR });
  assert.strictEqual(tour('Goose').link, 'https://mysetlists.net/bands/?band=goose');
  assert.strictEqual(tour('Goose (US)').link, 'https://mysetlists.net/bands/?band=goose');
  assert.strictEqual(tour('Some Band Nobody Configured').link, 'https://mysetlists.net/notifications/');
  const venue = alerts.pushFor({ kind: 'venue', band: { key: 'goose', name: 'Goose' }, event: FALL_TOUR[2] });
  assert.strictEqual(venue.link, 'https://mysetlists.net/notifications/');
});

test('old method prefs still read right, and push and email switch separately', () => {
  const p = (prefs) => alerts.prefFor({ notificationPrefs: { followedBands: prefs } }, 'followedBands');
  assert.deepStrictEqual(p(undefined), { enabled: true, push: true, email: true });
  assert.deepStrictEqual(p({ method: 'email' }), { enabled: true, push: false, email: true });
  assert.deepStrictEqual(p({ method: 'push' }), { enabled: true, push: true, email: false });
  assert.deepStrictEqual(p({ method: 'both', push: false, email: true }), { enabled: true, push: false, email: true });
  assert.deepStrictEqual(p({ enabled: false }), { enabled: false, push: true, email: true });
});

test('one tour alert: one push to each device and one email, then nothing on the rerun', async () => {
  const { db, sent, state, job } = setup();
  db._put(`pushTokens/${IPHONE}`, { userId: ALICE.uid, platform: 'ios' });
  db._put(`pushTokens/${IPAD}`, { userId: ALICE.uid, platform: 'ios' });
  // Bob has alerts off: his device hears nothing.
  db._put('pushTokens/fcm-token-bob', { userId: BOB.uid, platform: 'ios' });
  const push = fakePush();
  await job({ sendPush: push.sendPush });
  state.goose = [...SUMMER, ...FALL_TOUR];
  const r = await job({ sendPush: push.sendPush });

  assert.strictEqual(sent.length, 1, 'one email');
  assert.strictEqual(r.pushed, 1, 'one alert pushed');
  assert.deepStrictEqual(push.calls.map((c) => c.token).sort(), [IPAD, IPHONE], 'once per device, never to Bob');
  const [msg] = push.calls;
  assert.strictEqual(msg.body, 'Goose announced a fall tour: 3 dates');
  assert.strictEqual(msg.link, 'https://mysetlists.net/bands/?band=goose');
  assert.match(msg.notificationId, /^bandTour_aliceUid000001_/);
  // The bucket-list date rides in the tour push, as it does in the email.
  assert.ok(!push.calls.some((c) => /plays/.test(c.body)));

  await job({ sendPush: push.sendPush });
  assert.strictEqual(push.calls.length, 2);
  assert.strictEqual(sent.length, 1);
});

test('a dead token is deleted and not tried again; the live one still gets the push', async () => {
  const { db, state, job } = setup();
  db._put(`pushTokens/${IPHONE}`, { userId: ALICE.uid, platform: 'ios' });
  db._put(`pushTokens/${IPAD}`, { userId: ALICE.uid, platform: 'ios' });
  const push = fakePush([IPAD]);
  await job({ sendPush: push.sendPush });
  state.goose = [...SUMMER, ...FALL_TOUR];
  const r = await job({ sendPush: push.sendPush });
  assert.strictEqual(r.deadTokens, 1);
  assert.strictEqual(r.pushed, 1);
  assert.strictEqual(db._get(`pushTokens/${IPAD}`), undefined, 'dead token removed');
  assert.ok(db._get(`pushTokens/${IPHONE}`), 'live token kept');
});

test('a dead legacy web token is cleared from the profile', async () => {
  const { db, state, job } = setup();
  db._put(`userProfiles/${ALICE.uid}`, { ...db._get(`userProfiles/${ALICE.uid}`), fcmToken: 'old-web-token' });
  const push = fakePush(['old-web-token']);
  await job({ sendPush: push.sendPush });
  state.goose = [...SUMMER, ...FALL_TOUR];
  const r = await job({ sendPush: push.sendPush });
  assert.strictEqual(r.deadTokens, 1);
  assert.strictEqual(db._get(`userProfiles/${ALICE.uid}`).fcmToken, null);
});

test('push off sends no push; email off sends no email; the alert is still in Notifications', async () => {
  const { db, sent, state, job } = setup();
  db._put(`pushTokens/${IPHONE}`, { userId: ALICE.uid, platform: 'ios' });
  db._put(`userProfiles/${ALICE.uid}`, {
    ...db._get(`userProfiles/${ALICE.uid}`),
    notificationPrefs: { followedBands: { enabled: true, push: false, email: true } },
  });
  const push = fakePush();
  await job({ sendPush: push.sendPush });
  state.goose = [...SUMMER, ...FALL_TOUR];
  await job({ sendPush: push.sendPush });
  assert.strictEqual(push.calls.length, 0);
  assert.strictEqual(sent.length, 1);

  const second = setup();
  second.db._put(`pushTokens/${IPHONE}`, { userId: ALICE.uid, platform: 'ios' });
  second.db._put(`userProfiles/${ALICE.uid}`, {
    ...second.db._get(`userProfiles/${ALICE.uid}`),
    notificationPrefs: { followedBands: { enabled: true, push: true, email: false } },
  });
  const push2 = fakePush();
  await second.job({ sendPush: push2.sendPush });
  second.state.goose = [...SUMMER, ...FALL_TOUR];
  await second.job({ sendPush: push2.sendPush });
  assert.strictEqual(push2.calls.length, 1);
  assert.strictEqual(second.sent.length, 0);
  assert.strictEqual(notifications(second.db).filter((n) => n.type === 'followed_band_tour').length, 1);
});

test('a bucket-list date on its own is pushed once, naming the venue and date', async () => {
  const { db, state, job } = setup();
  db._put(`pushTokens/${IPHONE}`, { userId: ALICE.uid, platform: 'ios' });
  const push = fakePush();
  await job({ sendPush: push.sendPush });
  state.goose = [...SUMMER, FALL_TOUR[2]];
  await job({ sendPush: push.sendPush });
  await job({ sendPush: push.sendPush });
  assert.strictEqual(push.calls.length, 1);
  assert.match(push.calls[0].body, /^Goose plays The Gorge Amphitheatre on Oct 4/);
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
