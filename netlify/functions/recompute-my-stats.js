// netlify/functions/recompute-my-stats.js
//
//   POST /.netlify/functions/recompute-my-stats   Auth: Bearer {idToken}
//     -> { ok, stats: { showCount, songCount, …, rank, rankedOf } }
//
// Recomputes the caller's userStats/{uid} and publicUserStats/{uid} from
// their own shows with lib/stats (lib/userStats.js recomputeUserStats). The
// web app calls it, debounced, after it adds, edits or deletes shows
// (5.59.15). Every iOS build up to 3.13.14 doesn't, and the scheduled
// rebuild (community-stats.js, every 6 hours) catches those.
//
// Signed-in only; 200 recomputes per user per UTC day (rateLimit.js), far
// above real use since the app debounces.

const { withCors } = require('./lib/cors');
const { getDb } = require('./lib/firebaseAdmin');
const { requireUser } = require('./lib/requestAuth');
const { takeDailyQuota } = require('./lib/rateLimit');
const { recomputeUserStats } = require('./lib/userStats');

const DAILY_LIMIT = 200;
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

  const user = await requireUser(event, HEADERS);
  if (user.response) return user.response;

  try {
    const db = getDb();
    const quota = await takeDailyQuota(db, `stats_${user.uid}`, DAILY_LIMIT, { uid: user.uid });
    if (!quota.allowed) {
      return reply(429, { error: 'Your stats are refreshed often enough today; they will catch up tonight.' }, { 'Retry-After': '3600' });
    }
    const { FieldValue } = require('firebase-admin/firestore');
    const doc = await recomputeUserStats(db, user.uid, { serverTimestamp: () => FieldValue.serverTimestamp(), anonymous: user.isAnonymous });
    const { computedAt, ...stats } = doc;
    return reply(200, { ok: true, stats });
  } catch (err) {
    console.error('recompute-my-stats failed:', err && err.message);
    return reply(500, { error: 'server_error' });
  }
};

module.exports.handler = withCors(module.exports.handler);
