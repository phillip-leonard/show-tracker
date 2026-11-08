// netlify/functions/community-stats.js
//
// Scheduled function (netlify.toml): rebuilds the community leaderboard,
// communityStats/global, with the Admin SDK. The work is in
// lib/communityStats.js. Clients only read the doc; firestore.rules
// denies every client write.

const { getDb } = require('./lib/firebaseAdmin');
const { rebuildCommunityStats } = require('./lib/communityStats');

exports.handler = async function () {
  try {
    const db = getDb();
    const { FieldValue } = require('firebase-admin/firestore');
    const stats = await rebuildCommunityStats(db, { serverTimestamp: () => FieldValue.serverTimestamp() });
    console.log(`[community-stats] ${stats.totalUsers} users, ${stats.totalShows} shows, ${stats.topVenues.length} top venues`);
    return { statusCode: 200, body: JSON.stringify({ totalUsers: stats.totalUsers, totalShows: stats.totalShows }) };
  } catch (error) {
    console.error('[community-stats] rebuild failed:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'rebuild failed' }) };
  }
};
