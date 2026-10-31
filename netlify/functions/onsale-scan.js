// netlify/functions/onsale-scan.js
//
// Scheduled every 6 hours (netlify.toml). Starts the on-sale scan in
// onsale-scan-background.js, which does the work: a scheduled function gets
// 30 seconds. "Run now" here in the Netlify UI, or "Run scan now" in Admin →
// On-sale alerts, is the manual trigger.

const { getDb } = require('./lib/firebaseAdmin');
const { startBackgroundJob } = require('./lib/jobTrigger');

exports.handler = async function () {
  const status = await startBackgroundJob(getDb(), 'onsale-scan', 'onsale-scan-background');
  console.log(`[onsale] background run requested: HTTP ${status}`);
  return { statusCode: 200, body: '' };
};
