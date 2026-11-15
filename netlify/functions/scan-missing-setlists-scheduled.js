// netlify/functions/scan-missing-setlists-scheduled.js
//
// Scheduled function (netlify.toml, every 6 hours, 5.60.7): finds setlists
// for shows that have none, across every account, the longest unchecked
// first (lib/setlistOps.js scheduledScan): the band source where the band
// has one, else setlist.fm, through the same merge and ratings guard as
// every other setlist write. A show checked is not asked about again for
// 30 days. Leaves the App Review accounts alone. Logs counts only.

const { getDb } = require('./lib/firebaseAdmin');
const { scheduledScan } = require('./lib/setlistOps');
const { setlistDeps } = require('./lib/setlistOpsHandler');

exports.handler = async function () {
  try {
    const run = await scheduledScan(getDb(), setlistDeps(), { budgetMs: 20000 });
    console.log(`[scan-missing-setlists] ${JSON.stringify(run)}`);
    return { statusCode: 200, body: JSON.stringify(run) };
  } catch (error) {
    console.error('[scan-missing-setlists] failed:', error && error.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'scan failed' }) };
  }
};
