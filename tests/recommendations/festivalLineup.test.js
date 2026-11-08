/**
 * Festival lineups from Ticketmaster (netlify/functions/lib/festivalLineup.js
 * and netlify/functions/festival-lineup.js), on fixtures:
 *   - which events are the festival, which attractions are performers
 *   - only attendees can ask; a fresh lineup isn't refetched
 *   - a past festival is never fetched
 *   - nothing found keeps the last lineup
 *
 *   node tests/recommendations/festivalLineup.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase } = require('../../netlify/functions/lib/firebaseAdmin');
const L = require('../../netlify/functions/lib/festivalLineup');
const { handle } = require('../../netlify/functions/festival-lineup');

const FEST = { name: 'Bonnaroo Music & Arts Festival 2027', startDate: '2027-06-10', endDate: '2027-06-13', createdBy: 'alice' };
const music = [{ segment: { name: 'Music' } }];
const EVENTS = [
  {
    name: 'Bonnaroo Music and Arts Festival - 4 Day GA',
    url: 'https://www.ticketmaster.com/event/abc',
    _embedded: { attractions: [
      { name: 'Bonnaroo Music and Arts Festival', classifications: music },
      { name: 'Goose', classifications: music },
      { name: "Umphrey's McGee", classifications: music },
      { name: 'Car Camping Pass', classifications: music },
      { name: 'The Jimi Hendrix Experience', classifications: music },
    ] },
  },
  {
    name: 'Bonnaroo Parking',
    url: 'https://www.ticketmaster.com/event/park',
    _embedded: { attractions: [{ name: 'Goose', classifications: music }, { name: 'Parking', classifications: [{ segment: { name: 'Miscellaneous' } }] }] },
  },
  { name: 'Goose at Red Rocks', _embedded: { attractions: [{ name: 'Goose' }, { name: 'Some Opener' }] } },
];

test('the lineup is the performers on the festival\'s own events', () => {
  const r = L.lineupFromEvents(EVENTS, FEST);
  assert.deepStrictEqual(r.lineup, ['Goose', "Umphrey's McGee", 'The Jimi Hendrix Experience']);
  assert.strictEqual(r.url, 'https://www.ticketmaster.com/event/abc');
});

test('an unrelated event is not the festival', () => {
  assert.strictEqual(L.eventIsFestival('Goose at Red Rocks', FEST.name), false);
  assert.strictEqual(L.eventIsFestival('BONNAROO 2027 Single Day', FEST.name), true);
  assert.strictEqual(L.lineupFromEvents([EVENTS[2]], FEST), null);
});

test('no events, no lineup', () => {
  assert.strictEqual(L.lineupFromEvents([], FEST), null);
});

function setup({ attending = true, festival = FEST } = {}) {
  const db = createFakeDb();
  const auth = createFakeAuth({ tokens: { tok: { uid: 'bob', email: 'bob@example.com' } } });
  __setTestFirebase({ db, auth });
  db._put('festivals/f1', festival);
  if (attending) db._put('users/bob/festivals/a1', { festivalId: 'f1' });
  let calls = 0;
  const get = async (url) => {
    calls++;
    assert.ok(url.includes('startDateTime=2027-06-09'), url);
    assert.ok(url.includes('endDateTime=2027-06-14'), url);
    return { statusCode: 200, body: { _embedded: { events: EVENTS } } };
  };
  const ev = { httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify({ festivalId: 'f1' }) };
  return { db, get, ev, calls: () => calls };
}
const NOW = Date.parse('2027-05-01T12:00:00Z');

test('an attendee gets the lineup, and it is stored on the festival', async () => {
  const s = setup();
  const res = await handle(s.ev, { db: s.db, get: s.get, apiKey: 'k', now: NOW });
  assert.strictEqual(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.lineup.length, 3);
  assert.strictEqual(body.source, 'ticketmaster');
  assert.strictEqual(s.db._get('festivals/f1').lineupSource, 'ticketmaster');
});

test('a lineup fetched today is not fetched again', async () => {
  const s = setup();
  await handle(s.ev, { db: s.db, get: s.get, apiKey: 'k', now: NOW });
  await handle(s.ev, { db: s.db, get: s.get, apiKey: 'k', now: NOW + 3600000 });
  assert.strictEqual(s.calls(), 1);
  await handle(s.ev, { db: s.db, get: s.get, apiKey: 'k', now: NOW + L.REFRESH_MS + 1 });
  assert.strictEqual(s.calls(), 2);
});

test('someone not attending is refused', async () => {
  const s = setup({ attending: false });
  const res = await handle(s.ev, { db: s.db, get: s.get, apiKey: 'k', now: NOW });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(s.calls(), 0);
});

test('signed out is refused', async () => {
  const s = setup();
  const res = await handle({ ...s.ev, headers: {} }, { db: s.db, get: s.get, apiKey: 'k', now: NOW });
  assert.strictEqual(res.statusCode, 401);
});

test('a past festival is never fetched', async () => {
  const s = setup();
  const res = await handle(s.ev, { db: s.db, get: s.get, apiKey: 'k', now: Date.parse('2027-07-01T00:00:00Z') });
  assert.strictEqual(JSON.parse(res.body).upcoming, false);
  assert.strictEqual(s.calls(), 0);
});

test('nothing found keeps the lineup already stored', async () => {
  const s = setup({ festival: { ...FEST, lineup: ['Goose'], lineupSource: 'ticketmaster', lineupFetchedAt: new Date(NOW - 2 * L.REFRESH_MS) } });
  const empty = async () => ({ statusCode: 200, body: {} });
  const res = await handle(s.ev, { db: s.db, get: empty, apiKey: 'k', now: NOW });
  assert.deepStrictEqual(JSON.parse(res.body).lineup, ['Goose']);
  assert.ok(L.isFresh(s.db._get('festivals/f1'), NOW));
});

test('a Ticketmaster failure returns what is stored, without writing', async () => {
  const s = setup();
  const failing = async () => ({ statusCode: 503, body: {} });
  const before = s.db._writes.length;
  const res = await handle(s.ev, { db: s.db, get: failing, apiKey: 'k', now: NOW });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(res.body).lineup, []);
  assert.strictEqual(s.db._writes.length, before);
});

run('festival lineup');
