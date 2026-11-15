// netlify/functions/lib/setlistOpsHandler.js — the HTTP side of the
// setlist operations (5.60.7): one handler, five functions
// (propose-setlist, accept-proposal, reject-proposal, resync-show,
// scan-missing-setlists), so every one checks the caller and counts the
// same way. The operations themselves are lib/setlistOps.js.
//
//   POST, Authorization: Bearer {idToken}, the caller's own shows only.
//   propose-setlist        { showId }                      -> propose's answer
//   accept-proposal        { showId, result?, onlyIfEmpty? } -> apply's answer (+ fields written)
//   reject-proposal        { showId }                      -> { ok, fields }
//   resync-show            { showId }                      -> apply's answer
//   scan-missing-setlists  { showIds?, dryRun? }           -> { scanned, found, results, remaining }
//
// Signed in; SETLIST_OPS_DAILY_LIMIT operations per user per UTC day; the
// three that can ask setlist.fm or a band source also count against the
// per-IP setlist.fm limit (lib/proxyLimit.js).

const { withCors } = require('./cors');
const { withProxyLimit, internalProxyHeader } = require('./proxyLimit');
const { getDb } = require('./firebaseAdmin');
const { requireUser } = require('./requestAuth');
const { takeDailyQuota } = require('./rateLimit');
const ops = require('./setlistOps');

const SETLIST_OPS_DAILY_LIMIT = 2000;
const SCAN_BUDGET_MS = 8000; // inside a synchronous function's time limit
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(body) });

// Called in-process: the same code and cache the app reaches over HTTP,
// exempt from the per-IP limit. The requires are literal on purpose: the
// function bundler only includes files it can see required by name.
async function inProcessJson(fn, params) {
  const res = await fn().handler({ httpMethod: 'GET', headers: { ...internalProxyHeader() }, queryStringParameters: params });
  if (!res || res.statusCode !== 200) return null;
  try { return JSON.parse(res.body); } catch { return null; }
}

/** The network reads, in-process: band-setlist.js and search-setlists.js, cache and all. */
function serverSetlistDeps() {
  return {
    bandSetlist: (params) => inProcessJson(() => require('../band-setlist'), params),
    searchSetlists: (params) => inProcessJson(() => require('../search-setlists'), params),
  };
}

let testDeps = null;
function __setTestDeps(deps) { testDeps = deps; }
/** serverSetlistDeps, or what a test put in its place (the admin tools use this too). */
const setlistDeps = () => (testDeps ? { ...serverSetlistDeps(), ...testDeps } : serverSetlistDeps());

const FETCHES = new Set(['propose-setlist', 'resync-show', 'scan-missing-setlists']);

function setlistOpHandler(op) {
  const handler = async function (event) {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
    if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });
    const user = await requireUser(event, HEADERS);
    if (user.response) return user.response;

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body.' }); }
    if (op !== 'scan-missing-setlists' && !body.showId) return reply(400, { error: 'showId is required.' });
    if (body.showIds && (!Array.isArray(body.showIds) || body.showIds.length > 500)) return reply(400, { error: 'showIds must be a list of at most 500.' });

    try {
      const db = getDb();
      const quota = await takeDailyQuota(db, `setlistops_${user.uid}`, SETLIST_OPS_DAILY_LIMIT, { uid: user.uid });
      if (!quota.allowed) return reply(429, { error: 'That’s a lot of setlist changes for one day. Try again tomorrow.' }, { 'Retry-After': '3600' });
      const deps = setlistDeps();
      let out;
      switch (op) {
        case 'propose-setlist': out = await ops.proposeSetlist(db, user.uid, body.showId, deps); break;
        case 'accept-proposal': out = await ops.acceptProposal(db, user.uid, body.showId, { result: body.result || null, onlyIfEmpty: body.onlyIfEmpty === true }); break;
        case 'reject-proposal': out = await ops.rejectProposal(db, user.uid, body.showId); break;
        case 'resync-show': out = await ops.resyncShow(db, user.uid, body.showId, deps); break;
        case 'scan-missing-setlists':
          out = await ops.scanMissingSetlists(db, user.uid, deps, { showIds: body.showIds || null, budgetMs: SCAN_BUDGET_MS, write: body.dryRun !== true });
          break;
        default: return reply(404, { error: 'unknown_operation' });
      }
      return reply(200, out);
    } catch (err) {
      console.error(`${op} failed:`, err && err.message);
      return reply(500, { error: 'server_error' });
    }
  };
  return withCors(FETCHES.has(op) ? withProxyLimit('setlists', handler) : handler);
}

module.exports = { setlistOpHandler, serverSetlistDeps, setlistDeps, __setTestDeps, SETLIST_OPS_DAILY_LIMIT };
