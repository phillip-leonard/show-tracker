/**
 * Guests on Firebase anonymous auth (5.60.13, native app Part 2): what the
 * server refuses them, what it still lets them do, and the link flow.
 *
 *   - isAnonymous / isAnonymousAuthUser / listAnonymousUids
 *   - requireAccount and every function that refuses a guest with 403
 *     `account_required`
 *   - the welcome email held for a guest, with nothing recorded
 *   - stats: a guest is unranked and left out of the community totals
 *   - account-linked: what a new sign-up gets, after the link
 *   - adopt-guest-shows: the plan, the proof of both accounts, the commit
 *
 *   node tests/security/anonymous.test.js
 *
 * firebase-admin is replaced in-process with the in-memory Firestore the
 * email tests use; nothing here reaches a network or a real database.
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const Module = require('module');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');

// ── firebase-admin, replaced ───────────────────────────────────────────
let db;
let auth;
const fakeModules = {
  'firebase-admin/app': { getApps: () => [{}], initializeApp: () => ({}), cert: () => ({}) },
  'firebase-admin/auth': { getAuth: () => auth },
  'firebase-admin/firestore': {
    getFirestore: () => db,
    FieldValue: {
      serverTimestamp: () => new Date(),
      delete: () => '__delete__',
      increment: (n) => n,
      arrayUnion: (...v) => v,
      arrayRemove: () => [],
    },
  },
  'firebase-admin/storage': { getStorage: () => ({ bucket: () => null }) },
};
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (fakeModules[request]) return fakeModules[request];
  return realLoad.call(this, request, parent, isMain);
};

const { __setTestFirebase, isAnonymous, isAnonymousAuthUser, listAnonymousUids } = require('../../netlify/functions/lib/firebaseAdmin');
const { requireAccount } = require('../../netlify/functions/lib/requestAuth');
const { processWelcomeEmail } = require('../../netlify/functions/lib/welcomeEmail');
const { buildCommunityStats } = require('../../netlify/functions/lib/communityStats');
const { rebuildAllStats, recomputeUserStats } = require('../../netlify/functions/lib/userStats');
const { isRanked, computeUserStats } = require('../../lib/stats');
const ai = require('../../netlify/functions/lib/aiScan');
const accountLinked = require('../../netlify/functions/account-linked');
const adoptGuest = require('../../netlify/functions/adopt-guest-shows');

// A guest's token, as Firebase issues it, and the same account after a
// link (identities filled in, whatever sign_in_provider says).
const GUEST = { uid: 'guestUid000001', firebase: { sign_in_provider: 'anonymous', identities: {} } };
const GUEST2 = { uid: 'guestUid000002', firebase: { sign_in_provider: 'anonymous', identities: {} } };
const LINKED = { uid: 'guestUid000001', email: 'new@example.com', firebase: { sign_in_provider: 'anonymous', identities: { email: ['new@example.com'] } } };
const ALICE = { uid: 'aliceUid000001', email: 'alice@example.com', firebase: { sign_in_provider: 'google.com', identities: { 'google.com': ['1'], email: ['alice@example.com'] } } };
const BOB = { uid: 'bobUid00000001', email: 'bob@example.com' };

const NOW = new Date();
const AUTH_USERS = [
  { uid: GUEST.uid, providerData: [], metadata: { creationTime: NOW.toUTCString() } },
  { uid: GUEST2.uid, providerData: [], metadata: { creationTime: NOW.toUTCString() } },
  { uid: ALICE.uid, email: ALICE.email, providerData: [{ providerId: 'google.com' }], metadata: { creationTime: NOW.toUTCString() } },
  { uid: BOB.uid, email: BOB.email, providerData: [{ providerId: 'password' }], metadata: { creationTime: NOW.toUTCString() } },
];

function setup({ users = AUTH_USERS } = {}) {
  db = createFakeDb();
  auth = createFakeAuth({
    tokens: { guest: GUEST, guest2: GUEST2, linked: LINKED, alice: ALICE, bob: BOB },
    users,
  });
  // listUsers, paged two at a time so the paging is exercised.
  auth.listUsers = async (max, pageToken) => {
    const start = pageToken ? Number(pageToken) : 0;
    const page = users.slice(start, start + 2);
    return { users: page, pageToken: start + 2 < users.length ? String(start + 2) : undefined };
  };
  __setTestFirebase({ db, auth });
  db._put(`userProfiles/${ALICE.uid}`, { displayName: 'Alice', firstName: 'Alice' });
  db._put(`userProfiles/${BOB.uid}`, { displayName: 'Bob', firstName: 'Bob' });
  return { db, auth };
}

const post = (fn, token, body, extraHeaders = {}) => fn({
  httpMethod: 'POST',
  headers: { origin: 'https://mysetlists.net', 'x-nf-client-connection-ip': '203.0.113.9', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
  body: JSON.stringify(body || {}),
});
const json = (res) => JSON.parse(res.body);
const quiet = async (fn) => { const l = console.log; const e = console.error; const w = console.warn; console.log = () => {}; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; console.warn = w; } };
const show = (data) => ({ artist: 'Goose', venue: 'Red Rocks', city: 'Morrison', date: '2024-06-15', setlist: [], isManual: true, ...data });

// ── Who is a guest ───────────────────────────────────────────────────

test('isAnonymous: provider anonymous and no identity; a linked account is not a guest', () => {
  assert.strictEqual(isAnonymous(GUEST), true);
  assert.strictEqual(isAnonymous(LINKED), false, 'linked, even if sign_in_provider still says anonymous');
  assert.strictEqual(isAnonymous(ALICE), false);
  assert.strictEqual(isAnonymous(BOB), false, 'no firebase claim reads as an account');
  assert.strictEqual(isAnonymous({ uid: 'x', firebase: { sign_in_provider: 'anonymous' } }), true, 'identities missing counts as none');
  assert.strictEqual(isAnonymous(null), false);
});

test('isAnonymousAuthUser and listAnonymousUids read Firebase Auth', async () => {
  setup();
  assert.strictEqual(isAnonymousAuthUser(AUTH_USERS[0]), true);
  assert.strictEqual(isAnonymousAuthUser(AUTH_USERS[2]), false);
  assert.strictEqual(isAnonymousAuthUser(null), false);
  assert.deepStrictEqual([...(await listAnonymousUids(auth))].sort(), [GUEST.uid, GUEST2.uid]);
});

test('requireAccount: 401 signed out, 403 account_required for a guest, the user for an account', async () => {
  setup();
  const ev = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.strictEqual((await requireAccount(ev(null))).response.statusCode, 401);
  const g = await requireAccount(ev('guest'));
  assert.strictEqual(g.response.statusCode, 403);
  assert.strictEqual(json(g.response).code, 'account_required');
  const a = await requireAccount(ev('alice'));
  assert.strictEqual(a.uid, ALICE.uid);
  assert.strictEqual(a.isAnonymous, false);
  assert.strictEqual((await requireAccount(ev('linked'))).uid, LINKED.uid, 'linked works at once');
});

// ── Refused for guests ───────────────────────────────────────────────

const REFUSED = [
  ['friends', () => require('../../netlify/functions/friends').handler, { action: 'referralLink' }],
  ['friends block', () => require('../../netlify/functions/friends').handler, { action: 'block', targetUid: ALICE.uid }],
  ['send-email', () => require('../../netlify/functions/send-email').handler, { type: 'friend_joined' }],
  ['create-shared-collection', () => require('../../netlify/functions/create-shared-collection').handler, { kind: 'shows' }],
  ['match-festivals', () => require('../../netlify/functions/match-festivals').handler, { name: 'Bonnaroo', year: 2024 }],
  ['festival-lineup', () => require('../../netlify/functions/festival-lineup').handler, { festivalId: 'f1' }],
  ['moderate-content', () => require('../../netlify/functions/moderate-content').handler, { target: 'profileName', displayName: 'Guest' }],
  ['report-content', () => require('../../netlify/functions/report-content').handler, { contentType: 'comment', contentId: 'c1', reason: 'spam' }],
  ['notify-block', () => require('../../netlify/functions/notify-block').handler, { blockedUid: ALICE.uid }],
  ['my-poster share', () => require('../../netlify/functions/my-poster').handler, { action: 'share', record: {} }],
  ['normalize-show tag', () => require('../../netlify/functions/normalize-show').handler, { mode: 'commit', input: { kind: 'tag', tagId: 't1' } }],
  ['normalize-show email-tag', () => require('../../netlify/functions/normalize-show').handler, { mode: 'preview', inputs: [{ kind: 'email-tag', tagId: 't1' }] }],
  ['account-linked', () => accountLinked.handler, {}],
  ['adopt-guest-shows (as the guest)', () => adoptGuest.handler, { mode: 'preview', guestIdToken: 'guest' }],
];

for (const [name, load, body] of REFUSED) {
  test(`refused for a guest: ${name}`, async () => {
    setup();
    const res = await quiet(() => post(load(), 'guest', body));
    assert.strictEqual(res.statusCode, 403, `${name}: ${res.statusCode} ${res.body}`);
    const b = json(res);
    assert.ok(b.code === 'account_required' || b.error === 'account_required', `${name}: ${res.body}`);
  });
}

test('AI scan: a guest token is refused, not counted as a user or the anonymous pool', async () => {
  setup();
  delete process.env.REQUIRE_AUTH_AI;
  const g = await ai.gate(post((e) => e, 'guest'), {});
  assert.strictEqual(g.response.statusCode, 403);
  assert.strictEqual(json(g.response).code, 'account_required');
  const a = await ai.gate(post((e) => e, 'alice'), {});
  assert.strictEqual(a.ok, true, 'an account still scans');
});

// ── Allowed for guests ───────────────────────────────────────────────

test('allowed for a guest: recompute-my-stats, unranked', async () => {
  setup();
  db._put(`users/${GUEST.uid}/shows/1`, show());
  const res = await quiet(() => post(require('../../netlify/functions/recompute-my-stats').handler, 'guest', {}));
  assert.strictEqual(res.statusCode, 200, res.body);
  const stored = db._get(`userStats/${GUEST.uid}`);
  assert.strictEqual(stored.showCount, 1);
  assert.strictEqual(stored.ranked, false);
  assert.strictEqual(stored.rank, null);
});

test('allowed for a guest: my-poster image is not refused for being a guest', async () => {
  setup();
  const res = await quiet(() => post(require('../../netlify/functions/my-poster').handler, 'guest', { action: 'image', kind: 'feed', record: {} }));
  assert.notStrictEqual(res.statusCode, 403);
});

// ── Welcome email ────────────────────────────────────────────────────

test('welcome email: held for a guest, nothing recorded; claimable after the link', async () => {
  setup();
  db._put(`users/${GUEST.uid}/shows/1`, show());
  db._put(`userProfiles/${GUEST.uid}`, { createdAt: NOW });
  const r = await processWelcomeEmail({ db, auth, uid: GUEST.uid, now: NOW });
  assert.deepStrictEqual(r, { status: 'held_anonymous' });
  assert.strictEqual(db._get(`userProfiles/${GUEST.uid}`).welcomeEmail, undefined, 'never skipped_no_email');
  const res = await quiet(() => post(require('../../netlify/functions/send-welcome-email').handler, 'guest', {}));
  if (res.statusCode === 200) assert.strictEqual(json(res).status, 'held_anonymous');
  assert.strictEqual(db._get(`userProfiles/${GUEST.uid}`).welcomeEmail, undefined);
});

// ── Stats ────────────────────────────────────────────────────────────

test('isRanked: a guest is never ranked', () => {
  const s = computeUserStats([show()]);
  assert.strictEqual(isRanked({}, s), true);
  assert.strictEqual(isRanked({}, s, { anonymous: true }), false);
});

test('community stats: guests are out of totalUsers, the totals and the boards', () => {
  const profiles = [{ id: 'a', firstName: 'A' }, { id: 'g', firstName: 'G' }];
  const shows = { a: [show()], g: [show({ setlistfmId: 'x' }), show({ date: '2024-06-16' })] };
  const all = buildCommunityStats(profiles, shows);
  assert.strictEqual(all.totalUsers, 2);
  const out = buildCommunityStats(profiles, shows, null, { anonymousUids: new Set(['g']) });
  assert.strictEqual(out.totalUsers, 1);
  assert.strictEqual(out.totalShows, 1);
  assert.ok(!out.topShowsAttended.some((e) => e.userId === 'g'));
});

test('rebuildAllStats: guests from Auth are unranked and uncounted', async () => {
  setup();
  db._put(`userProfiles/${GUEST.uid}`, { firstName: 'Guest' });
  db._put(`users/${GUEST.uid}/shows/1`, show());
  db._put(`users/${GUEST.uid}/shows/2`, show({ date: '2024-06-16' }));
  db._put(`users/${ALICE.uid}/shows/1`, show());
  const r = await rebuildAllStats(db, { auth });
  assert.strictEqual(r.guests, 1);
  assert.strictEqual(db._get(`userStats/${GUEST.uid}`).ranked, false);
  assert.strictEqual(db._get(`userStats/${GUEST.uid}`).showCount, 2, 'a guest still gets their own numbers');
  assert.strictEqual(db._get(`userStats/${ALICE.uid}`).ranked, true);
  assert.strictEqual(db._get(`userStats/${ALICE.uid}`).rank, 1, 'the guest with more shows is not ahead');
  assert.strictEqual(db._get('communityStats/global').totalUsers, 2, 'Alice and Bob, not the guest');
});

test('recomputeUserStats: anonymous → unranked', async () => {
  setup();
  db._put(`users/${GUEST.uid}/shows/1`, show());
  const doc = await recomputeUserStats(db, GUEST.uid, { anonymous: true });
  assert.strictEqual(doc.ranked, false);
});

// ── account-linked ───────────────────────────────────────────────────

test('account-linked: claims an invite, recomputes stats ranked, stamps the profile once', async () => {
  setup({ users: [...AUTH_USERS.filter((u) => u.uid !== GUEST.uid), { uid: LINKED.uid, email: LINKED.email, providerData: [{ providerId: 'password' }], metadata: { creationTime: NOW.toUTCString() } }] });
  db._put(`invites/i1`, { inviterUid: ALICE.uid, inviteeEmail: LINKED.email, status: 'pending', createdAt: NOW });
  db._put(`users/${LINKED.uid}/shows/1`, show());
  db._put(`userProfiles/${LINKED.uid}`, { createdAt: NOW, welcomeEmail: { status: 'sent', at: NOW, attempts: 1 } });
  const res = await quiet(() => post(accountLinked.handler, 'linked', {}));
  assert.strictEqual(res.statusCode, 200, res.body);
  const b = json(res);
  assert.strictEqual(b.invites.claimed, true);
  assert.strictEqual(b.invites.inviterUid, ALICE.uid);
  assert.ok(db._get(`users/${LINKED.uid}/friends/${ALICE.uid}`), 'friends both ways');
  assert.ok(db._get(`users/${ALICE.uid}/friends/${LINKED.uid}`));
  assert.strictEqual(b.welcomeEmail.status, 'already_handled');
  assert.strictEqual(b.stats.ranked, true);
  assert.strictEqual(b.profile.status, 'stamped');
  assert.strictEqual(db._get(`userProfiles/${LINKED.uid}`).convertedFromGuest, true);
  const again = json(await quiet(() => post(accountLinked.handler, 'linked', {})));
  assert.strictEqual(again.profile.status, 'already');
  assert.strictEqual(again.invites.claimed, false, 'the invite is already accepted');
});

// ── adopt-guest-shows ────────────────────────────────────────────────

test('adopt plan: duplicates stay with the account, possible ones only when picked, guest copies move once', () => {
  const account = [
    { id: 'a1', ...show({ setlistfmId: 'sf1' }) },
    { id: 'a2', ...show({ date: '2024-07-01', venue: 'The Gorge' }) },
  ];
  const guest = [
    { id: 'g1', ...show({ setlistfmId: 'sf1', venue: 'Somewhere else' }) },          // setlist.fm id
    { id: 'g2', ...show({ date: '2024-07-01', venue: 'the gorge' }) },                // same show
    { id: 'g3', ...show({ date: '2024-07-01', venue: 'Gorge Amphitheatre' }) },       // possible
    { id: 'g4', ...show({ date: '2024-08-01', venue: 'MSG' }) },                      // new
    { id: 'g5', ...show({ date: '2024-08-01', venue: 'MSG' }) },                      // a guest duplicate of g4
  ];
  const p = adoptGuest.planAdoption({ guestShows: guest, accountShows: account });
  assert.deepStrictEqual(p.move.map((s) => s.id), ['g4']);
  assert.deepStrictEqual(p.duplicates.map((d) => [d.guestShowId, d.rule]), [['g1', 'setlistfm-id'], ['g2', 'same-show'], ['g5', 'same-show']]);
  assert.deepStrictEqual(p.possible.map((d) => [d.guestShowId, d.existingShowId]), [['g3', 'a2']]);
  const picked = adoptGuest.planAdoption({ guestShows: guest, accountShows: account, includePossible: ['g3'] });
  assert.deepStrictEqual(picked.move.map((s) => s.id), ['g3', 'g4']);
});

test('adopt: followed bands merge by name, legacy strings included; upcoming shows dedupe by band and day', () => {
  const m = adoptGuest.mergeFollowedBands([{ name: 'Goose', mbid: 'x' }, 'Phish'], ['goose', { name: 'Spafford', mbid: null }, 'phish']);
  assert.strictEqual(m.added, 1);
  assert.deepStrictEqual(m.merged.map((b) => (typeof b === 'string' ? b : b.name)), ['Goose', 'Phish', 'Spafford']);
  const u = adoptGuest.planUpcoming([{ id: 'u1', artist: 'Goose', date: '2030-01-01' }, { id: 'u2', artist: 'Phish', date: '2030-01-02' }], [{ id: 'x', artist: 'goose', date: '2030-01-01' }]);
  assert.deepStrictEqual(u.map((x) => x.id), ['u2']);
});

test('adopt-guest-shows: needs a real guest token that is not the caller', async () => {
  setup();
  const call = (body) => quiet(() => post(adoptGuest.handler, 'alice', body));
  assert.strictEqual((await call({ mode: 'preview' })).statusCode, 400);
  assert.strictEqual((await call({ mode: 'preview', guestIdToken: 'nope' })).statusCode, 401);
  const notGuest = await call({ mode: 'preview', guestIdToken: 'bob' });
  assert.strictEqual(notGuest.statusCode, 403);
  assert.strictEqual(json(notGuest).code, 'not_a_guest');
  assert.strictEqual((await call({ mode: 'sideways', guestIdToken: 'guest' })).statusCode, 400);
});

test('adopt-guest-shows: preview writes nothing; commit moves, keeps ids, merges bands, purges the guest', async () => {
  setup();
  db._put(`users/${ALICE.uid}/shows/100`, show({ setlistfmId: 'sf1' }));
  db._put(`users/${GUEST.uid}/shows/100`, show({ date: '2024-09-09', venue: 'MSG', rating: 9 }));   // id taken on the account
  db._put(`users/${GUEST.uid}/shows/200`, show({ setlistfmId: 'sf1' }));                          // duplicate
  db._put(`users/${GUEST.uid}/shows/300`, show({ date: '2024-10-10', venue: 'Ryman' }));
  db._put(`users/${GUEST.uid}/upcomingShows/u1`, { artist: 'Goose', date: '2030-01-01' });
  db._put(`userProfiles/${GUEST.uid}`, { favoriteArtists: [{ name: 'Spafford', mbid: null }] });

  const preview = json(await quiet(() => post(adoptGuest.handler, 'alice', { mode: 'preview', guestIdToken: 'guest' })));
  assert.strictEqual(preview.move, 2);
  assert.strictEqual(preview.duplicates.length, 1);
  assert.strictEqual(preview.upcoming, 1);
  assert.strictEqual(preview.bands, 1);
  assert.strictEqual(db._get(`users/${ALICE.uid}/shows/300`), undefined, 'preview wrote nothing');

  const purged = [];
  const r = await quiet(() => adoptGuest.adopt({ db, auth, accountUid: ALICE.uid, guestUid: GUEST.uid, mode: 'commit', purge: async (_ctx, uid) => { purged.push(uid); return { errors: [], authUserDeleted: true }; } }));
  assert.strictEqual(r.moved, 2);
  assert.strictEqual(r.duplicates, 1);
  assert.strictEqual(r.upcomingMoved, 1);
  assert.strictEqual(r.bandsAdded, 1);
  assert.deepStrictEqual(purged, [GUEST.uid]);
  assert.ok(db._get(`users/${ALICE.uid}/shows/300`), 'a free id is kept');
  assert.strictEqual(db._get(`users/${ALICE.uid}/shows/100`).setlistfmId, 'sf1', 'the account\'s show is untouched');
  assert.ok(db._get(`users/${ALICE.uid}/upcomingShows/u1`));
  assert.deepStrictEqual(db._get(`userProfiles/${ALICE.uid}`).favoriteArtists.map((b) => b.name), ['Spafford']);
  assert.strictEqual(r.stats.ranked, true);
});

run();
