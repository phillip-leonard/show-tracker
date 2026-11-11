/**
 * The Year in Review emails (netlify/functions/lib/yearRecapEmail.js) and
 * the 'recap-2026' audience in admin-send-announcement: only accounts with
 * a 2026 show, the server's own templates, and no real send while
 * YEAR_RECAP_EMAILS_ENABLED is off.
 *
 *   node tests/email/yearRecapEmail.test.js
 */

const { test, run } = require('./harness');
const assert = require('node:assert');
const { createFakeDb, createFakeAuth } = require('./fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestTransport } = require('../../netlify/functions/lib/outgoingEmail');
const recap = require('../../netlify/functions/lib/yearRecapEmail');
const mod = require('../../netlify/functions/admin-send-announcement');

mod.__setSleep(async () => {});

const ADMIN = { uid: 'adminUid000001', email: 'phillip.leonard@gmail.com' };

function setup() {
  const db = createFakeDb();
  __setTestFirebase({ db, auth: createFakeAuth({ tokens: { admin: ADMIN }, users: [ADMIN] }) });
  db._put(`userProfiles/${ADMIN.uid}`, { email: ADMIN.email });
  // a: a 2026 show (ISO). b: a 2026 show (DD-MM-YYYY). c: 2025 only.
  // d: a 2026 show but opted out. e: a 2026 show but no announcements.
  db._put('userProfiles/a', { email: 'a@example.com' });
  db._put('users/a/shows/1', { date: '2026-06-20' });
  db._put('userProfiles/b', { email: 'b@example.com' });
  db._put('users/b/shows/1', { date: '31-12-2026' });
  db._put('users/b/shows/2', { date: '2026-01-01' });
  db._put('userProfiles/c', { email: 'c@example.com' });
  db._put('users/c/shows/1', { date: '2025-12-31' });
  db._put('userProfiles/d', { email: 'd@example.com', emailOptOut: true });
  db._put('users/d/shows/1', { date: '2026-03-03' });
  db._put('userProfiles/e', { email: 'e@example.com', announcementsOptOut: true });
  db._put('users/e/shows/1', { date: '2026-03-03' });
  // Another collection called "shows" that isn't a user's (a festival's).
  db._put('festivals/f1/shows/x', { date: '2026-07-07' });
  const calls = [];
  __setTestTransport((path, payload) => {
    calls.push({ path, payload });
    const data = Array.isArray(payload) ? payload.map((_, i) => ({ id: `re_${calls.length}_${i}` })) : { id: 're_x' };
    return { status: 200, body: JSON.stringify(Array.isArray(payload) ? { data } : data) };
  });
  return { db, calls };
}

const call = (body) => mod.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer admin' }, body: JSON.stringify(body) });
const parse = async (p) => { const r = await p; return { ...JSON.parse(r.body), http: r.statusCode }; };

test('showYearOf reads both stored date formats', () => {
  assert.strictEqual(recap.showYearOf('2026-01-01'), 2026);
  assert.strictEqual(recap.showYearOf('31-12-2026'), 2026);
  assert.strictEqual(recap.showYearOf(''), null);
  assert.strictEqual(recap.showYearOf('Dec 2026'), null);
});

test('uidsWithShowsIn: users/{uid}/shows only, by year', () => {
  const uids = recap.uidsWithShowsIn([
    { path: 'users/a/shows/1', date: '2026-02-02' },
    { path: 'users/b/shows/1', date: '2025-02-02' },
    { path: 'festivals/x/shows/1', date: '2026-02-02' },
  ], 2026);
  assert.deepStrictEqual([...uids], ['a']);
});

test('templates: both link to the 2026 recap, no unsubscribe of their own', () => {
  for (const t of ['ready', 'final']) {
    const e = recap.recapEmail(t, 2026);
    assert.match(e.html, /https:\/\/mysetlists\.net\/year-in-review\/\?year=2026/);
    assert.ok(!/unsubscribe/i.test(e.html), 'the footer is added per recipient');
  }
  assert.strictEqual(recap.recapEmail('ready').subject, 'Your 2026 in live music is ready');
  assert.strictEqual(recap.recapEmail('final').subject, 'Your final 2026 recap, NYE included');
  assert.strictEqual(recap.recapEmail('bogus'), null);
});

test('preview: only opted-in accounts with a 2026 show; extras ignored; flag reported', async () => {
  setup();
  const r = await parse(call({ mode: 'preview', audience: 'recap-2026', template: 'ready', extraEmails: ['x@example.com'] }));
  assert.strictEqual(r.http, 200);
  assert.strictEqual(r.counts.total, 2, 'a and b');
  assert.strictEqual(r.counts.extras, 0);
  assert.strictEqual(r.counts.excluded, 2, 'd and e');
  assert.strictEqual(r.recapEnabled, false);
});

test('test send: the server template, to the admin only, with unsubscribe headers', async () => {
  const { calls } = setup();
  const r = await parse(call({ mode: 'test', audience: 'recap-2026', template: 'final', subject: 'ignored', html: '<p>ignored</p>' }));
  assert.strictEqual(r.http, 200);
  assert.strictEqual(calls.length, 1);
  const p = calls[0].payload;
  assert.strictEqual(p.to, ADMIN.email);
  assert.strictEqual(p.subject, '[Test] Your final 2026 recap, NYE included');
  assert.ok(!p.html.includes('ignored'));
  assert.match(p.html, /year-in-review\/\?year=2026/);
  assert.match(p.headers['List-Unsubscribe'], /^<https?:\/\/.+>$/);
  assert.strictEqual(p.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('a real send is refused while YEAR_RECAP_EMAILS_ENABLED is off; nothing written', async () => {
  const { db, calls } = setup();
  delete process.env.YEAR_RECAP_EMAILS_ENABLED;
  const before = db._writes.length;
  const r = await parse(call({ mode: 'send', audience: 'recap-2026', template: 'ready' }));
  assert.strictEqual(r.http, 412);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(db._writes.length, before);
});

test('with the flag on, it sends to exactly the 2026 audience', async () => {
  const { db, calls } = setup();
  process.env.YEAR_RECAP_EMAILS_ENABLED = 'true';
  try {
    const r = await parse(call({ mode: 'send', audience: 'recap-2026', template: 'ready' }));
    assert.strictEqual(r.http, 200);
    assert.strictEqual(r.remaining, 0);
    const sent = calls.filter((c) => c.path === '/emails/batch').flatMap((c) => c.payload.map((p) => p.to)).sort();
    assert.deepStrictEqual(sent, ['a@example.com', 'b@example.com']);
    const ann = db._list('announcements')[0];
    assert.strictEqual(ann.audience, 'recap-2026');
    assert.strictEqual(ann.subject, 'Your 2026 in live music is ready');
  } finally {
    delete process.env.YEAR_RECAP_EMAILS_ENABLED;
  }
});

test('each email sends once: a second Send is a 409 and nobody is emailed again', async () => {
  const { db, calls } = setup();
  process.env.YEAR_RECAP_EMAILS_ENABLED = 'true';
  try {
    const first = await parse(call({ mode: 'send', audience: 'recap-2026', template: 'ready' }));
    assert.strictEqual(first.http, 200);
    assert.strictEqual(first.announcementId, 'recap2026ready');
    const sentBefore = calls.length;

    const again = await parse(call({ mode: 'send', audience: 'recap-2026', template: 'ready' }));
    assert.strictEqual(again.http, 409);
    assert.strictEqual(again.announcementId, 'recap2026ready');
    assert.strictEqual(again.alreadySent.counts.sent, 2);
    assert.strictEqual(calls.length, sentBefore, 'no second email');
    assert.strictEqual(db._list('announcements').length, 1);

    const preview = await parse(call({ mode: 'preview', audience: 'recap-2026', template: 'ready' }));
    assert.strictEqual(preview.alreadySent.announcementId, 'recap2026ready');
    assert.strictEqual(preview.alreadySent.status, 'completed');

    // The other email is its own send.
    const preFinal = await parse(call({ mode: 'preview', audience: 'recap-2026', template: 'final' }));
    assert.strictEqual(preFinal.alreadySent, null);
    const final = await parse(call({ mode: 'send', audience: 'recap-2026', template: 'final' }));
    assert.strictEqual(final.http, 200);
    assert.strictEqual(final.announcementId, 'recap2026final');
  } finally {
    delete process.env.YEAR_RECAP_EMAILS_ENABLED;
  }
});

test('two Sends racing past the check: only one creates the send', async () => {
  const { db, calls } = setup();
  process.env.YEAR_RECAP_EMAILS_ENABLED = 'true';
  try {
    // The other tab's create() lands between this call's check and its own create().
    const realDoc = db.doc.bind(db);
    let checked = 0;
    db.doc = (path) => {
      const ref = realDoc(path);
      if (path !== 'announcements/recap2026ready') return ref;
      return {
        ...ref,
        get: async () => {
          const snap = await ref.get();
          checked += 1;
          if (checked === 1) await realDoc(path).create({ status: 'sending', counts: { sent: 0 } });
          return snap;
        },
      };
    };
    const r = await parse(call({ mode: 'send', audience: 'recap-2026', template: 'ready' }));
    assert.strictEqual(r.http, 409);
    assert.ok(r.alreadySent);
    assert.strictEqual(calls.length, 0);
  } finally {
    delete process.env.YEAR_RECAP_EMAILS_ENABLED;
  }
});

test('an unknown audience or template is a 400', async () => {
  setup();
  assert.strictEqual((await parse(call({ mode: 'preview', audience: 'everyone' }))).http, 400);
  assert.strictEqual((await parse(call({ mode: 'test', audience: 'recap-2026', template: 'x' }))).http, 400);
});

run('year recap emails');
