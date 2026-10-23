/**
 * admin-resync-setlists-background — the same walk as
 * admin-resync-setlists.js, run as a Netlify background function: 15
 * minutes instead of 10 seconds, so a whole backfill (378 Grateful Dead
 * shows at one Archive request a second) runs in one invocation instead
 * of dozens of cursor hops.
 *
 * Same POST body, same admin check, same dry-run default. A background
 * function's caller gets a 202 and nothing else, so the report is saved to
 * Firestore at adminResyncRuns/{runId} (runId is in the body, or a
 * timestamp) and summarised in the function log.
 */

const resync = require('./admin-resync-setlists');

const MAX_BUDGET_MS = 14 * 60 * 1000;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: resync.CORS_HEADERS, body: '' };

  const denied = await resync.authorizeAdmin(event);
  if (denied) {
    console.warn(`[RESYNC bg] refused: ${denied.statusCode}`);
    return denied;
  }

  const body = JSON.parse(event.body || '{}');
  const runId = /^[A-Za-z0-9._-]{1,80}$/.test(String(body.runId || ''))
    ? String(body.runId)
    : new Date().toISOString().replace(/[:.]/g, '-');
  const { report, error } = await resync.runResync(body, { defaultBudgetMs: MAX_BUDGET_MS });

  const { getFirestore } = require('firebase-admin/firestore');
  await getFirestore().collection('adminResyncRuns').doc(runId).set({
    finishedAt: new Date().toISOString(),
    // Echoed back so the admin page can tell the report it asked for from
    // an older one saved under the same runId.
    requestId: typeof body.requestId === 'string' ? body.requestId.slice(0, 80) : null,
    error: error || null,
    // Firestore refuses `undefined`, which the report's rows use for
    // absent fields.
    report: JSON.parse(JSON.stringify(report)),
  });

  console.log(`[RESYNC bg] ${runId}: ${error ? `error: ${error}` : `${report.considered} considered, ${report.wouldChange} would change, ${report.proposals} proposals, ${report.needsReview} need review, ${report.sourceReturnedNothing.length} nothing found, truncated=${report.truncated}`}`);
  return { statusCode: 202, headers: resync.CORS_HEADERS, body: '' };
};
