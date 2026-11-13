/**
 * Announcements: the recipient builder, and admin-send-announcement's
 * preview / test / send / resume / retry behaviour against an in-memory
 * Firestore and a fake Resend.
 *
 *   node tests/email/announcements.test.js
 */

const { test, run } = require('./harness');
const assert = require('node:assert');
const { createFakeDb, createFakeAuth } = require('./fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestTransport } = require('../../netlify/functions/lib/outgoingEmail');
const { hashEmail, verify } = require('../../netlify/functions/lib/unsubscribeToken');
const { buildAnnouncementRecipients, splitEmailList } = require('../../netlify/functions/lib/announcementRecipients');
const mod = require('../../netlify/functions/admin-send-announcement');

mod.__setSleep(async () => {});

// The crash-simulation tests make the handler log on purpose.
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

// ── Recipient builder ────────────────────────────────────────────────

test('splitEmailList: newlines, commas, semicolons, blanks', () => {
  assert.deepStrictEqual(splitEmailList('a@x.co, b@y.co\n\nc@z.co;d@w.co  '), ['a@x.co', 'b@y.co', 'c@z.co', 'd@w.co']);
  assert.deepStrictEqual(splitEmailList(['a@x.co\nb@y.co', 'c@z.co']), ['a@x.co', 'b@y.co', 'c@z.co']);
});

test('builder: dedupe, normalise, invalid, opted out, suppressed, extra that is a user', () => {
  const profiles = [
    { uid: 'u1', email: 'One@Example.com' },
    { uid: 'u2', email: 'two@example.com', emailOptOut: true },
    { uid: 'u3', email: 'three@example.com', announcementsOptOut: true },
    { uid: 'u4', email: 'four@example.com' },           // suppressed by address
    { uid: 'u5', email: '' },                           // no email: ignored
    { uid: 'u6', email: 'not-an-email' },               // invalid
  ];
  const suppressions = new Map([
    [hashEmail('four@example.com'), 'announcements'],
    [hashEmail('gone@example.com'), 'all'],
    [hashEmail('newsonly@example.com'), 'announcements'],
  ]);
  const extraEmails = [
    'friend@example.com',
    ' FRIEND@example.com ',   // duplicate after normalising
    'one@example.com',        // belongs to u1: counted as a user, not an extra
    'two@example.com',        // belongs to opted-out u2: stays excluded
    'gone@example.com',       // suppressed (all)
    'newsonly@example.com',   // suppressed (announcements)
    'bad@',                   // invalid
  ].join('\n');
  const { recipients, counts } = buildAnnouncementRecipients({ profiles, extraEmails, suppressions });
  assert.deepStrictEqual(recipients.map((r) => r.email).sort(), ['friend@example.com', 'one@example.com']);
  assert.deepStrictEqual(recipients.find((r) => r.email === 'one@example.com'), { email: 'one@example.com', uid: 'u1', hash: hashEmail('one@example.com') });
  assert.strictEqual(recipients.find((r) => r.email === 'friend@example.com').uid, null);
  assert.deepStrictEqual(counts, { total: 2, users: 1, extras: 1, excluded: 5, invalid: 2, duplicates: 3 });
});

test('builder: announcements opt-out excludes, notification-level state does not matter otherwise', () => {
  const { counts } = buildAnnouncementRecipients({
    profiles: [{ uid: 'a', email: 'a@example.com', announcementsOptOut: false, emailOptOut: false }],
  });
  assert.strictEqual(counts.total, 1);
});

// ── admin-send-announcement ──────────────────────────────────────────

const ADMIN = { uid: 'adminUid000001', email: 'phillip.leonard@gmail.com', email_verified: true };

function setup({ users = 3, transport } = {}) {
  const db = createFakeDb();
  __setTestFirebase({ db, auth: createFakeAuth({ tokens: { admin: ADMIN }, users: [ADMIN] }) });
  db._put(`userProfiles/${ADMIN.uid}`, { email: ADMIN.email });
  for (let i = 0; i < users; i++) db._put(`userProfiles/user${i}`, { email: `user${i}@example.com` });
  const calls = [];
  __setTestTransport((path, payload, opts) => {
    calls.push({ path, payload, opts });
    if (transport) return transport(path, payload, opts, calls.length);
    const data = Array.isArray(payload) ? payload.map((_, i) => ({ id: `re_${calls.length}_${i}` })) : { id: 're_x' };
    return { status: 200, body: JSON.stringify(Array.isArray(payload) ? { data } : data) };
  });
  return { db, calls };
}

const call = (body) => mod.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer admin' }, body: JSON.stringify(body) });
// `http` rather than `status`: a send response has its own `status` field.
const parse = async (p) => { const r = await p; return { ...JSON.parse(r.body), http: r.statusCode }; };
const recipientsOf = (db, id) => db._list(`announcements/${id}/recipients`);
const allSentTo = (calls) => calls.filter((c) => c.path === '/emails/batch').flatMap((c) => c.payload.map((p) => p.to));

test('preview: counts only, nothing sent or written', async () => {
  const { db, calls } = setup({ users: 2 });
  db._put('userProfiles/opted', { email: 'opted@example.com', announcementsOptOut: true });
  const before = db._writes.length;
  const r = await parse(call({ mode: 'preview', extraEmails: ['x@example.com', 'user0@example.com', 'bad'] }));
  assert.strictEqual(r.http, 200);
  assert.deepStrictEqual(r.counts, { total: 4, users: 3, extras: 1, excluded: 1, invalid: 1, duplicates: 1 });
  assert.deepStrictEqual(r.missingConfig, []);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(db._writes.length, before);
});

test('test: only to the admin, with a real announcements unsubscribe link, headers and address', async () => {
  const { calls } = setup();
  const r = await parse(call({ mode: 'test', subject: 'We launched', html: '<p>Hello</p>' }));
  assert.strictEqual(r.http, 200);
  assert.strictEqual(calls.length, 1);
  const p = calls[0].payload;
  assert.strictEqual(p.to, ADMIN.email);
  assert.strictEqual(p.subject, '[Test] We launched');
  assert.strictEqual(p.from, 'Phillip <phillip@mysetlists.net>');
  assert.strictEqual(p.reply_to, ADMIN.email);
  assert.strictEqual(p.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const token = decodeURIComponent(p.headers['List-Unsubscribe'].slice(1, -1).split('token=')[1]);
  assert.deepStrictEqual(verify(token), { kind: 'uid', id: ADMIN.uid, scope: 'announcements', source: 'announcement:test' });
  assert.match(p.html, /Unsubscribe from announcements/);
  assert.match(p.html, /PO Box 123, Nashville, TN 37201/);
  assert.match(p.html, /<p>Hello<\/p>/);
});

test('refuses to send without MAILING_ADDRESS or UNSUBSCRIBE_SECRET', async () => {
  for (const key of ['MAILING_ADDRESS', 'UNSUBSCRIBE_SECRET']) {
    const { calls } = setup();
    const saved = process.env[key];
    process.env[key] = '';
    try {
      for (const mode of ['test', 'send']) {
        const r = await parse(call({ mode, subject: 's', html: '<p>h</p>' }));
        assert.strictEqual(r.http, 412, `${mode} without ${key}`);
        assert.ok(r.missingConfig.includes(key));
      }
      const p = await parse(call({ mode: 'preview' }));
      assert.ok(p.missingConfig.includes(key), 'preview reports it');
    } finally { process.env[key] = saved; }
    assert.strictEqual(calls.length, 0);
  }
});

test('send: records the announcement, one doc per recipient, sends each their own link', async () => {
  const { db, calls } = setup({ users: 3 });
  const r = await parse(call({ mode: 'send', subject: 'Launch', html: '<p>Hi</p>', extraEmails: ['pal@example.com'] }));
  assert.strictEqual(r.http, 200);
  assert.strictEqual(r.remaining, 0);
  assert.deepStrictEqual(r.counts, { total: 5, sent: 5, failed: 0, skipped: 0, pending: 0 });
  const ann = db._get(`announcements/${r.announcementId}`);
  assert.strictEqual(ann.subject, 'Launch');
  assert.strictEqual(ann.status, 'completed');
  assert.strictEqual(ann.createdBy, ADMIN.email);
  const recs = recipientsOf(db, r.announcementId);
  assert.strictEqual(recs.length, 5);
  assert.ok(recs.every((x) => x.status === 'sent' && x.id === hashEmail(x.email)));
  const batch = calls.filter((c) => c.path === '/emails/batch');
  assert.strictEqual(batch.length, 1);
  assert.ok(batch[0].opts.idempotencyKey, 'batch carries an idempotency key');
  const tokens = batch[0].payload.map((p) => verify(decodeURIComponent(p.headers['List-Unsubscribe'].slice(1, -1).split('token=')[1])));
  const pal = tokens.find((t) => t.kind === 'email');
  assert.deepStrictEqual(pal, { kind: 'email', id: 'pal@example.com', scope: 'announcements', source: `announcement:${r.announcementId}` });
  assert.strictEqual(new Set(tokens.map((t) => t.id)).size, 5, 'every recipient has their own link');
});

test('send: batches of at most 100', async () => {
  const { calls } = setup({ users: 230 });
  const r = await parse(call({ mode: 'send', subject: 'Big', html: '<p>x</p>' }));
  let res = r;
  while (res.remaining > 0) res = await parse(call({ mode: 'send', announcementId: r.announcementId }));
  const sizes = calls.filter((c) => c.path === '/emails/batch').map((c) => c.payload.length);
  assert.ok(sizes.every((n) => n <= 100));
  assert.strictEqual(sizes.reduce((a, b) => a + b, 0), 231);
});

test('re-running a finished send never emails anyone twice', async () => {
  const { calls } = setup({ users: 4 });
  const r = await parse(call({ mode: 'send', subject: 'Once', html: '<p>x</p>' }));
  await parse(call({ mode: 'send', announcementId: r.announcementId }));
  await parse(call({ mode: 'send', announcementId: r.announcementId, retryFailed: true }));
  const to = allSentTo(calls);
  assert.strictEqual(to.length, 5);
  assert.strictEqual(new Set(to).size, 5);
});

test('a batch claimed by a call that died is re-posted with the same idempotency key', async () => {
  const { db, calls } = setup({ users: 2 });
  // First call: Resend accepts, but we "die" before recording it — simulate
  // by failing the transport with a timeout-like status past the budget.
  let die = true;
  __setTestTransport((path, payload, opts) => {
    calls.push({ path, payload, opts });
    if (die) { die = false; throw new Error('function killed'); }
    return { status: 200, body: JSON.stringify({ data: payload.map(() => ({ id: 're' })) }) };
  });
  let r;
  r = await quiet(() => parse(call({ mode: 'send', subject: 'Crash', html: '<p>x</p>' })));
  assert.strictEqual(r.http, 500);
  const annId = db._list('announcements')[0].id;
  const claimed = recipientsOf(db, annId).filter((x) => x.status === 'sending');
  assert.strictEqual(claimed.length, 3, 'recipients were claimed before the post');
  assert.strictEqual(db._get(`announcements/${annId}`).leaseUntil, null, 'lease handed back after an error');
  const resumed = await parse(call({ mode: 'send', announcementId: annId }));
  assert.strictEqual(resumed.remaining, 0);
  assert.strictEqual(calls[0].opts.idempotencyKey, calls[1].opts.idempotencyKey);
  assert.ok(recipientsOf(db, annId).every((x) => x.status === 'sent'));
});

test('429s back off and retry with the same key', async () => {
  const { calls } = setup({
    users: 1,
    transport: (path, payload, opts, n) => (n < 3
      ? { status: 429, body: 'slow down', retryAfter: 1 }
      : { status: 200, body: JSON.stringify({ data: payload.map(() => ({ id: 'ok' })) }) }),
  });
  const r = await parse(call({ mode: 'send', subject: 'x', html: '<p>x</p>' }));
  assert.strictEqual(r.counts.sent, 2);
  const keys = calls.map((c) => c.opts.idempotencyKey);
  assert.strictEqual(new Set(keys).size, 1);
});

test('permanent failures are marked failed; Retry failed sends only those', async () => {
  let fail = true;
  const { db, calls } = setup({
    users: 2,
    transport: (path, payload) => (fail
      ? { status: 422, body: 'bad' }
      : { status: 200, body: JSON.stringify({ data: payload.map(() => ({ id: 'ok' })) }) }),
  });
  const r = await parse(call({ mode: 'send', subject: 'x', html: '<p>x</p>' }));
  assert.deepStrictEqual([r.counts.failed, r.remaining], [3, 0]);
  assert.strictEqual(db._get(`announcements/${r.announcementId}`).status, 'completed_with_errors');
  assert.ok(recipientsOf(db, r.announcementId).every((x) => /Resend 422/.test(x.error)));
  fail = false;
  const again = await parse(call({ mode: 'send', announcementId: r.announcementId, retryFailed: true }));
  assert.deepStrictEqual([again.counts.sent, again.counts.failed], [3, 0]);
  assert.strictEqual(calls.length, 2);
});

test('someone who unsubscribes mid-send is skipped, not mailed', async () => {
  const { db, calls } = setup({ users: 2 });
  // Create the announcement but make the first send attempt stop before sending
  __setTestTransport(() => { throw new Error('stop'); });
  await quiet(() => call({ mode: 'send', subject: 'x', html: '<p>x</p>' }));
  const annId = db._list('announcements')[0].id;
  // Reset to pending as if never claimed, then user0 opts out
  for (const r of recipientsOf(db, annId)) db._put(`announcements/${annId}/recipients/${r.id}`, { ...r, status: 'pending', batchKey: null });
  db._put(`announcements/${annId}`, { ...db._get(`announcements/${annId}`), leaseUntil: null });
  db._put('userProfiles/user0', { email: 'user0@example.com', announcementsOptOut: true });
  __setTestTransport((path, payload) => { calls.push({ path, payload }); return { status: 200, body: JSON.stringify({ data: [] }) }; });
  const r = await parse(call({ mode: 'send', announcementId: annId }));
  assert.strictEqual(r.counts.skipped, 1);
  assert.ok(!allSentTo(calls).includes('user0@example.com'));
});

test('a second window gets 409 while the first holds the lease', async () => {
  const { db } = setup({ users: 1 });
  const r = await parse(call({ mode: 'send', subject: 'x', html: '<p>x</p>' }));
  db._put(`announcements/${r.announcementId}`, { ...db._get(`announcements/${r.announcementId}`), leaseUntil: new Date(Date.now() + 60000) });
  const busy = await parse(call({ mode: 'send', announcementId: r.announcementId }));
  assert.strictEqual(busy.http, 409);
  assert.strictEqual(busy.busy, true);
});

test('history: counts and unsubscribes per announcement', async () => {
  const { db } = setup({ users: 1 });
  const r = await parse(call({ mode: 'send', subject: 'Hist', html: '<p>x</p>' }));
  db._put('unsubscribeEvents/e1', { email: 'user0@example.com', action: 'unsubscribe', source: `announcement:${r.announcementId}`, createdAt: new Date() });
  db._put('unsubscribeEvents/e2', { email: 'user0@example.com', action: 'unsubscribe', source: `announcement:${r.announcementId}`, createdAt: new Date() }); // same person twice
  db._put('unsubscribeEvents/e3', { email: 'x@example.com', action: 'unsubscribe', source: 'notification:tag', createdAt: new Date() });
  const h = await parse(call({ mode: 'history' }));
  assert.strictEqual(h.announcements.length, 1);
  assert.strictEqual(h.announcements[0].unsubscribes, 1);
  assert.strictEqual(h.announcements[0].counts.sent, 2);
});

test('validation: subject and html required', async () => {
  setup();
  assert.strictEqual((await parse(call({ mode: 'send', subject: '', html: '<p>x</p>' }))).http, 400);
  assert.strictEqual((await parse(call({ mode: 'test', subject: 's', html: '' }))).http, 400);
  assert.strictEqual((await parse(call({ mode: 'bogus' }))).http, 400);
});

run('announcements');
