/**
 * The on-sale scan and reminder (netlify/functions/lib/onsaleAlerts.js), end to
 * end against an in-memory Firestore and a fake Ticketmaster and FCM:
 *   - one announcement per user per show, across repeated scans
 *   - radius, follows and every channel switch respected
 *   - a code from the band's email, else the sign-up link or portal
 *   - shows announced by email but not on Ticketmaster still alert
 *   - the reminder fires once, with a code that arrived after the announcement
 *
 *   node tests/notifications/onsaleAlerts.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const { __setTestTransport, sendNotificationEmail } = require('../../netlify/functions/lib/outgoingEmail');
const { ledgerId } = require('../../netlify/functions/lib/followedBandAlerts');
const { lookupCity } = require('../../netlify/functions/lib/cityLookup');
const { fetchArtistEvents, findVenueLocation } = require('../../netlify/functions/lib/ticketmasterEvents');
const {
  normalizeCity, eventKeyFor, haversineMiles, venuesMatch, nextSaleAtMs, saleIsLive, intelMatch, accessFor,
  formatSaleTime, windowLines, onsaleEmail, runOnsaleScan, runOnsaleReminders, onsalePref,
} = require('../../netlify/functions/lib/onsaleAlerts');

const NOW = Date.parse('2026-11-01T12:00:00Z');
const HOUR = 3600000;
const DAY = 24 * HOUR;
const GOOSE = ledgerId('goose');

const ALICE = 'aliceUid000001';
const BOB = 'bobUid00000001';
const FAR = 'farUid00000001';
const STRANGER = 'strangerUid001';

const DENVER = { label: 'Denver, CO', lat: 39.739, lng: -104.985 };
const NEW_YORK = { label: 'New York, NY', lat: 40.713, lng: -74.006 };

const iso = (ms) => new Date(ms).toISOString();

function rocks(over = {}) {
  return {
    id: 'tm1',
    date: '2027-06-01',
    venue: 'Red Rocks Amphitheatre',
    city: 'Morrison',
    state: 'CO',
    url: 'https://tm.example/tm1',
    status: 'onsale',
    timezone: 'America/Denver',
    lat: 39.665,
    lng: -105.205,
    publicOnsaleAt: iso(NOW + 5 * DAY),
    publicOnsaleTBD: false,
    presales: [{ name: 'Fan Presale', startsAt: iso(NOW + 3 * DAY), endsAt: iso(NOW + 4 * DAY), url: null }],
    ...over,
  };
}

function intel(id, over = {}) {
  return {
    artistId: GOOSE,
    status: 'accepted',
    senderKind: 'band',
    code: 'TACO2027',
    codeIsPersonal: false,
    presaleName: 'Newsletter presale',
    startsAt: iso(NOW + 2 * DAY),
    endsAt: null,
    tourWide: false,
    shows: [{ date: '2027-06-01', venue: 'Red Rocks', city: 'Morrison', state: 'CO' }],
    signupUrl: null,
    ticketUrl: null,
    ticketingModel: 'ticketmaster',
    parsedAtMs: NOW - HOUR,
    ...over,
  };
}

const follow = (name) => ({ name, mbid: null, addedAt: '2026-01-01' });

function setup({ events = [rocks()] } = {}) {
  const db = createFakeDb();
  __setTestFirebase({ db });
  db._put(`userProfiles/${ALICE}`, { email: 'alice@example.com', favoriteArtists: [follow('Goose')] });
  db._put(`alertSettings/${ALICE}`, { uid: ALICE, homeLocation: DENVER, alertRadiusMiles: 100, timezone: 'America/New_York' });
  // Follows the same band, but lives across the country.
  db._put(`userProfiles/${FAR}`, { email: 'far@example.com', favoriteArtists: [follow('goose ')] });
  db._put(`alertSettings/${FAR}`, { uid: FAR, homeLocation: NEW_YORK, alertRadiusMiles: 250, timezone: 'America/New_York' });
  // Near the show, doesn't follow the band.
  db._put(`userProfiles/${STRANGER}`, { email: 's@example.com', favoriteArtists: [follow('Phish')] });
  db._put(`alertSettings/${STRANGER}`, { uid: STRANGER, homeLocation: DENVER, alertRadiusMiles: 100, timezone: 'America/Denver' });
  // Follows the band, has set no city.
  db._put(`userProfiles/${BOB}`, { email: 'bob@example.com', favoriteArtists: [follow('Goose')] });

  const sent = [];
  __setTestTransport((path, payload) => { sent.push(payload); return { status: 200, body: '{"id":"x"}' }; });
  const pushes = [];
  const state = { events, calls: [], now: NOW };

  const scan = (extra = {}) => runOnsaleScan({
    db,
    fetchEvents: async (name, opts) => {
      state.calls.push({ name, ...opts });
      return name.toLowerCase() === 'goose' ? { events: state.events, attractionId: 'K8vZ', attractionConfidence: 'high' } : { events: [], attractionId: null };
    },
    locate: async (s) => lookupCity(s.city, s.state),
    sendEmail: (msg) => sendNotificationEmail({ db, ...msg }),
    sendPush: async (token, msg) => { pushes.push({ token, ...msg }); },
    createdAt: new Date(NOW),
    now: () => state.now,
    ...extra,
  });
  const remind = (extra = {}) => runOnsaleReminders({
    db,
    sendEmail: (msg) => sendNotificationEmail({ db, ...msg }),
    sendPush: async (token, msg) => { pushes.push({ token, ...msg }); },
    now: () => state.now,
    ...extra,
  });
  return { db, sent, pushes, state, scan, remind };
}

const KEY = eventKeyFor(GOOSE, '2027-06-01', 'Morrison');
const ALERT = `onsaleAlerts/${ALICE}_${KEY}`;
const NOTIF = `notifications/onsale_${ALICE}_${KEY}`;

// ── Pure rules ──────────────────────────────────────────────────────────

test('city keys ignore case, punctuation and the state', () => {
  assert.strictEqual(normalizeCity('New York, NY'), 'new york');
  assert.strictEqual(eventKeyFor('a', '2027-01-01', 'St. Louis'), eventKeyFor('a', '2027-01-01', 'st louis, MO'));
});

test('distance is about right', () => {
  const miles = haversineMiles(DENVER, NEW_YORK);
  assert.ok(miles > 1600 && miles < 1650, String(miles));
});

test('venue names match on their distinctive words', () => {
  assert.ok(venuesMatch('Red Rocks Amphitheatre', 'Red Rocks'));
  assert.ok(!venuesMatch('Red Rocks', 'Madison Square Garden'));
  assert.ok(!venuesMatch('The Arena', 'Arena'));
});

test('the city list locates a small US town, and a state rules out the wrong one', () => {
  assert.ok(lookupCity('Columbus', 'OH'));
  assert.strictEqual(lookupCity('Columbus', 'ZZ'), null);
  assert.strictEqual(lookupCity('Nowheresville-on-Nothing', 'OH'), null);
});

test('a sale is live ahead of time, for a day after it opens, and while TBA', () => {
  assert.ok(saleIsLive({ publicOnsaleAt: iso(NOW + DAY), presales: [] }, NOW));
  assert.ok(saleIsLive({ publicOnsaleAt: iso(NOW - 2 * HOUR), presales: [] }, NOW));
  assert.ok(!saleIsLive({ publicOnsaleAt: iso(NOW - 2 * DAY), presales: [] }, NOW));
  assert.ok(saleIsLive({ publicOnsaleAt: null, publicOnsaleTBD: true, presales: [] }, NOW));
});

test('the next sale is the earliest still ahead; TBA alone has none', () => {
  const c = { publicOnsaleAt: iso(NOW + 5 * DAY), presales: [{ startsAt: iso(NOW - DAY) }, { startsAt: iso(NOW + 3 * DAY) }] };
  assert.strictEqual(nextSaleAtMs(c, NOW), NOW + 3 * DAY);
  assert.strictEqual(nextSaleAtMs({ publicOnsaleTBD: true, presales: [] }, NOW), null);
});

test('email-to-show matching: date and city, a tour-wide range, and venue-only is low', () => {
  const show = { date: '2027-06-01', city: 'Morrison', venue: 'Red Rocks Amphitheatre' };
  assert.strictEqual(intelMatch(intel('a'), show), 'high');
  assert.strictEqual(intelMatch(intel('a'), { ...show, date: '2027-06-02' }), null);
  assert.strictEqual(intelMatch(intel('a', { shows: [{ date: '2027-06-01', venue: 'Red Rocks', city: 'Denver' }] }), show), 'low');
  const tour = intel('a', { tourWide: true, shows: [{ date: '2027-05-01', venue: 'A', city: 'X' }, { date: '2027-07-01', venue: 'B', city: 'Y' }] });
  assert.strictEqual(intelMatch(tour, show), 'high');
  assert.strictEqual(intelMatch(tour, { ...show, date: '2027-08-01' }), null);
});

test('access: a band code first; Seated, personal and unapproved codes never', () => {
  const show = { date: '2027-06-01', city: 'Morrison', venue: 'Red Rocks' };
  const artist = { name: 'Goose', presaleSignupUrls: [{ url: 'https://go.seated.com/goose', kind: 'seated' }] };
  assert.strictEqual(accessFor({ artist, intelList: [intel('a')], show }).presaleCode, 'TACO2027');
  assert.strictEqual(accessFor({ artist, intelList: [intel('a')], show }).codeSource, "From Goose's newsletter");

  for (const bad of [
    intel('a', { senderKind: 'seated' }),
    intel('a', { codeIsPersonal: true }),
    intel('a', { status: 'pending_review' }),
    intel('a', { status: 'discarded' }),
  ]) {
    const access = accessFor({ artist, intelList: [bad], show });
    assert.strictEqual(access.presaleCode, null, JSON.stringify(bad));
    assert.strictEqual(access.signupUrl, 'https://go.seated.com/goose');
  }
});

test('times: the user\'s zone with its abbreviation, plus the venue\'s when different', () => {
  const at = '2027-01-08T15:00:00Z';
  assert.strictEqual(formatSaleTime(at, 'America/New_York', 'America/Denver'), 'Fri, Jan 8, 10:00 AM EST (Fri, Jan 8, 8:00 AM MST at the venue)');
  assert.strictEqual(formatSaleTime(at, 'America/Denver', 'America/Denver'), 'Fri, Jan 8, 8:00 AM MST');
  assert.ok(formatSaleTime(at, 'Not/AZone', null).includes('UTC'));
});

test('a TBA sale reads as TBA', () => {
  const lines = windowLines({ publicOnsaleTBD: true, publicOnsaleAt: null, presales: [] }, 'UTC');
  assert.deepStrictEqual(lines, [{ label: 'Public on-sale', when: 'On-sale time TBA' }]);
});

test('channel defaults: all on until switched off', () => {
  assert.deepStrictEqual(onsalePref({}), { enabled: true, push: true, email: true, inApp: true });
  assert.strictEqual(onsalePref({ notificationPrefs: { onsaleAlerts: { inApp: false } } }).inApp, false);
});

// ── The email ───────────────────────────────────────────────────────────

test('the email has show, times in the user\'s zone, code, CTA and preferences link, all escaped', () => {
  const alert = {
    artistName: 'Goose & <Friends>',
    artistId: GOOSE,
    venue: 'Red Rocks',
    city: 'Morrison',
    eventDate: '2027-06-01',
    timezone: 'America/Denver',
    publicOnsaleAt: '2027-01-08T15:00:00Z',
    presales: [],
    presaleCode: 'TACO2027',
    codeSource: 'From Goose\'s newsletter',
    url: 'https://tm.example/1',
  };
  const { subject, html } = onsaleEmail([alert], { userTz: 'America/New_York' });
  assert.ok(subject.startsWith('On sale soon: Goose & <Friends> – Morrison'));
  assert.ok(html.includes('Goose &amp; &lt;Friends&gt;'));
  assert.ok(!html.includes('<Friends>'));
  assert.ok(html.includes('10:00 AM EST'));
  assert.ok(html.includes('8:00 AM MST'));
  assert.ok(html.includes('TACO2027'));
  assert.ok(html.includes('https://tm.example/1'));
  assert.ok(html.includes('/profile/'));
});

test('with no code the email offers the sign-up link; a portal replaces the event link', () => {
  const base = { artistName: 'Goose', venue: 'V', city: 'C', eventDate: '2027-06-01', presales: [], url: 'https://tm.example/1' };
  const signup = onsaleEmail([{ ...base, signupUrl: 'https://go.seated.com/goose' }], { userTz: 'UTC' }).html;
  assert.ok(signup.includes("Sign up for Goose&#39;s presale to get the code.") || signup.includes("Sign up for Goose's presale to get the code."));
  const portal = onsaleEmail([{ ...base, portalUrl: 'https://tickets.phish.com/r', signupUrl: 'https://x.example' }], { userTz: 'UTC' }).html;
  assert.ok(portal.includes('https://tickets.phish.com/r'));
  assert.ok(!portal.includes('https://tm.example/1'));
  assert.ok(!portal.includes('https://x.example'));
});

// ── The scan ────────────────────────────────────────────────────────────

test('a follower within their radius is told once, across repeated scans', async () => {
  const { db, sent, scan } = setup();
  const first = await scan();
  assert.strictEqual(first.created, 1);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, 'alice@example.com');
  assert.ok(db._get(ALERT));
  assert.strictEqual(db._get(NOTIF).type, 'onsale_alert');

  await scan();
  await scan();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(db._list('onsaleAlerts').length, 1);
});

test('out of radius, unfollowed, or no city: no alert', async () => {
  const { db, scan, sent } = setup();
  await scan();
  assert.strictEqual(db._get(`onsaleAlerts/${FAR}_${KEY}`), undefined);
  assert.strictEqual(db._get(`onsaleAlerts/${STRANGER}_${KEY}`), undefined);
  assert.strictEqual(db._get(`onsaleAlerts/${BOB}_${KEY}`), undefined);
  assert.ok(sent.every((m) => m.to === 'alice@example.com'));
});

test('the attraction is cached, and a band Ticketmaster does not know is not asked again for a week', async () => {
  const { db, state, scan } = setup();
  await scan();
  assert.deepStrictEqual(state.calls.map((c) => c.attractionId), [null, null]);
  assert.strictEqual(db._get(`artists/${GOOSE}`).ticketmasterAttractionId, 'K8vZ');
  state.calls.length = 0;
  state.now += HOUR;
  await scan();
  // Goose by its cached id; the band not on Ticketmaster isn't asked again for a week.
  assert.deepStrictEqual(state.calls.map((c) => [c.name, c.attractionId]), [['Goose', 'K8vZ']]);
});

test('every sale ended or show past: nothing', async () => {
  const { scan, sent, state } = setup();
  state.events = [
    rocks({ publicOnsaleAt: iso(NOW - 10 * DAY), presales: [] }),
    rocks({ id: 'tm2', date: '2020-01-01' }),
    rocks({ id: 'tm3', date: '2027-07-01', status: 'cancelled' }),
  ];
  assert.strictEqual((await scan()).created, 0);
  assert.strictEqual(sent.length, 0);
});

test('several shows for one user in one scan are one digest email and one push', async () => {
  const { db, sent, pushes, scan, state } = setup();
  db._put('pushTokens/tok1', { userId: ALICE, platform: 'ios' });
  state.events = [rocks(), rocks({ id: 'tm2', date: '2027-06-02' }), rocks({ id: 'tm3', date: '2027-06-03' })];
  const r = await scan();
  assert.strictEqual(r.created, 3);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].subject, '3 shows going on sale near you');
  assert.strictEqual(pushes.length, 1);
  assert.ok(pushes[0].link.endsWith('/notifications/'));
});

test('two Ticketmaster listings of one night are one alert', async () => {
  const { db, scan, state } = setup();
  state.events = [rocks(), rocks({ id: 'tm-vip', presales: [{ name: 'VIP', startsAt: iso(NOW + DAY), endsAt: null, url: null }] })];
  await scan();
  const alert = db._get(ALERT);
  assert.strictEqual(db._list('onsaleAlerts').length, 1);
  assert.deepStrictEqual(alert.presales.map((p) => p.name).sort(), ['Fan Presale', 'VIP']);
});

test('channel switches are honored, and all off records nothing', async () => {
  const { db, sent, pushes, scan } = setup();
  db._put('pushTokens/tok1', { userId: ALICE, platform: 'ios' });
  db._put(`userProfiles/${ALICE}`, {
    email: 'alice@example.com',
    favoriteArtists: [follow('Goose')],
    notificationPrefs: { onsaleAlerts: { email: false, push: true, inApp: false } },
  });
  await scan();
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(pushes.length, 1);
  assert.strictEqual(db._get(NOTIF), undefined);

  const off = setup();
  off.db._put(`userProfiles/${ALICE}`, {
    email: 'alice@example.com',
    favoriteArtists: [follow('Goose')],
    notificationPrefs: { onsaleAlerts: { enabled: false } },
  });
  await off.scan();
  assert.strictEqual(off.db._list('onsaleAlerts').length, 0);

  const none = setup();
  none.db._put(`userProfiles/${ALICE}`, {
    email: 'alice@example.com',
    favoriteArtists: [follow('Goose')],
    notificationPrefs: { onsaleAlerts: { email: false, push: false, inApp: false } },
  });
  await none.scan();
  assert.strictEqual(none.db._list('onsaleAlerts').length, 0);
});

test('global unsubscribe stops the email and leaves the in-app alert', async () => {
  const { db, sent, scan } = setup();
  db._put(`userProfiles/${ALICE}`, { email: 'alice@example.com', favoriteArtists: [follow('Goose')], emailOptOut: true });
  await scan();
  assert.strictEqual(sent.length, 0);
  assert.ok(db._get(NOTIF));
});

test('a changed sale time updates the record and says nothing new', async () => {
  const { db, sent, scan, state } = setup();
  await scan();
  const later = iso(NOW + 9 * DAY);
  state.events = [rocks({ publicOnsaleAt: later })];
  const r = await scan();
  assert.strictEqual(r.updated, 1);
  assert.strictEqual(r.created, 0);
  assert.strictEqual(db._get(ALERT).publicOnsaleAt, later);
  assert.ok(db._get(NOTIF).windows.some((w) => w.label === 'Public on-sale' && w.when.includes('Nov 10')));
  assert.strictEqual(sent.length, 1);
});

test('a tour-wide code from a newsletter attaches to every matching date', async () => {
  const { db, scan, state } = setup();
  state.events = [rocks(), rocks({ id: 'tm2', date: '2027-06-02' }), rocks({ id: 'tm3', date: '2027-09-01' })];
  db._put('presaleIntel/e1', intel('e1', {
    tourWide: true,
    shows: [{ date: '2027-06-01', venue: 'Red Rocks', city: 'Morrison', state: 'CO' }, { date: '2027-06-02', venue: 'Red Rocks', city: 'Morrison', state: 'CO' }],
  }));
  await scan();
  assert.strictEqual(db._get(ALERT).presaleCode, 'TACO2027');
  assert.strictEqual(db._get(ALERT).codeSource, "From Goose's newsletter");
  assert.strictEqual(db._get(`onsaleAlerts/${ALICE}_${eventKeyFor(GOOSE, '2027-06-02', 'Morrison')}`).presaleCode, 'TACO2027');
  assert.strictEqual(db._get(`onsaleAlerts/${ALICE}_${eventKeyFor(GOOSE, '2027-09-01', 'Morrison')}`).presaleCode, null);
  assert.deepStrictEqual(db._get('presaleIntel/e1').matchedTmEventIds, ['tm1', 'tm2']);
});

test('with no code the alert carries the Seated sign-up link', async () => {
  const { db, sent, scan } = setup();
  db._put(`artists/${GOOSE}`, { name: 'Goose', presaleSignupUrls: [{ url: 'https://go.seated.com/goose', kind: 'seated' }] });
  await scan();
  assert.strictEqual(db._get(ALERT).presaleCode, null);
  assert.strictEqual(db._get(ALERT).signupUrl, 'https://go.seated.com/goose');
  assert.ok(sent[0].html.includes('https://go.seated.com/goose'));
});

test('a band-portal on-sale links to the portal, not Ticketmaster', async () => {
  const { db, sent, scan } = setup();
  db._put('presaleIntel/e1', intel('e1', { code: null, ticketingModel: 'bandPortal', ticketUrl: 'https://tickets.phish.com/request' }));
  await scan();
  const alert = db._get(ALERT);
  assert.strictEqual(alert.portalUrl, 'https://tickets.phish.com/request');
  assert.strictEqual(alert.ticketingModel, 'bandPortal');
  assert.ok(sent[0].html.includes('https://tickets.phish.com/request'));
  assert.ok(!sent[0].html.includes('tm.example'));
});

test('a show announced by email but not on Ticketmaster still alerts, and then merges when listed', async () => {
  const { db, sent, scan, state } = setup({ events: [] });
  db._put('presaleIntel/e1', intel('e1', {
    shows: [{ date: '2027-06-01', venue: 'Mission Ballroom', city: 'Denver', state: 'CO' }],
    ticketUrl: 'https://band.example/tickets',
  }));
  await scan();
  const key = eventKeyFor(GOOSE, '2027-06-01', 'Denver');
  const alert = db._get(`onsaleAlerts/${ALICE}_${key}`);
  assert.strictEqual(alert.tmEventId, null);
  assert.strictEqual(alert.presaleCode, 'TACO2027');
  assert.strictEqual(alert.url, 'https://band.example/tickets');
  assert.strictEqual(sent.length, 1);
  assert.ok(db._get('presaleIntel/e1').shows[0].lat != null, 'location kept');

  state.events = [rocks({ id: 'tm9', venue: 'Mission Ballroom', city: 'Denver', lat: 39.77, lng: -104.98 })];
  await scan();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(db._get(`onsaleAlerts/${ALICE}_${key}`).tmEventId, 'tm9');
});

test('low-confidence parses are never sent; a venue-only match waits for approval', async () => {
  const { db, sent, scan } = setup({ events: [] });
  db._put('presaleIntel/e1', intel('e1', { status: 'pending_review', shows: [{ date: '2027-06-01', venue: 'X', city: 'Denver', state: 'CO' }] }));
  await scan();
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(db._list('onsaleAlerts').length, 0);

  const venueOnly = setup();
  venueOnly.db._put('presaleIntel/e2', intel('e2', { shows: [{ date: '2027-06-01', venue: 'Red Rocks', city: 'Denver', state: 'CO' }] }));
  await venueOnly.scan();
  assert.strictEqual(venueOnly.db._get(ALERT).presaleCode, null);
  assert.strictEqual(venueOnly.db._get('presaleIntel/e2').needsMatchReview, true);
});

test('an email that is not about a sale creates no alert, even if it lists dates', async () => {
  const { db, sent, scan } = setup({ events: [] });
  db._put('presaleIntel/e1', intel('e1', { isSaleEmail: false, shows: [{ date: '2027-06-01', venue: 'Mission Ballroom', city: 'Denver', state: 'CO' }] }));
  await scan();
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(db._list('onsaleAlerts').length, 0);
});

test('a run past its deadline stops, and the next starts with the bands it missed', async () => {
  const { db, state, scan } = setup();
  db._put(`artists/${GOOSE}`, { name: 'Goose', onsaleCheckedAtMs: NOW });
  const r = await scan({ maxBands: 1 });
  assert.strictEqual(r.bands, 1);
  assert.strictEqual(r.skippedForTime, 1);
  assert.strictEqual(state.calls[0].name, 'Phish');
  assert.strictEqual(db._list('onsaleAlerts').length, 0);
  state.calls.length = 0;
  state.now += HOUR;
  await scan({ maxBands: 1 });
  assert.strictEqual(state.calls[0].name, 'Goose');
});

test('when Ticketmaster can\'t be asked the band stays first in line', async () => {
  const { db, scan } = setup();
  await scan({ fetchEvents: async () => null });
  assert.strictEqual(db._get(`artists/${GOOSE}`), undefined);
  assert.strictEqual(db._list('onsaleAlerts').length, 0);
});

// ── The reminder ────────────────────────────────────────────────────────

test('the reminder goes once, about an hour before the earliest window, with a code that arrived later', async () => {
  const { db, sent, scan, remind, state } = setup();
  const opens = NOW + 3 * DAY;
  await scan();
  assert.strictEqual(db._get(ALERT).presaleCode, null);
  assert.strictEqual(sent.length, 1);

  state.now = opens - 2 * HOUR;
  assert.strictEqual((await remind()).due, 0);

  db._put('presaleIntel/late', intel('late', { code: 'MORNINGOF', parsedAtMs: state.now }));

  state.now = opens - 45 * 60000;
  const r = await remind();
  assert.strictEqual(r.reminded, 1);
  assert.strictEqual(sent.length, 2);
  assert.ok(sent[1].subject.startsWith('On sale in an hour'));
  assert.ok(sent[1].html.includes('MORNINGOF'));
  assert.strictEqual(db._get(ALERT).presaleCode, 'MORNINGOF');
  assert.ok(db._get(ALERT).reminderSentAtMs);
  assert.strictEqual(db._get(NOTIF).presaleCode, 'MORNINGOF');

  state.now += 15 * 60000;
  assert.strictEqual((await remind()).reminded, 0);
  assert.strictEqual(sent.length, 2);
});

test('a TBA sale shows TBA and gets no reminder', async () => {
  const { db, sent, scan, remind, state } = setup();
  state.events = [rocks({ publicOnsaleAt: null, publicOnsaleTBD: true, presales: [] })];
  await scan();
  const alert = db._get(ALERT);
  assert.strictEqual(alert.nextSaleAtMs, null);
  assert.ok(sent[0].html.includes('On-sale time TBA'));
  state.now += 30 * DAY;
  assert.strictEqual((await remind()).due, 0);
});

test('a sale opening within the hour is announced, and not reminded right after', async () => {
  const { sent, scan, remind, state } = setup();
  state.events = [rocks({ publicOnsaleAt: iso(NOW + 30 * 60000), presales: [] })];
  await scan();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual((await remind()).reminded, 0);
  assert.strictEqual(sent.length, 1);
});

test('turning the alert off stops the reminder too', async () => {
  const { db, sent, scan, remind, state } = setup();
  await scan();
  db._put(`userProfiles/${ALICE}`, { email: 'alice@example.com', favoriteArtists: [follow('Goose')], notificationPrefs: { onsaleAlerts: { enabled: false } } });
  state.now = NOW + 3 * DAY - 45 * 60000;
  await remind();
  assert.strictEqual(sent.length, 1);
});

// ── Ticketmaster mapping ────────────────────────────────────────────────

function fakeTicketmaster(pages, attractions = []) {
  const urls = [];
  const get = async (url) => {
    urls.push(url);
    if (url.includes('/attractions.json')) return { statusCode: 200, body: { _embedded: { attractions } } };
    if (url.includes('/venues.json')) return { statusCode: 200, body: { _embedded: { venues: pages } } };
    const page = Number(new URL(url).searchParams.get('page'));
    return { statusCode: 200, body: { _embedded: { events: pages[page] || [] }, page: { totalPages: pages.length } } };
  };
  return { get, urls };
}

const TM_EVENT = {
  id: 'E1',
  name: 'Goose',
  url: 'https://www.ticketmaster.com/e1',
  dates: { start: { localDate: '2027-06-01' }, timezone: 'America/Denver', status: { code: 'onsale' } },
  sales: {
    public: { startDateTime: '2027-01-08T17:00:00Z', startTBD: false },
    presales: [{ name: 'Fan Presale', description: 'Enter code ABC', startDateTime: '2027-01-06T15:00:00Z', endDateTime: '2027-01-07T15:00:00Z', url: 'https://x' }],
  },
  info: 'Enter presale code: LISTED123',
  _embedded: { venues: [{ name: 'Red Rocks', city: { name: 'Morrison' }, state: { stateCode: 'CO' }, location: { latitude: '39.66', longitude: '-105.2' } }] },
};

test('the Ticketmaster mapper keeps sale fields, pages, and never picks up listing-text codes', async () => {
  const { get, urls } = fakeTicketmaster([[TM_EVENT], [{ ...TM_EVENT, id: 'E2' }]]);
  const r = await fetchArtistEvents('Goose', { apiKey: 'k', attractionId: 'A1', get });
  assert.strictEqual(r.events.length, 2);
  assert.strictEqual(urls.length, 2);
  const e = r.events[0];
  assert.strictEqual(e.publicOnsaleAt, '2027-01-08T17:00:00Z');
  assert.strictEqual(e.timezone, 'America/Denver');
  assert.strictEqual(e.lat, 39.66);
  assert.strictEqual(e.presales[0].name, 'Fan Presale');
  assert.ok(!JSON.stringify(e).includes('LISTED123'));
  assert.ok(!JSON.stringify(e).includes('Enter code ABC'));
  assert.ok(!e.url.includes('camefrom'));
});

test('of several attractions with the band\'s exact name, the busiest wins and is flagged', async () => {
  const { get } = fakeTicketmaster([[]], [
    { id: 'quiet', name: 'Goose', upcomingEvents: { _total: 1 } },
    { id: 'busy', name: 'GOOSE', upcomingEvents: { _total: 40 } },
    { id: 'other', name: 'Mother Goose', upcomingEvents: { _total: 90 } },
  ]);
  const r = await fetchArtistEvents('Goose', { apiKey: 'k', get });
  assert.strictEqual(r.attractionId, 'busy');
  assert.strictEqual(r.attractionConfidence, 'low');
});

test('a venue lookup needs the right city', async () => {
  const { get } = fakeTicketmaster([{ city: { name: 'Elsewhere' }, location: { latitude: '1', longitude: '2' } }, { city: { name: 'Denver' }, location: { latitude: '39.7', longitude: '-105' } }]);
  assert.deepStrictEqual(await findVenueLocation({ venue: 'V', city: 'Denver', state: 'CO' }, { apiKey: 'k', get }), { lat: 39.7, lng: -105 });
  assert.strictEqual(await findVenueLocation({ venue: 'V', city: 'Nope' }, { apiKey: 'k', get }), null);
});

run('On-sale alerts');
