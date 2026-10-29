/**
 * The anniversary job (netlify/functions/lib/anniversaryAlerts.js) against
 * an in-memory Firestore and a fake FCM:
 *   - today's anniversaries, and only today's
 *   - one push to each device and one email per reminder; a rerun sends
 *     nothing (create(), not set(merge))
 *   - a tap opens the show (that the link routes there:
 *     lib/__tests__/alertChannels.test.js)
 *   - a dead token is removed; push and email are switched separately
 *
 *   node tests/notifications/anniversaries.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestTransport, sendNotificationEmail } = require('../../netlify/functions/lib/outgoingEmail');
const { loadPushTokens } = require('../../netlify/functions/lib/pushDelivery');
const {
  findAnniversaries, deliverAnniversaries, anniversaryPush, anniversaryEmail,
} = require('../../netlify/functions/lib/anniversaryAlerts');

const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com' };
const IPHONE = 'fcm-token-alice-iphone';
const IPAD = 'fcm-token-alice-ipad';
const TODAY = '2026-10-29';

const SHOWS = [
  { uid: ALICE.uid, showId: 'show_rr_2021', show: { artist: 'Goose', venue: 'Red Rocks Amphitheatre', city: 'Morrison', date: '2021-10-29' } },
  { uid: ALICE.uid, showId: 'show_msg_2023', show: { artist: 'Phish', venue: 'Madison Square Garden', city: 'New York', date: '2023-12-31' } },
];

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

function setup({ prefs, tokens = [IPHONE, IPAD], dead = [] } = {}) {
  const db = createFakeDb();
  __setTestFirebase({ db });
  db._put(`userProfiles/${ALICE.uid}`, {
    email: ALICE.email,
    ...(prefs ? { notificationPrefs: { anniversaries: prefs } } : {}),
  });
  tokens.forEach((t) => db._put(`pushTokens/${t}`, { userId: ALICE.uid, platform: 'ios' }));

  const sent = [];
  __setTestTransport((path, payload) => { sent.push(payload); return { status: 200, body: '{"id":"x"}' }; });
  const push = fakePush(dead);

  // What the handler does, minus collectionGroup('shows').
  const job = async () => {
    const matches = findAnniversaries(SHOWS, TODAY);
    const profiles = new Map([[ALICE.uid, db._get(`userProfiles/${ALICE.uid}`)]]);
    return deliverAnniversaries({
      db,
      matches,
      profiles,
      tokens: await loadPushTokens(db, profiles),
      year: 2026,
      createdAt: new Date('2026-10-29T13:00:00Z'),
      sendEmail: (msg) => sendNotificationEmail({ db, ...msg }),
      sendPush: push.sendPush,
    });
  };
  return { db, sent, push, job };
}

const reminders = (db) => db._list('notifications').filter((n) => n.type === 'anniversary');

test('only today’s anniversaries match, with how many years ago', () => {
  const matches = findAnniversaries(SHOWS, TODAY);
  assert.deepStrictEqual(matches.map((m) => [m.showId, m.yearsAgo]), [['show_rr_2021', 5]]);
});

test('the push names the show, and a tap opens it', () => {
  const [m] = findAnniversaries(SHOWS, TODAY);
  const p = anniversaryPush(m);
  assert.strictEqual(p.body, '5 years ago today you saw Goose at Red Rocks Amphitheatre');
  assert.strictEqual(p.link, 'https://mysetlists.net/shows/?show=show_rr_2021');
  assert.match(anniversaryEmail(m).html, /https:\/\/mysetlists\.net\/shows\/\?show=show_rr_2021/);
});

test('one reminder: one push to each device and one email, then nothing on the rerun', async () => {
  const { db, sent, push, job } = setup();
  const r = await job();
  assert.strictEqual(r.created, 1);
  assert.strictEqual(r.pushed, 1);
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(push.calls.map((c) => c.token).sort(), [IPAD, IPHONE]);
  assert.strictEqual(push.calls[0].notificationId, `anniversary_${ALICE.uid}_show_rr_2021_2026`);

  // Read it, then the job runs again the same day.
  const id = `notifications/anniversary_${ALICE.uid}_show_rr_2021_2026`;
  db._put(id, { ...db._get(id), read: true });
  const again = await job();
  assert.strictEqual(again.duplicates, 1);
  assert.strictEqual(push.calls.length, 2, 'no second push');
  assert.strictEqual(sent.length, 1, 'no second email');
  assert.strictEqual(db._get(id).read, true, 'a read reminder stays read');
  assert.strictEqual(reminders(db).length, 1);
});

test('a dead token is deleted; the live one still gets the push', async () => {
  const { db, push, job } = setup({ dead: [IPAD] });
  const r = await job();
  assert.strictEqual(r.deadTokens, 1);
  assert.strictEqual(r.pushed, 1);
  assert.strictEqual(db._get(`pushTokens/${IPAD}`), undefined);
  assert.ok(db._get(`pushTokens/${IPHONE}`));
  assert.strictEqual(push.calls.length, 2);
});

test('push off: email only. Email off: push only. Old method prefs read the same way', async () => {
  for (const [prefs, wantPushes, wantEmails] of [
    [{ push: false, email: true }, 0, 1],
    [{ push: true, email: false }, 2, 0],
    [{ method: 'email' }, 0, 1],
    [{ method: 'push' }, 2, 0],
  ]) {
    const { db, sent, push, job } = setup({ prefs });
    await job();
    assert.strictEqual(push.calls.length, wantPushes, JSON.stringify(prefs));
    assert.strictEqual(sent.length, wantEmails, JSON.stringify(prefs));
    assert.strictEqual(reminders(db).length, 1, 'still in Notifications');
  }
});

test('reminders off: nothing at all', async () => {
  const { db, sent, push, job } = setup({ prefs: { enabled: false } });
  await job();
  assert.strictEqual(reminders(db).length, 0);
  assert.strictEqual(sent.length + push.calls.length, 0);
});

run('anniversary reminders');
