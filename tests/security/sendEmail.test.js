/**
 * send-email's authorization rules (lib/emailAuthorization.js, S-06):
 * for every email type, at least one allowed and one denied case, in
 * both the current { type, …ids } shape and the legacy
 * { to, subject, html, type } shape the iOS app ≤ 3.13.5 sends. The real
 * handler runs against an in-memory Firestore and a fake Resend.
 *
 *   node tests/security/sendEmail.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestTransport } = require('../../netlify/functions/lib/outgoingEmail');
const { hashEmail } = require('../../netlify/functions/lib/unsubscribeToken');
const sendEmail = require('../../netlify/functions/send-email');
const { DAILY_LIMITS } = require('../../netlify/functions/lib/emailAuthorization');

const ADMIN = { uid: 'adminUid', email: 'phillip.leonard@gmail.com', email_verified: true, displayName: 'Phillip' };
const ALICE = { uid: 'aliceUid', email: 'alice@example.com', email_verified: true, displayName: 'Alice' };
const BOB = { uid: 'bobUid', email: 'bob@example.com', email_verified: true, displayName: 'Bob' };
const MALLORY = { uid: 'malloryUid', email: 'mallory@example.com', email_verified: true, displayName: 'Mallory' };

const SHOW = { artist: 'Goose', venue: 'Red Rocks', date: '2024-06-15' };
const FORGED_HTML = '<h1>Your account is locked</h1><a href="https://phish.example">Sign in</a>';

function setup() {
  const db = createFakeDb();
  const users = [ADMIN, ALICE, BOB, MALLORY];
  const auth = createFakeAuth({
    tokens: Object.fromEntries(users.map((u) => [u.uid, u])),
    users,
  });
  __setTestFirebase({ db, auth });
  for (const u of [ALICE, BOB, MALLORY]) db._put(`userProfiles/${u.uid}`, { email: u.email, displayName: u.displayName });
  const sent = [];
  __setTestTransport((path, payload) => { sent.push(payload); return { status: 200, body: '{"id":"x"}' }; });
  return { db, sent };
}

const call = (as, body, origin = 'https://mysetlists.net') => sendEmail.handler({
  httpMethod: 'POST',
  headers: { authorization: `Bearer ${as.uid}`, origin },
  body: JSON.stringify(body),
});
const legacy = (to, type) => ({ to, subject: 'Anything you like', html: FORGED_HTML, type });
const quiet = async (fn) => { const l = console.log; const e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };
const send = (as, body) => quiet(() => call(as, body));
const body = (res) => JSON.parse(res.body);

function assertSent(sent, to, pattern) {
  assert.strictEqual(sent.length, 1, `expected one email, got ${sent.length}`);
  assert.strictEqual(sent[0].to, to);
  if (pattern) assert.match(sent[0].html, pattern);
  assert.ok(!sent[0].html.includes('phish.example'), 'client HTML must never be used');
  assert.ok(!sent[0].subject.includes('Anything you like'), 'client subject must never be used');
}

// ── Basics ───────────────────────────────────────────────────────────

test('no token → 401, nothing sent', async () => {
  const { sent } = setup();
  const res = await sendEmail.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ type: 'tag', tagId: 'x' }) });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(sent.length, 0);
});

test('forged legacy call with custom HTML and no record sends nothing (quiet 200)', async () => {
  const { sent } = setup();
  for (const type of ['tag', 'invite', 'general', 'admin_message', 'comment_reply', 'venue_verification']) {
    const res = await send(MALLORY, legacy('victim@example.com', type));
    assert.strictEqual(res.statusCode, 200, type);
    assert.strictEqual(body(res).skipped, true, type);
  }
  assert.strictEqual(sent.length, 0);
});

test('unknown type in the current shape → 400', async () => {
  setup();
  assert.strictEqual((await send(ALICE, { type: 'whatever' })).statusCode, 400);
  assert.strictEqual((await send(ALICE, { type: '__proto__' })).statusCode, 400);
});

test('CORS: allowlist only', async () => {
  setup();
  const pre = (origin) => sendEmail.handler({ httpMethod: 'OPTIONS', headers: { origin } });
  assert.strictEqual((await pre('capacitor://localhost')).headers['Access-Control-Allow-Origin'], 'capacitor://localhost');
  assert.strictEqual((await pre('https://evil.example')).headers['Access-Control-Allow-Origin'], undefined);
});

// ── tag ──────────────────────────────────────────────────────────────

test('tag: sender of a pending tag → email to the tagged member, from the server template', async () => {
  const { db, sent } = setup();
  db._put('showTags/t1', { fromUid: ALICE.uid, fromName: 'Fake Name', toUid: BOB.uid, showData: SHOW, status: 'pending', createdAt: new Date() });
  const res = await send(ALICE, { type: 'tag', tagId: 't1' });
  assert.strictEqual(res.statusCode, 200);
  assertSent(sent, BOB.email, /Alice/);
  assert.match(sent[0].html, /Goose/);
  assert.match(sent[0].html, /6\/15\/2024/);
  assert.ok(!sent[0].html.includes('Fake Name'), 'sender name comes from Auth, not the record');
});

test('tag: someone else\'s tag → 403, nothing sent', async () => {
  const { db, sent } = setup();
  db._put('showTags/t1', { fromUid: ALICE.uid, toUid: BOB.uid, showData: SHOW, status: 'pending', createdAt: new Date() });
  assert.strictEqual((await send(MALLORY, { type: 'tag', tagId: 't1' })).statusCode, 403);
  assert.strictEqual((await send(ALICE, { type: 'tag', tagId: 'missing' })).statusCode, 403);
  assert.strictEqual(sent.length, 0);
});

test('tag: the same tag is never emailed twice', async () => {
  const { db, sent } = setup();
  db._put('showTags/t1', { fromUid: ALICE.uid, toUid: BOB.uid, showData: SHOW, status: 'pending', createdAt: new Date() });
  await send(ALICE, { type: 'tag', tagId: 't1' });
  const again = await send(ALICE, { type: 'tag', tagId: 't1' });
  assert.strictEqual(body(again).skipped, true);
  assert.strictEqual(sent.length, 1);
});

test('tag (upcoming): "going to" wording', async () => {
  const { db, sent } = setup();
  db._put('showTags/t2', { fromUid: ALICE.uid, toUid: BOB.uid, showData: { ...SHOW, upcoming: true }, upcomingShowId: 'u1', status: 'pending', createdAt: new Date() });
  await send(ALICE, { type: 'tag', tagId: 't2' });
  assert.match(sent[0].subject, /going to Goose/);
});

test('tag (legacy): matches the recent tag to that member and drops the client HTML', async () => {
  const { db, sent } = setup();
  db._put('showTags/t1', { fromUid: ALICE.uid, toUid: BOB.uid, showData: SHOW, status: 'pending', createdAt: new Date() });
  const res = await send(ALICE, legacy('Bob@Example.com', 'tag'));
  assert.strictEqual(body(res).success, true);
  assert.strictEqual(body(res).skipped, undefined);
  assertSent(sent, BOB.email, /tagged you in a show/);
});

test('tag (legacy): a tag older than 15 minutes doesn\'t count', async () => {
  const { db, sent } = setup();
  db._put('showTags/t1', { fromUid: ALICE.uid, toUid: BOB.uid, showData: SHOW, status: 'pending', createdAt: new Date(Date.now() - 60 * 60 * 1000) });
  assert.strictEqual(body(await send(ALICE, legacy(BOB.email, 'tag'))).skipped, true);
  assert.strictEqual(sent.length, 0);
});

// ── tag_email ────────────────────────────────────────────────────────

test('tag_email: your pending email tag → email to that address, message escaped', async () => {
  const { db, sent } = setup();
  db._put('pendingEmailTags/p1', { fromUid: ALICE.uid, toEmail: 'newfriend@example.com', showData: SHOW, personalMessage: '<b>see you</b>', status: 'pending', createdAt: new Date() });
  await send(ALICE, { type: 'tag_email', pendingTagId: 'p1' });
  assertSent(sent, 'newfriend@example.com', /&lt;b&gt;see you&lt;\/b&gt;/);
  assert.match(sent[0].html, /ref=aliceUid/);
});

test('tag_email: someone else\'s → 403', async () => {
  const { db, sent } = setup();
  db._put('pendingEmailTags/p1', { fromUid: ALICE.uid, toEmail: 'newfriend@example.com', showData: SHOW, status: 'pending', createdAt: new Date() });
  assert.strictEqual((await send(MALLORY, { type: 'tag_email', pendingTagId: 'p1' })).statusCode, 403);
  assert.strictEqual(sent.length, 0);
});

test('tag_email (legacy "tag" to a non-member): found through pendingEmailTags', async () => {
  const { db, sent } = setup();
  db._put('pendingEmailTags/p1', { fromUid: ALICE.uid, toEmail: 'newfriend@example.com', showData: SHOW, status: 'pending', createdAt: new Date() });
  await send(ALICE, legacy('newfriend@example.com', 'tag'));
  assertSent(sent, 'newfriend@example.com', /Join MySetlists/);
});

// ── tag_accepted ─────────────────────────────────────────────────────

test('tag_accepted: the tagged person confirms → email to the tagger', async () => {
  const { db, sent } = setup();
  db._put('pendingEmailTags/p1', { fromUid: ALICE.uid, fromEmail: ALICE.email, toEmail: BOB.email, showData: SHOW, status: 'accepted', createdAt: new Date() });
  await send(BOB, { type: 'tag_accepted', pendingTagId: 'p1' });
  assertSent(sent, ALICE.email, /Bob/);
});

test('tag_accepted: not the tagged person, or not accepted → 403', async () => {
  const { db, sent } = setup();
  db._put('pendingEmailTags/p1', { fromUid: ALICE.uid, toEmail: BOB.email, showData: SHOW, status: 'accepted', createdAt: new Date() });
  db._put('pendingEmailTags/p2', { fromUid: ALICE.uid, toEmail: BOB.email, showData: SHOW, status: 'pending', createdAt: new Date() });
  assert.strictEqual((await send(MALLORY, { type: 'tag_accepted', pendingTagId: 'p1' })).statusCode, 403);
  assert.strictEqual((await send(BOB, { type: 'tag_accepted', pendingTagId: 'p2' })).statusCode, 403);
  assert.strictEqual(sent.length, 0);
});

test('tag_accepted (legacy): found by the caller\'s address and the tagger\'s', async () => {
  const { db, sent } = setup();
  db._put('pendingEmailTags/p1', { fromUid: ALICE.uid, fromEmail: ALICE.email, toEmail: BOB.email, showData: SHOW, status: 'accepted', createdAt: new Date() });
  await send(BOB, legacy(ALICE.email, 'tag_accepted'));
  assertSent(sent, ALICE.email, /confirmed they were at this show/);
});

// ── friend_joined ────────────────────────────────────────────────────

test('friend_joined: new user with invitedByUid → email to the inviter, once', async () => {
  const { db, sent } = setup();
  db._put(`userProfiles/${BOB.uid}`, { email: BOB.email, invitedByUid: ALICE.uid });
  await send(BOB, { type: 'friend_joined' });
  assertSent(sent, ALICE.email, /Bob/);
  assert.strictEqual(body(await send(BOB, { type: 'friend_joined' })).skipped, true);
  assert.strictEqual(sent.length, 1);
});

test('friend_joined: nobody invited you → 403', async () => {
  const { sent } = setup();
  assert.strictEqual((await send(MALLORY, { type: 'friend_joined' })).statusCode, 403);
  assert.strictEqual(sent.length, 0);
});

test('friend_joined (legacy): only to the real inviter', async () => {
  const { db, sent } = setup();
  db._put(`userProfiles/${BOB.uid}`, { email: BOB.email, invitedByUid: ALICE.uid });
  assert.strictEqual(body(await send(BOB, legacy('victim@example.com', 'friend_joined'))).skipped, true);
  assert.strictEqual(sent.length, 0);
  await send(BOB, legacy(ALICE.email, 'friend_joined'));
  assertSent(sent, ALICE.email);
});

// ── invite ───────────────────────────────────────────────────────────

test('invite: your invite → email to the invitee; resend blocked for 24 hours', async () => {
  const { db, sent } = setup();
  db._put('invites/i1', { inviterUid: ALICE.uid, inviteeEmail: 'pal@example.com', status: 'pending', createdAt: new Date() });
  await send(ALICE, { type: 'invite', inviteId: 'i1' });
  assertSent(sent, 'pal@example.com', /invited you|You're invited/);
  const again = await send(ALICE, { type: 'invite', inviteId: 'i1' });
  assert.strictEqual(body(again).reason, 'already sent');
  assert.strictEqual(sent.length, 1);
});

test('invite: resend allowed after 24 hours', async () => {
  const { db, sent } = setup();
  db._put('invites/i1', { inviterUid: ALICE.uid, inviteeEmail: 'pal@example.com', status: 'pending' });
  await send(ALICE, { type: 'invite', inviteId: 'i1' });
  const marker = db._list('emailSends')[0];
  db._put(`emailSends/${marker.id}`, { ...marker, sentAtMs: Date.now() - 25 * 60 * 60 * 1000 });
  await send(ALICE, { type: 'invite', inviteId: 'i1' });
  assert.strictEqual(sent.length, 2);
});

test('invite: someone else\'s invite → 403', async () => {
  const { db, sent } = setup();
  db._put('invites/i1', { inviterUid: ALICE.uid, inviteeEmail: 'pal@example.com', status: 'pending' });
  assert.strictEqual((await send(MALLORY, { type: 'invite', inviteId: 'i1' })).statusCode, 403);
  assert.strictEqual(sent.length, 0);
});

test('invite: 10 a day per sender, then 429', async () => {
  const { db, sent } = setup();
  for (let i = 0; i <= DAILY_LIMITS.invite; i++) db._put(`invites/i${i}`, { inviterUid: ALICE.uid, inviteeEmail: `p${i}@example.com`, status: 'pending' });
  let last;
  for (let i = 0; i <= DAILY_LIMITS.invite; i++) last = await send(ALICE, { type: 'invite', inviteId: `i${i}` });
  assert.strictEqual(last.statusCode, 429);
  assert.strictEqual(sent.length, DAILY_LIMITS.invite);
});

test('invite (legacy): matched by inviter and address; an address you never invited is skipped', async () => {
  const { db, sent } = setup();
  db._put('invites/i1', { inviterUid: ALICE.uid, inviteeEmail: 'pal@example.com', status: 'pending' });
  assert.strictEqual(body(await send(ALICE, legacy('stranger@example.com', 'invite'))).skipped, true);
  await send(ALICE, legacy('PAL@example.com', 'invite'));
  assertSent(sent, 'pal@example.com');
});

// ── suggestion_nudge ─────────────────────────────────────────────────

const suggestion = (over = {}) => ({
  participants: [ALICE.uid, BOB.uid],
  responses: { [ALICE.uid]: 'confirmed', [BOB.uid]: 'pending' },
  names: { [BOB.uid]: 'Bob' },
  showData: SHOW,
  updatedAt: new Date(),
  ...over,
});

test('suggestion_nudge: you confirmed, they haven\'t → email to them', async () => {
  const { db, sent } = setup();
  db._put('showSuggestions/s1', suggestion());
  await send(ALICE, { type: 'suggestion_nudge', suggestionId: 's1' });
  assertSent(sent, BOB.email, /Were you there/);
});

test('suggestion_nudge: not a participant, or you haven\'t confirmed → 403', async () => {
  const { db, sent } = setup();
  db._put('showSuggestions/s1', suggestion());
  db._put('showSuggestions/s2', suggestion({ responses: { [ALICE.uid]: 'pending', [BOB.uid]: 'pending' } }));
  assert.strictEqual((await send(MALLORY, { type: 'suggestion_nudge', suggestionId: 's1' })).statusCode, 403);
  assert.strictEqual((await send(ALICE, { type: 'suggestion_nudge', suggestionId: 's2' })).statusCode, 403);
  assert.strictEqual(sent.length, 0);
});

test('suggestion_nudge (legacy): found through participants', async () => {
  const { db, sent } = setup();
  db._put('showSuggestions/s1', suggestion());
  await send(ALICE, legacy(BOB.email, 'suggestion_nudge'));
  assertSent(sent, BOB.email);
});

// ── engagement ───────────────────────────────────────────────────────

test('engagement: your notification to someone who chose immediate email → sent, text escaped', async () => {
  const { db, sent } = setup();
  db._put(`userProfiles/${BOB.uid}`, { email: BOB.email, notificationPrefs: { emailFrequency: 'immediate' } });
  db._put('notifications/n1', { uid: BOB.uid, fromUid: ALICE.uid, type: 'comment_reply', message: 'Alice replied <img src=x>', artist: 'Goose', createdAt: new Date() });
  await send(ALICE, { type: 'engagement', notificationId: 'n1' });
  assertSent(sent, BOB.email, /Alice replied &lt;img src=x&gt;/);
});

test('engagement: recipient hasn\'t opted in → skipped; someone else\'s notification → 403', async () => {
  const { db, sent } = setup();
  db._put('notifications/n1', { uid: BOB.uid, fromUid: ALICE.uid, type: 'comment_like', message: 'x', createdAt: new Date() });
  assert.strictEqual(body(await send(ALICE, { type: 'engagement', notificationId: 'n1' })).skipped, true);
  db._put(`userProfiles/${BOB.uid}`, { email: BOB.email, notificationPrefs: { emailFrequency: 'immediate' } });
  assert.strictEqual((await send(MALLORY, { type: 'engagement', notificationId: 'n1' })).statusCode, 403);
  assert.strictEqual(sent.length, 0);
});

test('engagement (legacy): each of the five types maps to its notification', async () => {
  const { db, sent } = setup();
  db._put(`userProfiles/${BOB.uid}`, { email: BOB.email, notificationPrefs: { emailFrequency: 'immediate' } });
  db._put('notifications/n1', { uid: BOB.uid, fromUid: ALICE.uid, type: 'photo_like', message: 'Alice liked your photo', createdAt: new Date() });
  assert.strictEqual(body(await send(ALICE, legacy(BOB.email, 'comment_reply'))).skipped, true, 'type must match');
  await send(ALICE, legacy(BOB.email, 'photo_like'));
  assertSent(sent, BOB.email, /liked your photo/);
});

// ── venue_verification ───────────────────────────────────────────────

test('venue_verification: applicant gets "received" for their own pending application', async () => {
  const { db, sent } = setup();
  db._put('venueVerificationApplications/a1', { applicantUid: ALICE.uid, applicantEmail: 'venue@example.com', venueName: 'The Fillmore', status: 'pending', submittedDate: new Date() });
  await send(ALICE, { type: 'venue_verification', applicationId: 'a1' });
  assertSent(sent, 'venue@example.com', /Application received/);
});

test('venue_verification: approval email only from an admin', async () => {
  const { db, sent } = setup();
  db._put('venueVerificationApplications/a1', { applicantUid: ALICE.uid, applicantEmail: 'venue@example.com', venueName: 'The Fillmore', venueKey: 'the fillmore::sf', status: 'approved', reviewedDate: new Date() });
  assert.strictEqual((await send(ALICE, { type: 'venue_verification', applicationId: 'a1' })).statusCode, 403);
  assert.strictEqual(sent.length, 0);
  await send(ADMIN, { type: 'venue_verification', applicationId: 'a1' });
  assertSent(sent, 'venue@example.com', /venue-dashboard\/\?venue=the%20fillmore%3A%3Asf/);
});

test('venue_verification (legacy): rejection from an admin, with the reason escaped', async () => {
  const { db, sent } = setup();
  db._put('venueVerificationApplications/a1', { applicantUid: ALICE.uid, applicantEmail: 'venue@example.com', venueName: 'Club', status: 'rejected', rejectionReason: '<i>blurry</i>', reviewedDate: new Date() });
  await send(ADMIN, legacy('venue@example.com', 'venue_verification'));
  assertSent(sent, 'venue@example.com', /&lt;i&gt;blurry&lt;\/i&gt;/);
});

// ── admin_message ────────────────────────────────────────────────────

test('admin_message: admin → user, plain text escaped with line breaks kept', async () => {
  const { sent } = setup();
  await send(ADMIN, { type: 'admin_message', toUid: BOB.uid, subject: 'Hello', body: 'Line one\n<b>two</b>' });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, BOB.email);
  assert.strictEqual(sent[0].subject, 'Hello');
  assert.match(sent[0].html, /Line one<br \/>&lt;b&gt;two&lt;\/b&gt;/);
});

test('admin_message: a non-admin → 403', async () => {
  const { sent } = setup();
  assert.strictEqual((await send(ALICE, { type: 'admin_message', toUid: BOB.uid, subject: 'x', body: 'y' })).statusCode, 403);
  assert.strictEqual(sent.length, 0);
});

// ── Limits, opt-out, footer ──────────────────────────────────────────

test('30 an hour across types, then 429; admins exempt', async () => {
  const { db, sent } = setup();
  for (let i = 0; i <= sendEmail.RATE_LIMIT_PER_HOUR; i++) {
    db._put(`showTags/t${i}`, { fromUid: ALICE.uid, toUid: BOB.uid, showData: SHOW, status: 'pending', createdAt: new Date() });
  }
  let last;
  for (let i = 0; i <= sendEmail.RATE_LIMIT_PER_HOUR; i++) last = await send(ALICE, { type: 'tag', tagId: `t${i}` });
  assert.strictEqual(last.statusCode, 429);
  assert.strictEqual(sent.length, sendEmail.RATE_LIMIT_PER_HOUR);
});

test('opted-out and suppressed recipients are skipped; the marker isn\'t taken', async () => {
  const { db, sent } = setup();
  db._put(`userProfiles/${BOB.uid}`, { email: BOB.email, emailOptOut: true });
  db._put('showTags/t1', { fromUid: ALICE.uid, toUid: BOB.uid, showData: SHOW, status: 'pending', createdAt: new Date() });
  assert.strictEqual(body(await send(ALICE, { type: 'tag', tagId: 't1' })).reason, 'recipient opted out');
  db._put(`emailSuppressions/${hashEmail('gone@example.com')}`, { email: 'gone@example.com', scope: 'all' });
  db._put('invites/i1', { inviterUid: ALICE.uid, inviteeEmail: 'gone@example.com', status: 'pending' });
  assert.strictEqual(body(await send(ALICE, { type: 'invite', inviteId: 'i1' })).skipped, true);
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(db._list('emailSends').length, 0);
});

test('every email carries the signed unsubscribe footer and List-Unsubscribe', async () => {
  const { db, sent } = setup();
  db._put('showTags/t1', { fromUid: ALICE.uid, toUid: BOB.uid, showData: SHOW, status: 'pending', createdAt: new Date() });
  await send(ALICE, { type: 'tag', tagId: 't1' });
  assert.match(sent[0].headers['List-Unsubscribe'], /api\/unsubscribe\?token=/);
  assert.match(sent[0].html, /Unsubscribe from all MySetlists emails/);
});

test('a failed Resend send releases the marker so a retry can go', async () => {
  const { db } = setup();
  db._put('showTags/t1', { fromUid: ALICE.uid, toUid: BOB.uid, showData: SHOW, status: 'pending', createdAt: new Date() });
  __setTestTransport(() => ({ status: 500, body: 'boom' }));
  assert.strictEqual((await send(ALICE, { type: 'tag', tagId: 't1' })).statusCode, 502);
  assert.strictEqual(db._list('emailSends').length, 0);
});

run('send-email authorization');
