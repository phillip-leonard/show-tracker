/**
 * The welcome email after a new account's first show (5.55.0):
 *   - the template, with full and missing data, and its links and labels
 *     against the app
 *   - every decision processWelcomeEmail makes, through a fake Firestore
 *     whose transactions conflict and retry like the real ones
 *   - the send-welcome-email handler: auth, uid from the token, test mode
 *
 *   node tests/email/welcomeEmail.test.js
 */

const { test, run } = require('./harness');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeDb, createFakeAuth } = require('./fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestTransport, buildEmail } = require('../../netlify/functions/lib/outgoingEmail');
const { hashEmail, verify } = require('../../netlify/functions/lib/unsubscribeToken');
const { FOOTER_MARKER } = require('../../netlify/functions/lib/emailLayout');
const {
  welcomeEmail, processWelcomeEmail, decideClaim,
  WELCOME_EMAIL_START, MAX_ATTEMPTS, SUBJECT, PREHEADER, LINKS,
} = require('../../netlify/functions/lib/welcomeEmail');
const handlerMod = require('../../netlify/functions/send-welcome-email');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_ACCOUNT = new Date(WELCOME_EMAIL_START + 86400000).toUTCString();
const OLD_ACCOUNT = new Date(WELCOME_EMAIL_START - 86400000 * 30).toUTCString();
const NOW = new Date(WELCOME_EMAIL_START + 86400000 * 2);

// ── Template ─────────────────────────────────────────────────────────

test('subject and preheader are the agreed copy', () => {
  const { subject, html, preheader } = welcomeEmail({});
  assert.strictEqual(subject, 'Your first show is in 🎶 Here’s what else MySetlists can do');
  assert.strictEqual(subject, SUBJECT);
  assert.strictEqual(preheader, 'Scan tickets, import your ticket history, add photos, tag friends, and more.');
  assert.ok(html.includes(PREHEADER), 'preheader is in the HTML');
});

test('full data: first name, band and venue, and a link to that show', () => {
  const { html } = welcomeEmail({ firstName: 'Sam', artist: 'Goose', venue: 'Red Rocks', showId: 'show_123' });
  assert.ok(html.includes('Hey Sam,'));
  assert.match(html, /You just logged <strong[^>]*>Goose<\/strong> at <strong[^>]*>Red Rocks<\/strong>\. Nice\./);
  assert.ok(html.includes('https://mysetlists.net/shows/?show=show_123'));
});

test('missing name, band and venue fall back to generic copy', () => {
  const { html } = welcomeEmail({});
  assert.ok(html.includes('Hey there,'));
  assert.ok(html.includes('Your first show is in. Nice.'));
  assert.ok(!html.includes('undefined') && !html.includes('null'));
  // No show id: the photo button goes to the show list instead.
  assert.ok(html.includes(`href="${LINKS.shows}"`));
});

test('band without a venue', () => {
  const { html } = welcomeEmail({ firstName: '  ', artist: 'Phish' });
  assert.ok(html.includes('Hey there,'));
  assert.match(html, /You just logged <strong[^>]*>Phish<\/strong>\. Nice\./);
});

test('names and show fields are escaped', () => {
  const { html } = welcomeEmail({ firstName: '<script>x</script>', artist: 'A&B "live"', venue: "O'Neil", showId: 'a b/c' });
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('A&amp;B &quot;live&quot;'));
  assert.ok(html.includes('show=a%20b%2Fc'));
});

test('every section has its deep link', () => {
  const { html } = welcomeEmail({ artist: 'Goose', showId: 's1' });
  for (const url of [LINKS.scan, LINKS.importHistory, 'https://mysetlists.net/shows/?show=s1', LINKS.tours, LINKS.festivals]) {
    assert.ok(html.includes(`href="${url}"`), `missing ${url}`);
  }
  for (const heading of ['Scan a ticket stub', 'Import your ticket history', 'Add photos to a show', 'Tag friends who were there', 'Tours and Festivals']) {
    assert.ok(html.includes(heading), `missing section ${heading}`);
  }
});

test('deep links are real routes and universal links', () => {
  const aasa = read('public/.well-known/apple-app-site-association');
  for (const route of ['scan-import', 'shows', 'tours', 'festivals']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'app', route, 'page.jsx')), `app/${route}/page.jsx`);
    assert.ok(aasa.includes(`"/${route}/*"`), `AASA lists /${route}`);
  }
  // ?import=1 opens the Import File tab.
  assert.ok(read('components/ScanImportView.jsx').includes(".has('import')"));
  // The show link is showHref's shape.
  assert.ok(read('lib/showRouting.js').includes('`/shows/?show=${encodeURIComponent(id)}`'));
});

test('the copy uses labels the app really shows', () => {
  const labels = [
    ['app/shows/page.jsx', 'Scan / Import'],
    ['components/TicketScanner.jsx', 'Select Images'],
    ['components/TicketScanner.jsx', 'Take Photo'],
    ['components/TicketScanner.jsx', 'Choose from Library'],
    ['components/ScanImportView.jsx', "label: 'Import File'"],
    ['components/ImportView.jsx', 'Choose a file'],
    ['components/photos/ShowMediaSection.jsx', 'title="Photos & Videos"'],
    ['components/photos/MediaGalleryView.jsx', "Add {category === 'photo' ? 'Photos' : title}"],
    ['components/shows/ShowDetailView.jsx', 'Tag friends'],
    ['components/shows/ShowDetailView.jsx', 'Friends Who Were There'],
    ['components/festivals/FestivalListView.jsx', 'New festival'],
    ['components/festivals/FestivalDetailView.jsx', 'Search the lineup'],
    ['components/layout/Sidebar.jsx', "label: 'Tours'"],
    ['components/layout/Sidebar.jsx', "label: 'Festivals'"],
  ];
  for (const [file, label] of labels) assert.ok(read(file).includes(label), `${file} no longer says ${label}`);
});

test('dark mode, one image, and the unsubscribe marker', () => {
  const { html } = welcomeEmail({ artist: 'Goose' });
  assert.ok(html.includes('prefers-color-scheme: dark'));
  assert.ok(html.includes('name="color-scheme"'));
  assert.strictEqual((html.match(/<img\b/g) || []).length, 1, 'only the logo');
  assert.ok(/<img[^>]+alt="MySetlists"/.test(html), 'logo has alt text for blocked images');
  assert.ok(html.includes(FOOTER_MARKER));
});

test('built for sending: signed unsubscribe link and List-Unsubscribe headers', () => {
  const { subject, html } = welcomeEmail({ artist: 'Goose' });
  const payload = buildEmail({ recipient: { email: 'a@example.com', uid: 'u1' }, subject, html, source: 'notification:welcome', replyTo: 'me@example.com' });
  assert.ok(!payload.html.includes(FOOTER_MARKER));
  const m = payload.html.match(/href="(https:\/\/mysetlists\.net\/api\/unsubscribe\?token=[^"]+)"/);
  assert.ok(m, 'unsubscribe link in footer');
  const claims = verify(new URL(m[1].replace(/&amp;/g, '&')).searchParams.get('token'));
  assert.ok(claims, 'token verifies');
  assert.strictEqual(claims.id || claims.uid, 'u1');
  assert.strictEqual(payload.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(payload.headers['List-Unsubscribe'].startsWith('<https://'));
  assert.strictEqual(payload.reply_to, 'me@example.com');
  assert.strictEqual(payload.from, 'Phillip <phillip@mysetlists.net>');
});

// ── Decisions ────────────────────────────────────────────────────────

function setup({ profile = {}, shows = 1, created = NEW_ACCOUNT, email = 'new@example.com', authEmail } = {}) {
  const db = createFakeDb();
  const uid = 'uid_new';
  db._put(`userProfiles/${uid}`, { email, firstName: 'Sam', ...profile });
  for (let i = 0; i < shows; i++) db._put(`users/${uid}/shows/show_${i}`, { artist: i === 0 ? 'Goose' : `Band ${i}`, venue: 'Red Rocks' });
  const auth = createFakeAuth({ users: [{ uid, email: authEmail === undefined ? email : authEmail, metadata: { creationTime: created } }] });
  const sent = [];
  let respond = () => ({ status: 200, body: JSON.stringify({ id: `re_${sent.length - 1}` }) });
  __setTestTransport((p, payload) => { sent.push(payload); return respond(payload); });
  return { db, auth, uid, sent, failNext: (fn) => { respond = fn; } };
}

const go = (ctx, extra = {}) => processWelcomeEmail({ db: ctx.db, auth: ctx.auth, uid: ctx.uid, now: NOW, replyTo: 'phillip@example.com', ...extra });

test('decideClaim: the rule on its own', () => {
  assert.deepStrictEqual(decideClaim(undefined), { claim: true, attempts: 1 });
  assert.deepStrictEqual(decideClaim({ status: 'failed', attempts: 1 }), { claim: true, attempts: 2 });
  assert.deepStrictEqual(decideClaim({ status: 'failed', attempts: 2 }), { claim: true, attempts: 3 });
  assert.strictEqual(decideClaim({ status: 'failed', attempts: 3 }).claim, false);
  for (const status of ['sent', 'sending', 'skipped_opt_out', 'skipped_no_email', 'skipped_existing']) {
    assert.strictEqual(decideClaim({ status, attempts: 1 }).claim, false, status);
  }
  assert.strictEqual(MAX_ATTEMPTS, 3);
});

test('first show → sends once, personalized, and records it', async () => {
  const ctx = setup();
  const r = await go(ctx, { showId: 'show_0' });
  assert.strictEqual(r.status, 'sent');
  assert.strictEqual(ctx.sent.length, 1);
  const p = ctx.sent[0];
  assert.strictEqual(p.to, 'new@example.com');
  assert.strictEqual(p.subject, SUBJECT);
  assert.strictEqual(p.reply_to, 'phillip@example.com');
  assert.ok(p.html.includes('Hey Sam,') && p.html.includes('Goose') && p.html.includes('Red Rocks'));
  assert.ok(p.html.includes('show=show_0'));
  assert.ok(p.headers['List-Unsubscribe']);
  const we = ctx.db._get(`userProfiles/${ctx.uid}`).welcomeEmail;
  assert.strictEqual(we.status, 'sent');
  assert.strictEqual(we.resendId, 're_0');
  assert.strictEqual(we.attempts, 1);
  assert.ok(we.at instanceof Date);
});

test('field already set → no send, nothing written', async () => {
  const ctx = setup({ profile: { welcomeEmail: { status: 'sent', attempts: 1 } } });
  const before = ctx.db._writes.length;
  const r = await go(ctx);
  assert.strictEqual(r.status, 'already_handled');
  assert.strictEqual(ctx.sent.length, 0);
  assert.strictEqual(ctx.db._writes.length, before);
});

test('opted out → skipped_opt_out, and not sent after opting back in', async () => {
  const ctx = setup({ profile: { emailOptOut: true } });
  assert.strictEqual((await go(ctx)).status, 'skipped_opt_out');
  assert.strictEqual(ctx.sent.length, 0);
  assert.strictEqual(ctx.db._get(`userProfiles/${ctx.uid}`).welcomeEmail.status, 'skipped_opt_out');
  // They turn email back on and add another show.
  const prof = ctx.db._get(`userProfiles/${ctx.uid}`);
  ctx.db._put(`userProfiles/${ctx.uid}`, { ...prof, emailOptOut: false });
  assert.strictEqual((await go(ctx)).status, 'already_handled');
  assert.strictEqual(ctx.sent.length, 0);
});

test('suppressed address → skipped', async () => {
  const ctx = setup();
  ctx.db._put(`emailSuppressions/${hashEmail('new@example.com')}`, { email: 'new@example.com', scope: 'all' });
  assert.strictEqual((await go(ctx)).status, 'skipped_opt_out');
  assert.strictEqual(ctx.sent.length, 0);
});

test('announcements-only opt-out does not block it (category is notification)', async () => {
  const ctx = setup({ profile: { announcementsOptOut: true } });
  assert.strictEqual((await go(ctx)).status, 'sent');
});

test('no email on the account → skipped_no_email', async () => {
  const ctx = setup({ email: '', authEmail: null });
  assert.strictEqual((await go(ctx)).status, 'skipped_no_email');
  assert.strictEqual(ctx.sent.length, 0);
  assert.strictEqual(ctx.db._get(`userProfiles/${ctx.uid}`).welcomeEmail.status, 'skipped_no_email');
});

test('Resend error → failed with the claim released; the next save retries', async () => {
  const ctx = setup();
  ctx.failNext(() => ({ status: 500, body: 'boom' }));
  const r = await go(ctx);
  assert.strictEqual(r.status, 'failed');
  let we = ctx.db._get(`userProfiles/${ctx.uid}`).welcomeEmail;
  assert.strictEqual(we.status, 'failed');
  assert.strictEqual(we.attempts, 1);
  assert.ok(we.error.includes('boom'));
  ctx.failNext(() => ({ status: 200, body: '{"id":"re_ok"}' }));
  assert.strictEqual((await go(ctx)).status, 'sent');
  we = ctx.db._get(`userProfiles/${ctx.uid}`).welcomeEmail;
  assert.strictEqual(we.attempts, 2);
  assert.strictEqual(we.resendId, 're_ok');
});

test('three failures, then the 4th call does not retry', async () => {
  const ctx = setup();
  ctx.failNext(() => ({ status: 502, body: 'down' }));
  for (let i = 1; i <= 3; i++) assert.strictEqual((await go(ctx)).status, 'failed', `attempt ${i}`);
  assert.strictEqual(ctx.sent.length, 3);
  assert.strictEqual((await go(ctx)).status, 'max_attempts');
  assert.strictEqual(ctx.sent.length, 3);
  assert.strictEqual(ctx.db._get(`userProfiles/${ctx.uid}`).welcomeEmail.attempts, 3);
});

test('two concurrent calls send exactly once', async () => {
  const ctx = setup();
  const results = await Promise.all([go(ctx), go(ctx)]);
  assert.strictEqual(ctx.sent.length, 1);
  assert.deepStrictEqual(results.map((r) => r.status).sort(), ['already_handled', 'sent']);
});

test('a bulk import of 200 shows sends one email, however many calls it makes', async () => {
  const ctx = setup({ shows: 200 });
  await Promise.all(Array.from({ length: 10 }, () => go(ctx)));
  assert.strictEqual(ctx.sent.length, 1);
});

test('an account from before the welcome email → skipped_existing, never sent', async () => {
  const ctx = setup({ created: OLD_ACCOUNT });
  assert.strictEqual((await go(ctx)).status, 'skipped_existing');
  assert.strictEqual(ctx.sent.length, 0);
  assert.strictEqual(ctx.db._get(`userProfiles/${ctx.uid}`).welcomeEmail.status, 'skipped_existing');
  assert.strictEqual((await go(ctx)).status, 'already_handled');
});

test('no shows yet → nothing sent or written (the client was early)', async () => {
  const ctx = setup({ shows: 0 });
  const before = ctx.db._writes.length;
  assert.strictEqual((await go(ctx)).status, 'not_eligible');
  assert.strictEqual(ctx.sent.length, 0);
  assert.strictEqual(ctx.db._writes.length, before);
});

test('deleting every show and adding one again does not resend', async () => {
  const ctx = setup();
  await go(ctx);
  ctx.db._store.delete(`users/${ctx.uid}/shows/show_0`);
  ctx.db._put(`users/${ctx.uid}/shows/show_new`, { artist: 'Phish', venue: 'MSG' });
  assert.strictEqual((await go(ctx, { showId: 'show_new' })).status, 'already_handled');
  assert.strictEqual(ctx.sent.length, 1);
});

test('a showId that is not one of theirs (or a path) is ignored', async () => {
  const ctx = setup();
  ctx.db._put('users/someone_else/shows/theirs', { artist: 'Secret Band', venue: 'Elsewhere' });
  await go(ctx, { showId: '../../someone_else/shows/theirs' });
  assert.ok(!ctx.sent[0].html.includes('Secret Band'));
  assert.ok(ctx.sent[0].html.includes('Goose'));
});

// ── Handler ──────────────────────────────────────────────────────────

const event = (body, token) => ({
  httpMethod: 'POST',
  headers: token ? { authorization: `Bearer ${token}`, origin: 'https://mysetlists.net' } : { origin: 'https://mysetlists.net' },
  body: JSON.stringify(body || {}),
});

function handlerSetup() {
  const ctx = setup();
  ctx.db._put('userProfiles/uid_other', { email: 'other@example.com' });
  ctx.db._put('users/uid_other/shows/x', { artist: 'Other', venue: 'V' });
  const auth = createFakeAuth({
    tokens: {
      tok_new: { uid: ctx.uid, email: 'new@example.com' },
      tok_admin: { uid: 'uid_admin', email: 'phillip.leonard@gmail.com' },
    },
    users: [
      { uid: ctx.uid, email: 'new@example.com', metadata: { creationTime: NEW_ACCOUNT } },
      { uid: 'uid_other', email: 'other@example.com', metadata: { creationTime: NEW_ACCOUNT } },
    ],
  });
  __setTestFirebase({ db: ctx.db, auth });
  return ctx;
}

test('handler: no token → 401; bad token → 401; nothing sent', async () => {
  const ctx = handlerSetup();
  assert.strictEqual((await handlerMod.handler(event({}))).statusCode, 401);
  assert.strictEqual((await handlerMod.handler(event({}, 'forged'))).statusCode, 401);
  assert.strictEqual(ctx.sent.length, 0);
});

test('handler: the uid comes from the token, never the body', async () => {
  const ctx = handlerSetup();
  const res = await handlerMod.handler(event({ uid: 'uid_other', userId: 'uid_other' }, 'tok_new'));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(JSON.parse(res.body).status, 'sent');
  assert.strictEqual(ctx.sent.length, 1);
  assert.strictEqual(ctx.sent[0].to, 'new@example.com');
  assert.strictEqual(ctx.db._get('userProfiles/uid_other').welcomeEmail, undefined);
});

test('handler: test mode is admin only and writes nothing', async () => {
  const ctx = handlerSetup();
  assert.strictEqual((await handlerMod.handler(event({ test: true }, 'tok_new'))).statusCode, 403);
  const before = ctx.db._writes.length;
  const res = await handlerMod.handler(event({ test: true }, 'tok_admin'));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(ctx.sent.length, 1);
  assert.strictEqual(ctx.sent[0].to, 'phillip.leonard@gmail.com');
  assert.ok(ctx.sent[0].subject.startsWith('[Test] '));
  assert.ok(ctx.sent[0].headers['List-Unsubscribe']);
  assert.strictEqual(ctx.db._writes.length, before);
});

test('handler: without UNSUBSCRIBE_SECRET it refuses before claiming', async () => {
  const ctx = handlerSetup();
  const saved = process.env.UNSUBSCRIBE_SECRET;
  delete process.env.UNSUBSCRIBE_SECRET;
  try {
    assert.strictEqual((await handlerMod.handler(event({}, 'tok_new'))).statusCode, 500);
  } finally { process.env.UNSUBSCRIBE_SECRET = saved; }
  assert.strictEqual(ctx.db._get(`userProfiles/${ctx.uid}`).welcomeEmail, undefined);
  assert.strictEqual(ctx.sent.length, 0);
});

test('handler: CORS only for the site and the app; OPTIONS and GET', async () => {
  handlerSetup();
  const pre = await handlerMod.handler({ httpMethod: 'OPTIONS', headers: { origin: 'capacitor://localhost' } });
  assert.strictEqual(pre.statusCode, 204);
  assert.strictEqual(pre.headers['Access-Control-Allow-Origin'], 'capacitor://localhost');
  const evil = await handlerMod.handler({ httpMethod: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.strictEqual(evil.headers['Access-Control-Allow-Origin'], undefined);
  assert.strictEqual((await handlerMod.handler({ httpMethod: 'GET', headers: {} })).statusCode, 405);
});

run('welcome email').then(() => { __setTestFirebase({}); __setTestTransport(null); });
