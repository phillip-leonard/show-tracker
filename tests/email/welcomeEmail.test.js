/**
 * The welcome email after a new account's first show (5.55.0):
 *   - the template, with full and missing data, and its links and labels
 *     against the app
 *   - every decision processWelcomeEmail makes, through a fake Firestore
 *     whose transactions conflict and retry like the real ones
 *   - the send-welcome-email handler: auth, uid from the token, test mode
 *   - no emoji anywhere (5.59.4), and the band page line: when it shows,
 *     where it links, and that a failed lookup never stops the send
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
  welcomeEmail, processWelcomeEmail, decideClaim, bandPageFor,
  WELCOME_EMAIL_START, MAX_ATTEMPTS, SUBJECT, PREHEADER, LINKS, SAMPLES,
} = require('../../netlify/functions/lib/welcomeEmail');
const { findArtistByName } = require('../../netlify/functions/lib/publicArtistSnapshot');
const handlerMod = require('../../netlify/functions/send-welcome-email');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_ACCOUNT = new Date(WELCOME_EMAIL_START + 86400000).toUTCString();
const OLD_ACCOUNT = new Date(WELCOME_EMAIL_START - 86400000 * 30).toUTCString();
const NOW = new Date(WELCOME_EMAIL_START + 86400000 * 2);

// Any emoji or pictograph, plus the variation selector that turns a plain
// symbol into one. Arrows written as &rarr; are entities, not emoji.
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{20E3}]/u;

// A snapshot index the way runSnapshot writes it: published entries carry
// a hash and fetchedAt.
const entry = (slug, extra = {}) => ({ slug, name: slug, source: 'songfish', fetchedAt: '2026-11-10T00:00:00.000Z', hash: `h_${slug}`, ...extra });
const INDEX = { schemaVersion: 2, artists: [entry('goose'), entry('phish', { source: 'phishnet', fetchedAt: '2026-01-01T00:00:00.000Z' })] };
const readIndex = (index = INDEX) => async () => index;
const GOOSE_LINE = 'Want more Goose? See their most-played songs, gaps and recent setlists on the';
const GOOSE_URL = 'https://mysetlists.net/bands/?band=goose';

// ── Template ─────────────────────────────────────────────────────────

test('subject and preheader are the agreed copy', () => {
  const { subject, html, preheader } = welcomeEmail({});
  assert.strictEqual(subject, 'Your first show is in. Here’s what else MySetlists can do');
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

test('admin samples: Goose with its band line, and a band with no page', () => {
  assert.ok(welcomeEmail(SAMPLES.band_page).html.includes(GOOSE_LINE));
  assert.strictEqual(findArtistByName(SAMPLES.no_band_page.artist), null, 'the no-page sample must not be a configured band');
  assert.ok(!welcomeEmail(SAMPLES.no_band_page).html.includes('Want more'));
  const card = read('components/admin/WelcomeEmailCard.jsx');
  assert.ok(card.includes("JSON.stringify({ test: true, variant })"));
  assert.ok(card.includes("'no_band_page'"));
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

// ── No emoji (5.59.4) ────────────────────────────────────────────────

test('the regex catches what it should', () => {
  for (const e of ['🎶', '📸', '🎟️', '🖼️', '👯', '🗺️', '🤙', '✅', '❤️', '🇺🇸']) assert.ok(EMOJI.test(e), e);
  for (const ok of ['→', '&rarr;', '’', '&nbsp;', '—', 'moe.']) assert.ok(!EMOJI.test(ok), ok);
});

test('no emoji in the subject, preheader, HTML or sent payload, in every variant', () => {
  const variants = [{}, SAMPLES.band_page, SAMPLES.no_band_page, { firstName: 'Sam', artist: 'Goose', venue: 'Red Rocks', showId: 's1', bandPage: { name: 'Goose', slug: 'goose' } }];
  for (const v of variants) {
    const { subject, html, preheader } = welcomeEmail(v);
    assert.ok(!EMOJI.test(subject), `subject: ${subject}`);
    assert.ok(!EMOJI.test(preheader), 'preheader');
    const hit = html.match(EMOJI);
    assert.ok(!hit, `emoji in HTML: ${hit && hit[0]}`);
    const payload = buildEmail({ recipient: { email: 'a@example.com', uid: 'u1' }, subject, html, source: 'notification:welcome' });
    assert.ok(!EMOJI.test(payload.subject) && !EMOJI.test(payload.html), 'payload, footer included');
  }
});

test('section headings are plain text', () => {
  const { html } = welcomeEmail({ artist: 'Goose' });
  const headings = [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1]);
  assert.deepStrictEqual(headings, ['Scan a ticket stub', 'Import your ticket history', 'Add photos to a show', 'Tag friends who were there', 'Tours and Festivals']);
});

// ── Band page line (5.59.4) ──────────────────────────────────────────

test('template: a band page → one line after the intro, before the first section', () => {
  const { html } = welcomeEmail({ artist: 'Goose', bandPage: { name: 'Goose', slug: 'goose' } });
  assert.ok(html.includes(GOOSE_LINE));
  assert.ok(html.includes(`href="${GOOSE_URL}"`));
  assert.ok(html.includes('>Goose band page&nbsp;&rarr;</a>'));
  const line = html.indexOf(GOOSE_LINE);
  assert.ok(line > html.indexOf('make it more fun.'), 'after the intro');
  assert.ok(line < html.indexOf('Scan a ticket stub'), 'before the sections');
  assert.strictEqual(html.split('Want more').length - 1, 1);
});

test('template: no band page, or a malformed one → no line', () => {
  for (const bandPage of [undefined, null, {}, { name: 'Goose' }, { slug: 'goose' }, { name: 'X', slug: '../evil' }]) {
    const { html } = welcomeEmail({ artist: 'Goose', bandPage });
    assert.ok(!html.includes('Want more'), JSON.stringify(bandPage));
    assert.ok(!html.includes('/bands/?band='));
  }
});

test('template: the band name is escaped', () => {
  const { html } = welcomeEmail({ bandPage: { name: 'A&B <i>', slug: 'a-b' } });
  assert.ok(html.includes('Want more A&amp;B &lt;i&gt;?'));
  assert.ok(!html.includes('<i>'));
});

test('the band link is a real route and a universal link', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'app', 'bands', 'page.jsx')));
  assert.ok(read('public/.well-known/apple-app-site-association').includes('"/bands/*"'));
  // Signed out on the web, /bands/?band= goes on to the public page.
  assert.ok(read('lib/bandScreens.js').includes('`/artist/${band.slug}/`'));
});

test('artist name → band uses the shared matcher: case, punctuation, qualifiers', () => {
  const cases = [
    ['Goose', 'goose'], ['goose', 'goose'], ['GOOSE', 'goose'], ['Goose (US)', 'goose'],
    ['moe.', 'moe'], ['Moe', 'moe'], ['MOE.', 'moe'],
    ['King Gizzard & the Lizard Wizard', 'king-gizzard-and-the-lizard-wizard'],
    ['King Gizzard & The Lizard Wizard', 'king-gizzard-and-the-lizard-wizard'],
    ['king gizzard & the lizard wizard', 'king-gizzard-and-the-lizard-wizard'],
    ["Umphrey's McGee", 'umphreys-mcgee'], ['Umphreys McGee', 'umphreys-mcgee'], ['Umphrey’s McGee', 'umphreys-mcgee'],
    ['The String Cheese Incident', 'string-cheese-incident'], ['String Cheese Incident', 'string-cheese-incident'],
    ['Dead & Company', 'dead-and-company'], ['Phish', 'phish'],
  ];
  for (const [name, slug] of cases) assert.strictEqual(findArtistByName(name)?.slug, slug, name);
  for (const name of ['Khruangbin', '', null, 'Goose Fan Band', 'Phish Tribute']) assert.strictEqual(findArtistByName(name), null, String(name));
});

test('bandPageFor: published band → its name and slug', async () => {
  assert.deepStrictEqual(await bandPageFor('goose (US)', readIndex()), { name: 'Goose', slug: 'goose' });
  assert.deepStrictEqual(await bandPageFor('moe.', readIndex({ artists: [entry('moe')] })), { name: 'moe.', slug: 'moe' });
});

test('bandPageFor: Phish past its 24 hours still counts (its page says temporarily unavailable)', async () => {
  assert.deepStrictEqual(await bandPageFor('Phish', readIndex()), { name: 'Phish', slug: 'phish' });
});

test('bandPageFor: configured but not in the index, or never published → null', async () => {
  assert.strictEqual(await bandPageFor('Billy Strings', readIndex()), null);
  assert.strictEqual(await bandPageFor('Goose', readIndex({ artists: [entry('goose', { hash: undefined })] })), null);
  assert.strictEqual(await bandPageFor('Goose', readIndex({ artists: [] })), null);
  assert.strictEqual(await bandPageFor('Goose', readIndex(null)), null);
  assert.strictEqual(await bandPageFor('Goose', readIndex({ artists: 'nope' })), null);
});

test('bandPageFor: a band not in config never reads the index', async () => {
  let reads = 0;
  assert.strictEqual(await bandPageFor('Khruangbin', async () => { reads++; return INDEX; }), null);
  assert.strictEqual(reads, 0);
});

test('bandPageFor: a throwing, rejecting or hanging read → null, never throws', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    assert.strictEqual(await bandPageFor('Goose', () => { throw new Error('no blobs'); }), null);
    assert.strictEqual(await bandPageFor('Goose', async () => { throw new Error('503'); }), null);
    assert.strictEqual(await bandPageFor('Goose', () => new Promise(() => {}), { timeoutMs: 20 }), null);
    assert.strictEqual(await bandPageFor('Goose', null), null);
  } finally { console.warn = warn; }
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

test('send: Goose with a published page → the band line, linked to its page', async () => {
  const ctx = setup();
  assert.strictEqual((await go(ctx, { showId: 'show_0', readBandIndex: readIndex() })).status, 'sent');
  assert.ok(ctx.sent[0].html.includes(GOOSE_LINE));
  assert.ok(ctx.sent[0].html.includes(`href="${GOOSE_URL}"`));
  assert.ok(!EMOJI.test(ctx.sent[0].html) && !EMOJI.test(ctx.sent[0].subject));
});

test('send: band not in the index → sent, no line', async () => {
  const ctx = setup();
  assert.strictEqual((await go(ctx, { readBandIndex: readIndex({ artists: [entry('phish')] }) })).status, 'sent');
  assert.ok(!ctx.sent[0].html.includes('Want more'));
});

test('send: the snapshot read throws → still sent, no line, recorded as sent', async () => {
  const ctx = setup();
  const warn = console.warn; console.warn = () => {};
  let r;
  try { r = await go(ctx, { readBandIndex: () => { throw new Error('Blobs down'); } }); } finally { console.warn = warn; }
  assert.strictEqual(r.status, 'sent');
  assert.strictEqual(ctx.sent.length, 1);
  assert.ok(!ctx.sent[0].html.includes('Want more'));
  assert.strictEqual(ctx.db._get(`userProfiles/${ctx.uid}`).welcomeEmail.status, 'sent');
});

test('send: no reader at all → sent, no line', async () => {
  const ctx = setup();
  assert.strictEqual((await go(ctx)).status, 'sent');
  assert.ok(!ctx.sent[0].html.includes('Want more'));
});

test('send: the band line follows the named show', async () => {
  const ctx = setup({ shows: 2 });
  ctx.db._put(`users/${ctx.uid}/shows/show_1`, { artist: 'moe.', venue: 'Red Rocks' });
  await go(ctx, { showId: 'show_1', readBandIndex: readIndex({ artists: [entry('goose'), entry('moe')] }) });
  assert.ok(ctx.sent[0].html.includes('Want more moe.?'));
  assert.ok(ctx.sent[0].html.includes('https://mysetlists.net/bands/?band=moe'));
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
      tok_admin: { uid: 'uid_admin', email: 'phillip.leonard@gmail.com', email_verified: true },
    },
    users: [
      { uid: ctx.uid, email: 'new@example.com', metadata: { creationTime: NEW_ACCOUNT } },
      { uid: 'uid_other', email: 'other@example.com', metadata: { creationTime: NEW_ACCOUNT } },
    ],
  });
  __setTestFirebase({ db: ctx.db, auth });
  handlerMod.__setTestBandIndexReader(() => readIndex());
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

test('handler: a real send carries the band line from the snapshot index', async () => {
  const ctx = handlerSetup();
  const res = await handlerMod.handler(event({ showId: 'show_0' }, 'tok_new'));
  assert.strictEqual(JSON.parse(res.body).status, 'sent');
  assert.ok(ctx.sent[0].html.includes(GOOSE_LINE));
});

test('handler: a Blobs failure on a real send still sends', async () => {
  const ctx = handlerSetup();
  handlerMod.__setTestBandIndexReader(() => () => { throw new Error('MissingBlobsEnvironmentError'); });
  const warn = console.warn; console.warn = () => {};
  let res;
  try { res = await handlerMod.handler(event({}, 'tok_new')); } finally { console.warn = warn; }
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(JSON.parse(res.body).status, 'sent');
  assert.ok(!ctx.sent[0].html.includes('Want more'));
});

test('handler: admin test send, both variants', async () => {
  const ctx = handlerSetup();
  const withPage = await handlerMod.handler(event({ test: true }, 'tok_admin'));
  assert.strictEqual(withPage.statusCode, 200);
  const a = JSON.parse(withPage.body);
  assert.strictEqual(a.variant, 'band_page');
  assert.deepStrictEqual(a.bandPage, { name: 'Goose', slug: 'goose' });
  assert.ok(ctx.sent[0].html.includes(GOOSE_LINE));
  assert.strictEqual(ctx.sent[0].subject, `[Test] ${SUBJECT}`);

  const without = await handlerMod.handler(event({ test: true, variant: 'no_band_page' }, 'tok_admin'));
  const b = JSON.parse(without.body);
  assert.strictEqual(b.variant, 'no_band_page');
  assert.strictEqual(b.bandPage, null);
  assert.ok(!ctx.sent[1].html.includes('Want more'));
  for (const p of ctx.sent) assert.ok(!EMOJI.test(p.subject) && !EMOJI.test(p.html));

  // Goose not published (yet) → the band_page variant goes out without the line, and says so.
  handlerMod.__setTestBandIndexReader(() => readIndex({ artists: [] }));
  const unpublished = JSON.parse((await handlerMod.handler(event({ test: true, variant: 'band_page' }, 'tok_admin'))).body);
  assert.strictEqual(unpublished.bandPage, null);
  assert.ok(!ctx.sent[2].html.includes('Want more'));
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

run('welcome email').then(() => { __setTestFirebase({}); __setTestTransport(null); handlerMod.__setTestBandIndexReader(null); });
