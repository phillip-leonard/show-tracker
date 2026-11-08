// netlify/functions/band-affinity.js
//
// Nightly (netlify.toml, 14:00 UTC): rebuilds bandAffinity/* and
// bandPopularity/all, the shared, count-only data behind Discover,
// "Fans of X also see…" and festival picks. What it computes and why it
// holds no user ids is in lib/bandAffinityJob.js and lib/recommendations.js.
//
// A plain scheduled function, not the scheduled-plus-background pair the
// followed-band job uses: a full recompute is one profiles read plus one
// shows read per account, which takes seconds at today's size, well inside
// the 30 seconds a scheduled function gets. Split it the way
// followed-band-notifications.js is split if the logged `ms` gets near that.
//
// "Run now" on this function in the Netlify UI is the manual trigger. The
// log line is the report: affinity docs written, pairs, and how many
// accounts would see at least one suggestion (withSuggestions/withShows).

const { getDb } = require('./lib/firebaseAdmin');
const { runBandAffinityJob } = require('./lib/bandAffinityJob');

exports.handler = async function () {
  try {
    const report = await runBandAffinityJob({ db: getDb() });
    console.log('[bandAffinity] done', JSON.stringify(report));
    return { statusCode: 200, body: '' };
  } catch (err) {
    console.error('[bandAffinity] failed', err && err.stack ? err.stack : err);
    return { statusCode: 500, body: '' };
  }
};
