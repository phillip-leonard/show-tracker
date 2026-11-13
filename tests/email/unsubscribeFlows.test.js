/**
 * The real handlers, end to end against an in-memory Firestore:
 *   - /api/unsubscribe GET, one-click POST, confirmation-page POST
 *   - update-email-preferences (Profile), unsubscribe and re-subscribe
 *   - every path writes exactly one correct unsubscribeEvents entry
 *   - send-email: 401 without a token, footer + List-Unsubscribe headers,
 *     opt-out honoured, recipient resolved from `to`, rate limit
 *   - admin-list-unsubscribes / admin-send-announcement: 403 for non-admins
 *
 *   node tests/email/unsubscribeFlows.test.js
 */

const { test, run } = require('./harness');
const assert = require('node:assert');
const { createFakeDb, createFakeAuth } = require('./fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestTransport } = require('../../netlify/functions/lib/outgoingEmail');
const { sign, hashEmail, verify } = require('../../netlify/functions/lib/unsubscribeToken');

const unsubscribe = require('../../netlify/functions/unsubscribe').handler;
const prefs = require('../../netlify/functions/update-email-preferences').handler;
const sendEmail = require('../../netlify/functions/send-email');
const listUnsubs = require('../../netlify/functions/admin-list-unsubscribes').handler;
const sendAnnouncement = require('../../netlify/functions/admin-send-announcement').handler;

const ADMIN = { uid: 'adminUid000001', email: 'phillip.leonard@gmail.com', email_verified: true };
const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com' };
const BOB = { uid: 'bobUid00000001', email: 'bob@example.com' };

function setup() {
  const db = createFakeDb();
  const auth = createFakeAuth({
    tokens: { 'admin-token': ADMIN, 'alice-token': ALICE, 'bob-token': BOB },
    users: [ADMIN, ALICE, BOB],
  });
  __setTestFirebase({ db, auth });
  db._put(`userProfiles/${ALICE.uid}`, { email: ALICE.email, displayName: 'Alice' });
  db._put(`userProfiles/${BOB.uid}`, { email: BOB.email, displayName: 'Bob' });
  const sent = [];
  __setTestTransport((path, payload) => { sent.push({ path, payload }); return { status: 200, body: JSON.stringify({ id: 'x' }) }; });
  return { db, sent };
}

const events = (db) => db._list('unsubscribeEvents');
const get = (token) => ({ httpMethod: 'GET', queryStringParameters: { token }, headers: {} });
const oneClick = (token) => ({
  httpMethod: 'POST', queryStringParameters: { token }, headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'List-Unsubscribe=One-Click',
});
const confirm = (token, scope) => ({
  httpMethod: 'POST', queryStringParameters: { token }, headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `scope=${scope}`,
});
const authed = (token, method, body) => ({
  httpMethod: method, headers: { authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body),
});

// ── /api/unsubscribe ─────────────────────────────────────────────────

test('GET shows a confirmation page with a POST button and changes nothing', async () => {
  const { db } = setup();
  const token = sign({ kind: 'uid', id: ALICE.uid, scope: 'all', source: 'notification:tag' });
  const before = db._writes.length;
  const res = await unsubscribe(get(token));
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.body, /<form method="POST"/);
  assert.match(res.body, /alice@example\.com/);
  assert.match(res.body, /Unsubscribe from all MySetlists emails/);
  assert.strictEqual(db._writes.length, before, 'GET must not write');
  assert.strictEqual(db._get(`userProfiles/${ALICE.uid}`).emailOptOut, undefined);
  assert.strictEqual(events(db).length, 0);
});

test('GET for an announcements link offers both options', async () => {
  setup();
  const token = sign({ kind: 'uid', id: ALICE.uid, scope: 'announcements', source: 'announcement:abc' });
  const res = await unsubscribe(get(token));
  assert.match(res.body, /value="announcements"/);
  assert.match(res.body, /value="all">Unsubscribe from all MySetlists emails/);
});

test('GET page uses the current theme and is phone-safe', async () => {
  setup();
  const res = await unsubscribe(get(sign({ kind: 'uid', id: ALICE.uid, scope: 'all', source: 'notification:tag' })));
  assert.match(res.body, /#2a2a4e/);
  assert.match(res.body, /#34D399/);
  assert.match(res.body, /Plus Jakarta Sans/);
  assert.match(res.body, /safe-area-inset-bottom/);
  assert.match(res.body, /viewport-fit=cover/);
  assert.doesNotMatch(res.body, /#4bc86a/);
});

test('one-click POST: 200, no page, flag set, one event', async () => {
  const { db } = setup();
  const token = sign({ kind: 'uid', id: ALICE.uid, scope: 'all', source: 'notification:anniversary' });
  const res = await unsubscribe(oneClick(token));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body, '');
  assert.ok(!res.headers.Location && !res.headers.location);
  const p = db._get(`userProfiles/${ALICE.uid}`);
  assert.strictEqual(p.emailOptOut, true);
  assert.strictEqual(p.emailOptOutMethod, 'one-click');
  const ev = events(db);
  assert.strictEqual(ev.length, 1);
  assert.deepStrictEqual(
    { uid: ev[0].uid, email: ev[0].email, scope: ev[0].scope, action: ev[0].action, method: ev[0].method, source: ev[0].source },
    { uid: ALICE.uid, email: ALICE.email, scope: 'all', action: 'unsubscribe', method: 'one-click', source: 'notification:anniversary' },
  );
  assert.ok(ev[0].createdAt instanceof Date);
});

test('one-click also accepted as base64-encoded multipart body', async () => {
  const { db } = setup();
  const token = sign({ kind: 'uid', id: BOB.uid, scope: 'announcements', source: 'announcement:a1' });
  const multipart = '--b\r\nContent-Disposition: form-data; name="List-Unsubscribe"\r\n\r\nOne-Click\r\n--b--';
  const res = await unsubscribe({ httpMethod: 'POST', queryStringParameters: { token }, headers: {}, body: Buffer.from(multipart).toString('base64'), isBase64Encoded: true });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(db._get(`userProfiles/${BOB.uid}`).announcementsOptOut, true);
  assert.strictEqual(db._get(`userProfiles/${BOB.uid}`).emailOptOut, undefined);
});

test('confirmation-page POST: success page, method link, one event', async () => {
  const { db } = setup();
  const token = sign({ kind: 'uid', id: ALICE.uid, scope: 'announcements', source: 'announcement:launch1' });
  const res = await unsubscribe(confirm(token, 'announcements'));
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.body, /You&#39;re unsubscribed|You're unsubscribed/);
  assert.match(res.body, /Changed your mind\?/);
  assert.match(res.body, /\/profile\//);
  const p = db._get(`userProfiles/${ALICE.uid}`);
  assert.strictEqual(p.announcementsOptOut, true);
  assert.strictEqual(p.emailOptOut, undefined, 'announcements unsubscribe must not stop notifications');
  const ev = events(db);
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].method, 'link');
  assert.strictEqual(ev[0].scope, 'announcements');
  assert.strictEqual(ev[0].source, 'announcement:launch1');
});

test('an announcements link can be broadened to all on the page', async () => {
  const { db } = setup();
  const token = sign({ kind: 'uid', id: ALICE.uid, scope: 'announcements', source: 'announcement:launch1' });
  await unsubscribe(confirm(token, 'all'));
  assert.strictEqual(db._get(`userProfiles/${ALICE.uid}`).emailOptOut, true);
  assert.strictEqual(events(db)[0].scope, 'all');
});

test('an all link cannot be narrowed by editing the form', async () => {
  const { db } = setup();
  const token = sign({ kind: 'uid', id: ALICE.uid, scope: 'all', source: 'notification:tag' });
  await unsubscribe(confirm(token, 'announcements'));
  assert.strictEqual(db._get(`userProfiles/${ALICE.uid}`).emailOptOut, true);
});

test('repeat unsubscribe: logged again, state unchanged, same success page', async () => {
  const { db } = setup();
  const token = sign({ kind: 'uid', id: ALICE.uid, scope: 'all', source: 'notification:tag' });
  const first = await unsubscribe(confirm(token, 'all'));
  const stateAfterFirst = db._get(`userProfiles/${ALICE.uid}`);
  const second = await unsubscribe(confirm(token, 'all'));
  assert.strictEqual(second.statusCode, 200);
  assert.strictEqual(second.body, first.body);
  assert.deepStrictEqual(db._get(`userProfiles/${ALICE.uid}`), stateAfterFirst);
  assert.strictEqual(events(db).length, 2);
});

test('email-kind token: suppression doc keyed by hash, stores the real address', async () => {
  const { db } = setup();
  const token = sign({ kind: 'email', id: 'Friend@Example.com', scope: 'all', source: 'notification:invite' });
  const res = await unsubscribe(oneClick(token));
  assert.strictEqual(res.statusCode, 200);
  const s = db._get(`emailSuppressions/${hashEmail('friend@example.com')}`);
  assert.strictEqual(s.email, 'friend@example.com');
  assert.strictEqual(s.scope, 'all');
  assert.strictEqual(s.source, 'notification:invite');
  assert.ok(s.createdAt instanceof Date && s.updatedAt instanceof Date);
  const ev = events(db);
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].uid, null);
  assert.strictEqual(ev[0].email, 'friend@example.com');
});

test('email-kind suppression never narrows from all to announcements', async () => {
  const { db } = setup();
  await unsubscribe(oneClick(sign({ kind: 'email', id: 'f@example.com', scope: 'all', source: 'notification:invite' })));
  await unsubscribe(oneClick(sign({ kind: 'email', id: 'f@example.com', scope: 'announcements', source: 'announcement:x' })));
  assert.strictEqual(db._get(`emailSuppressions/${hashEmail('f@example.com')}`).scope, 'all');
  assert.strictEqual(events(db).length, 2);
});

test('legacy base64-uid token: "link has expired" page, unsubscribes nobody, logs nothing', async () => {
  const { db } = setup();
  const legacy = Buffer.from(ALICE.uid).toString('base64url');
  for (const ev of [get(legacy), confirm(legacy, 'all')]) {
    const res = await unsubscribe(ev);
    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body, /This link has expired/);
    assert.match(res.body, /Profile/);
  }
  const oc = await unsubscribe(oneClick(legacy));
  assert.strictEqual(oc.statusCode, 400);
  assert.strictEqual(db._get(`userProfiles/${ALICE.uid}`).emailOptOut, undefined);
  assert.strictEqual(events(db).length, 0);
});

test('tampered token: 400, nothing written', async () => {
  const { db } = setup();
  const t = sign({ kind: 'uid', id: ALICE.uid, scope: 'all', source: 'notification:tag' });
  const res = await unsubscribe(confirm(`${t}x`, 'all'));
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(events(db).length, 0);
});

// ── Profile (update-email-preferences) ───────────────────────────────

test('profile: unsubscribe from announcements writes one profile event', async () => {
  const { db } = setup();
  const res = await prefs(authed('alice-token', 'POST', { announcementsOptOut: true }));
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(res.body), { success: true, emailOptOut: false, announcementsOptOut: true });
  const ev = events(db);
  assert.strictEqual(ev.length, 1);
  assert.deepStrictEqual(
    { uid: ev[0].uid, email: ev[0].email, scope: ev[0].scope, action: ev[0].action, method: ev[0].method, source: ev[0].source },
    { uid: ALICE.uid, email: ALICE.email, scope: 'announcements', action: 'unsubscribe', method: 'profile', source: 'profile' },
  );
});

test('profile: re-subscribe is logged as resubscribe', async () => {
  const { db } = setup();
  await prefs(authed('alice-token', 'POST', { emailOptOut: true }));
  const res = await prefs(authed('alice-token', 'POST', { emailOptOut: false }));
  assert.strictEqual(JSON.parse(res.body).emailOptOut, false);
  const ev = events(db);
  assert.strictEqual(ev.length, 2);
  assert.strictEqual(ev[1].action, 'resubscribe');
  assert.strictEqual(ev[1].scope, 'all');
  assert.strictEqual(ev[1].method, 'profile');
  assert.strictEqual(db._get(`userProfiles/${ALICE.uid}`).emailOptOut, false);
});

test('profile: setting the same value again logs nothing', async () => {
  const { db } = setup();
  await prefs(authed('alice-token', 'POST', { emailOptOut: true }));
  await prefs(authed('alice-token', 'POST', { emailOptOut: true }));
  assert.strictEqual(events(db).length, 1);
});

test('profile: announcements switch is inert while all emails are off', async () => {
  const { db } = setup();
  await prefs(authed('alice-token', 'POST', { emailOptOut: true }));
  const res = await prefs(authed('alice-token', 'POST', { announcementsOptOut: false }));
  assert.deepStrictEqual(JSON.parse(res.body), { success: true, emailOptOut: true, announcementsOptOut: true });
  assert.strictEqual(events(db).length, 1);
});

test('profile: validates booleans and requires auth', async () => {
  setup();
  assert.strictEqual((await prefs(authed('alice-token', 'POST', { emailOptOut: 'yes' }))).statusCode, 400);
  assert.strictEqual((await prefs(authed('alice-token', 'POST', {}))).statusCode, 400);
  assert.strictEqual((await prefs({ httpMethod: 'POST', headers: {}, body: '{"emailOptOut":true}' })).statusCode, 401);
  assert.strictEqual((await prefs(authed('bad-token', 'POST', { emailOptOut: true }))).statusCode, 401);
});

test('profile: GET reflects a pre-signup suppression; re-subscribing lifts it', async () => {
  const { db } = setup();
  db._put(`emailSuppressions/${hashEmail(BOB.email)}`, { email: BOB.email, scope: 'all' });
  const g = await prefs(authed('bob-token', 'GET'));
  assert.deepStrictEqual(JSON.parse(g.body), { emailOptOut: true, announcementsOptOut: true });
  const r = await prefs(authed('bob-token', 'POST', { emailOptOut: false }));
  assert.deepStrictEqual(JSON.parse(r.body), { success: true, emailOptOut: false, announcementsOptOut: false });
  assert.strictEqual(db._get(`emailSuppressions/${hashEmail(BOB.email)}`), undefined);
  assert.strictEqual(events(db)[0].action, 'resubscribe');
});

// ── send-email ───────────────────────────────────────────────────────
// Since 5.59.6 the browser names a record, never an address or HTML
// (tests/security/sendEmail.test.js has the per-type rules). These keep
// the unsubscribe guarantees covered: footer, headers, token kind, opt-out.

let tagSeq = 0;
function tagFor(db, toUid) {
  const id = `tag${++tagSeq}`;
  db._put(`showTags/${id}`, { fromUid: BOB.uid, toUid, showData: { artist: 'Goose', venue: 'Red Rocks', date: '2024-06-15' }, status: 'pending', createdAt: new Date() });
  return { type: 'tag', tagId: id };
}
function inviteFor(db, email) {
  const id = `inv${++tagSeq}`;
  db._put(`invites/${id}`, { inviterUid: BOB.uid, inviteeEmail: email, status: 'pending', createdAt: new Date() });
  return { type: 'invite', inviteId: id };
}

test('send-email: 401 without a token', async () => {
  const { db, sent } = setup();
  const res = await sendEmail.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(tagFor(db, ALICE.uid)) });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(sent.length, 0);
});

test('send-email: CORS only for the site and the iOS app', async () => {
  setup();
  const pre = (origin) => sendEmail.handler({ httpMethod: 'OPTIONS', headers: { origin } });
  assert.strictEqual((await pre('https://mysetlists.net')).headers['Access-Control-Allow-Origin'], 'https://mysetlists.net');
  assert.strictEqual((await pre('capacitor://localhost')).headers['Access-Control-Allow-Origin'], 'capacitor://localhost');
  assert.strictEqual((await pre('https://evil.example')).headers['Access-Control-Allow-Origin'], undefined);
});

test('send-email: account recipient gets a uid token, footer and List-Unsubscribe headers', async () => {
  const { db, sent } = setup();
  const res = await sendEmail.handler(authed('bob-token', 'POST', tagFor(db, ALICE.uid)));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(sent.length, 1);
  const p = sent[0].payload;
  assert.strictEqual(p.to, 'alice@example.com');
  assert.strictEqual(p.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const url = p.headers['List-Unsubscribe'].slice(1, -1);
  const token = decodeURIComponent(url.split('token=')[1]);
  assert.deepStrictEqual(verify(token), { kind: 'uid', id: ALICE.uid, scope: 'all', source: 'notification:tag' });
  assert.ok(p.html.includes(url.replace(/&/g, '&amp;')), 'footer link matches header');
  assert.match(p.html, /Unsubscribe from all MySetlists emails/);
  assert.doesNotMatch(p.html, /MYSETLISTS_UNSUBSCRIBE_FOOTER/);
});

test('send-email: non-user recipient gets an email token (never the sender\'s uid)', async () => {
  const { db, sent } = setup();
  await sendEmail.handler(authed('bob-token', 'POST', { ...inviteFor(db, 'newfriend@example.com'), recipientUid: BOB.uid }));
  const token = decodeURIComponent(sent[0].payload.headers['List-Unsubscribe'].slice(1, -1).split('token=')[1]);
  assert.deepStrictEqual(verify(token), { kind: 'email', id: 'newfriend@example.com', scope: 'all', source: 'notification:invite' });
});

test('send-email: opted-out and suppressed recipients are skipped', async () => {
  const { db, sent } = setup();
  db._put(`userProfiles/${ALICE.uid}`, { email: ALICE.email, emailOptOut: true });
  db._put(`emailSuppressions/${hashEmail('gone@example.com')}`, { email: 'gone@example.com', scope: 'all' });
  for (const req of [tagFor(db, ALICE.uid), inviteFor(db, 'gone@example.com')]) {
    const res = await sendEmail.handler(authed('bob-token', 'POST', req));
    assert.strictEqual(JSON.parse(res.body).skipped, true);
  }
  assert.strictEqual(sent.length, 0);
});

test('send-email: announcements-only opt-out does not block notifications', async () => {
  const { db, sent } = setup();
  db._put(`userProfiles/${ALICE.uid}`, { email: ALICE.email, announcementsOptOut: true });
  await sendEmail.handler(authed('bob-token', 'POST', tagFor(db, ALICE.uid)));
  assert.strictEqual(sent.length, 1);
});

test('send-email: rate-limited per sender', async () => {
  const { db, sent } = setup();
  let last;
  for (let i = 0; i <= sendEmail.RATE_LIMIT_PER_HOUR; i++) {
    last = await sendEmail.handler(authed('bob-token', 'POST', tagFor(db, ALICE.uid)));
  }
  assert.strictEqual(last.statusCode, 429);
  assert.strictEqual(sent.length, sendEmail.RATE_LIMIT_PER_HOUR);
});

test('send-email: a legacy { to, html } call with nothing behind it sends nothing', async () => {
  const { sent } = setup();
  const log = console.log; console.log = () => {};
  try {
    for (const to of ['a@b.co,c@d.co', 'nope', 'x@example.com']) {
      const res = await sendEmail.handler(authed('bob-token', 'POST', { to, subject: 's', html: '<p>h</p>', type: 'tag' }));
      assert.ok([200, 400].includes(res.statusCode));
    }
  } finally { console.log = log; }
  assert.strictEqual(sent.length, 0);
});

// ── Admin endpoints ──────────────────────────────────────────────────

test('admin-list-unsubscribes: 401 without a token, 403 for a non-admin', async () => {
  setup();
  assert.strictEqual((await listUnsubs({ httpMethod: 'GET', headers: {} })).statusCode, 401);
  assert.strictEqual((await listUnsubs(authed('alice-token', 'GET'))).statusCode, 403);
});

test('admin-send-announcement: 403 for a non-admin, in every mode', async () => {
  const { sent } = setup();
  for (const mode of ['preview', 'test', 'send', 'history']) {
    const res = await sendAnnouncement(authed('alice-token', 'POST', { mode, subject: 's', html: 'h' }));
    assert.strictEqual(res.statusCode, 403, mode);
  }
  assert.strictEqual(sent.length, 0);
});

test('admin-list-unsubscribes: current state merges users and non-users; legacy has no date', async () => {
  const { db } = setup();
  db._put(`userProfiles/${ALICE.uid}`, { email: ALICE.email, displayName: 'Alice', emailOptOut: true }); // legacy
  db._put(`userProfiles/${BOB.uid}`, { email: BOB.email, handle: 'bob', announcementsOptOut: true, announcementsOptOutAt: new Date('2026-09-01'), announcementsOptOutMethod: 'one-click', announcementsOptOutSource: 'announcement:a1' });
  await unsubscribe(oneClick(sign({ kind: 'email', id: 'friend@example.com', scope: 'announcements', source: 'announcement:a1' })));
  // A suppressed address that belongs to Bob merges into Bob's row, broadest level wins
  db._put(`emailSuppressions/${hashEmail(BOB.email)}`, { email: BOB.email, scope: 'all', method: 'link', source: 'notification:invite', createdAt: new Date('2026-08-01') });
  const res = await listUnsubs(authed('admin-token', 'GET'));
  assert.strictEqual(res.statusCode, 200);
  const body = JSON.parse(res.body);
  const by = Object.fromEntries(body.current.map((r) => [r.email, r]));
  assert.strictEqual(body.current.length, 3);
  assert.deepStrictEqual([by[ALICE.email].level, by[ALICE.email].method, by[ALICE.email].date, by[ALICE.email].displayName], ['all', 'legacy', null, 'Alice']);
  assert.deepStrictEqual([by[BOB.email].level, by[BOB.email].handle], ['all', 'bob']);
  assert.deepStrictEqual([by['friend@example.com'].level, by['friend@example.com'].method, by['friend@example.com'].uid], ['announcements', 'one-click', null]);
  assert.strictEqual(body.events.length, 1, 'legacy opt-outs get no invented events');
});

run('unsubscribe flows');
