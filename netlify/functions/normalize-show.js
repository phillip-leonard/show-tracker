// netlify/functions/normalize-show.js — every new show, built on the
// server (5.60.5, pre-native server moves Part 1a).
//
//   POST /.netlify/functions/normalize-show     Auth: Bearer {idToken}
//   { mode: 'preview' | 'commit', input: { kind, … } }
//   { mode, inputs: [ { kind, … }, … ] }          up to 25, in order
//     -> { ok, …result }  or  { ok, results: [ result | { error }, … ] }
//
// result: { show, duplicate, band, festivalMatches } and, on commit, what
// was written. festivalMatches (5.60.8) are catalog festivals the show may
// belong to, a suggestion only (lib/festivalMatch.js festivalsForShow)
// (lib/normalizeShowServer.js commitShow). The input kinds and the
// document are lib/normalizeShow.js and lib/showInputs.js; the golden
// fixtures in fixtures/shows/ are the contract the Swift app tests
// against.
//
// preview writes nothing: an add flow shows the user what will be saved.
// commit writes it (or normalizes a document the app wrote offline with
// needsNormalization, under the same id). An input may carry `showId` (a
// minted id, lib/showDoc.js) so the device and the server agree on the
// document, and `confirmPossible: true` once the user has said a
// "possible duplicate" is a different show.
//
// Signed-in only; NORMALIZE_DAILY_LIMIT inputs per user per UTC day (a
// big spreadsheet import fits), and the per-IP setlist.fm limit
// (lib/proxyLimit.js), since an input can make this ask setlist.fm and the
// band sources.
//
// The welcome email (Stage 4, 5.60.32): a commit that writes an account's
// first show sends it (lib/welcomeEmail.js welcomeEmailAfterAdd), so the
// native app's users get it too. Only when the account had no shows before
// the request, so every later add skips it without a read. The answer
// carries `welcomeEmail` with the outcome when it ran.

const { withCors } = require('./lib/cors');
const { withProxyLimit } = require('./lib/proxyLimit');
const { getDb, getAdminAuth } = require('./lib/firebaseAdmin');
const { requireUser } = require('./lib/requestAuth');
const { takeDailyQuota } = require('./lib/rateLimit');
const { depsFor, userShows, normalizeOne } = require('./lib/normalizeShowServer');
const { welcomeEmailAfterAdd } = require('./lib/welcomeEmail');
const { openBlobStore, loadIndex } = require('./lib/publicArtistSnapshot');

// Replaced in the tests (__setTestWelcomeEmail).
const defaultSendWelcome = ({ db, uid, showId, event }) => welcomeEmailAfterAdd({
  db, auth: getAdminAuth(), uid, showId, readBandIndex: () => loadIndex(openBlobStore(event)),
});
let sendWelcome = defaultSendWelcome;

const NORMALIZE_DAILY_LIMIT = 3000;
const MAX_INPUTS = 25;
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
// The input kinds a guest can't send: both come from a friend.
const GUEST_REFUSED_KINDS = new Set(['tag', 'email-tag']);
const reply = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(body) });

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const user = await requireUser(event, HEADERS);
  if (user.response) return user.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body.' }); }
  const mode = body.mode === 'commit' ? 'commit' : body.mode === 'preview' ? 'preview' : null;
  if (!mode) return reply(400, { error: "mode must be 'preview' or 'commit'." });
  const batch = Array.isArray(body.inputs);
  const inputs = batch ? body.inputs : (body.input ? [body.input] : []);
  if (!inputs.length) return reply(400, { error: 'An input is required.' });
  if (inputs.length > MAX_INPUTS) return reply(400, { error: `At most ${MAX_INPUTS} inputs per request.` });
  // A guest logs their own shows here; accepting a friend's tag needs an
  // account (5.60.13, docs/ios-native/DECISIONS.md).
  if (user.isAnonymous && inputs.some((i) => i && GUEST_REFUSED_KINDS.has(i.kind))) {
    return reply(403, { error: 'Create an account to accept tags.', code: 'account_required' });
  }

  try {
    const db = getDb();
    const quota = await takeDailyQuota(db, `normalize_${user.uid}`, NORMALIZE_DAILY_LIMIT, { uid: user.uid, cost: inputs.length });
    if (!quota.allowed) return reply(429, { error: 'That’s a lot of shows for one day. Try again tomorrow.' }, { 'Retry-After': '3600' });

    const { FieldValue } = require('firebase-admin/firestore');
    const deps = depsFor(db, user);
    const existingShows = await userShows(db, user.uid);
    const hadNoShows = existingShows.length === 0;
    const results = [];
    for (const input of inputs) {
      results.push(await normalizeOne(db, user, input, { mode, existingShows, deps, FieldValue }));
    }
    // An account's first show: the welcome email (a guest's waits for
    // account-linked, after they link).
    let welcome = null;
    const firstCreated = results.find((r) => r && r.written && r.created);
    if (mode === 'commit' && hadNoShows && !user.isAnonymous && firstCreated) {
      welcome = await sendWelcome({ db, uid: user.uid, showId: firstCreated.showId, event });
    }
    const extra = welcome ? { welcomeEmail: welcome.status } : {};
    if (batch) return reply(200, { ok: true, results, ...extra });
    const [only] = results;
    return only.error ? reply(400, { ok: false, ...only }) : reply(200, { ok: true, ...only, ...extra });
  } catch (err) {
    console.error('normalize-show failed:', err && err.message);
    return reply(500, { error: 'server_error' });
  }
};

module.exports.__setTestWelcomeEmail = (fn) => { sendWelcome = fn || defaultSendWelcome; };

// Per-IP setlist.fm limit inside the CORS allowlist (lib/cors.js), so a
// 429 still carries CORS headers.
module.exports.handler = withCors(withProxyLimit('setlists', module.exports.handler));
