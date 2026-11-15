// netlify/functions/community-stats.js
//
// Scheduled function (netlify.toml, every 6 hours): since 5.59.15 it
// rebuilds every user's numbers, userStats/{uid} and publicUserStats/{uid}
// with rank, and the community leaderboard, communityStats/global, from
// the shows (lib/userStats.js rebuildAllStats, lib/stats). It is the safety
// net for every change the app doesn't report through recompute-my-stats,
// including every iOS build up to 3.13.14. Clients only read these docs;
// firestore.rules denies every client write. Logs counts only.

const { getDb, getAdminAuth } = require('./lib/firebaseAdmin');
const { rebuildAllStats } = require('./lib/userStats');

exports.handler = async function () {
  try {
    const db = getDb();
    const { FieldValue } = require('firebase-admin/firestore');
    const run = await rebuildAllStats(db, { serverTimestamp: () => FieldValue.serverTimestamp(), auth: getAdminAuth() });
    console.log(`[community-stats] ${run.users} users (${run.ranked} ranked), ${run.shows} shows, ${run.written} stats docs written`);
    return { statusCode: 200, body: JSON.stringify({ users: run.users, guests: run.guests, ranked: run.ranked, shows: run.shows }) };
  } catch (error) {
    console.error('[community-stats] rebuild failed:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'rebuild failed' }) };
  }
};
