// netlify/functions/match-festivals.js — "is this one of these?" for a
// festival someone is about to create (5.60.8, pre-native server moves
// Part 3).
//
//   POST, Authorization: Bearer {idToken}
//   { name, startDate?, endDate?, year?, location? }
//     -> { ok, matches: [{ festival: { id, name, startDate?, … }, similarity, sameLocation }] }
//
// The catalog's candidates matched by the one festival rule
// (lib/festivalMatch.js, via lib/festivalMatchServer.js), best first,
// leaving out festivals the caller already joined. Signed in;
// MATCH_DAILY_LIMIT per user per UTC day (the form asks as the user types).

const { withCors } = require('./lib/cors');
const { getDb } = require('./lib/firebaseAdmin');
const { requireAccount } = require('./lib/requestAuth');
const { takeDailyQuota } = require('./lib/rateLimit');
const { matchFestivalsFor } = require('./lib/festivalMatchServer');

const MATCH_DAILY_LIMIT = 1000;
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(body) });

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });
  const user = await requireAccount(event, HEADERS);
  if (user.response) return user.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body.' }); }
  const draft = {
    name: String(body.name || '').slice(0, 200),
    startDate: typeof body.startDate === 'string' ? body.startDate : '',
    endDate: typeof body.endDate === 'string' ? body.endDate : '',
    year: Number.isInteger(body.year) ? body.year : undefined,
    location: typeof body.location === 'string' ? body.location.slice(0, 200) : '',
  };

  try {
    const db = getDb();
    const quota = await takeDailyQuota(db, `festmatch_${user.uid}`, MATCH_DAILY_LIMIT, { uid: user.uid });
    if (!quota.allowed) return reply(429, { error: 'Too many festival lookups today. Try again tomorrow.' }, { 'Retry-After': '3600' });
    return reply(200, { ok: true, matches: await matchFestivalsFor(db, user.uid, draft) });
  } catch (err) {
    console.error('match-festivals failed:', err && err.message);
    return reply(500, { error: 'server_error' });
  }
};

module.exports.handler = withCors(module.exports.handler);
