/**
 * account-linked — what a new sign-up gets, for a guest who just linked a
 * credential (5.60.13, native app Part 2).
 *
 *   POST /.netlify/functions/account-linked   Auth: Bearer {idToken}
 *   { ref? }                                   a referral the app kept from
 *                                              a /?ref= link (optional)
 *   → { ok, invites, referral, welcomeEmail, stats, profile }
 *
 * WHY. The native app signs guests in with Firebase anonymous auth. Linking
 * Apple, Google or email keeps the same uid, so the shows stay, but it
 * isn't a sign-in: Firebase's auth-state listener doesn't fire, so nothing
 * the web runs on a first sign-in (context/AppContext.jsx's auth effect)
 * happens. The app calls this once, right after link() succeeds and with a
 * refreshed token, and the server does those steps:
 *
 *   invites       friends.js claimInvites: an invite sent to the address
 *                 the account now has. The app sends send-email's
 *                 { type: 'friend_joined' } when `newFriend` is true, as the
 *                 web does.
 *   referral      friends.js referral, when the app passes `ref`
 *   welcomeEmail  lib/welcomeEmail.js processWelcomeEmail, held while the
 *                 account was a guest ('held_anonymous'), sent now if due
 *   stats         lib/userStats.js recomputeUserStats: the account becomes
 *                 ranked
 *   profile       convertedFromGuest / guestConvertedAt, once (the native
 *                 replacement for the web's guestSessions marker)
 *
 * Each step runs whatever the others do; one failing reports 'error' for
 * that step and the rest still happen. Every step is idempotent, so the app
 * can call this again after a failure. The display name is not set here:
 * it comes from the device (Apple or Google's name) and goes through
 * moderate-content's profileName like any other name.
 *
 * A guest's own token is refused (403 account_required): link first.
 */

const { withCors } = require('./lib/cors');
const { getDb, getAdminAuth, ADMIN_EMAILS } = require('./lib/firebaseAdmin');
const { requireAccount } = require('./lib/requestAuth');
const { takeDailyQuota } = require('./lib/rateLimit');
const { processWelcomeEmail } = require('./lib/welcomeEmail');
const { openBlobStore, loadIndex } = require('./lib/publicArtistSnapshot');
const { recomputeUserStats } = require('./lib/userStats');
const { normalizeEmail } = require('./lib/unsubscribeToken');
const { ACTIONS: FRIEND_ACTIONS } = require('./friends');

const DAILY_LIMIT = 20;
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(body) });

function replyToAddress() {
  return process.env.ANNOUNCEMENT_REPLY_TO || ADMIN_EMAILS[0];
}

let bandIndexReader = (event) => () => loadIndex(openBlobStore(event));

async function step(name, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[account-linked] ${name} failed:`, e && e.message);
    return { status: 'error' };
  }
}

/**
 * runAccountLinked({ db, auth, uid, email, ref, replyTo, readBandIndex, now })
 * → the per-step results. Separate from the handler for the tests.
 */
async function runAccountLinked({ db, auth, uid, email, ref = null, replyTo = null, readBandIndex = null, now = new Date(), serverTimestamp = () => now }) {
  const invites = await step('invites', () => FRIEND_ACTIONS.claimInvites({ db, auth, uid, email, body: {} }));
  const referral = typeof ref === 'string' && ref
    ? await step('referral', () => FRIEND_ACTIONS.referral({ db, auth, uid, email, body: { ref } }))
    : { result: 'none' };
  const welcome = await step('welcomeEmail', () => processWelcomeEmail({ db, auth, uid, now, replyTo, readBandIndex }));
  const stats = await step('stats', async () => {
    const doc = await recomputeUserStats(db, uid, { serverTimestamp, anonymous: false });
    return { status: 'ok', ranked: doc.ranked === true, rank: doc.rank, rankedOf: doc.rankedOf };
  });
  const profile = await step('profile', async () => {
    const ref_ = db.doc(`userProfiles/${uid}`);
    const snap = await ref_.get();
    if (snap.exists && snap.data().convertedFromGuest === true) return { status: 'already' };
    await ref_.set({ convertedFromGuest: true, guestConvertedAt: serverTimestamp() }, { merge: true });
    return { status: 'stamped' };
  });
  return { invites, referral, welcomeEmail: welcome, stats, profile };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });

  // A real account: the guest's own token is refused, so this only ever
  // runs after the link.
  const user = await requireAccount(event, HEADERS);
  if (user.response) return user.response;

  let body = {};
  try { body = JSON.parse(event.body || '{}') || {}; } catch { return reply(400, { error: 'Invalid JSON body.' }); }

  try {
    const db = getDb();
    const quota = await takeDailyQuota(db, `account_linked_${user.uid}`, DAILY_LIMIT, { uid: user.uid });
    if (!quota.allowed) return reply(429, { error: 'Try again tomorrow.' }, { 'Retry-After': '3600' });

    const { FieldValue } = require('firebase-admin/firestore');
    const result = await runAccountLinked({
      db,
      auth: getAdminAuth(),
      uid: user.uid,
      email: normalizeEmail(user.email || ''),
      ref: typeof body.ref === 'string' ? body.ref.slice(0, 2000) : null,
      replyTo: replyToAddress(),
      readBandIndex: bandIndexReader(event),
      serverTimestamp: () => FieldValue.serverTimestamp(),
    });
    return reply(200, { ok: true, ...result });
  } catch (e) {
    console.error('[account-linked] failed:', e && e.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};

exports.handler = withCors(exports.handler);
exports.runAccountLinked = runAccountLinked;
exports.__setTestBandIndexReader = (fn) => { bandIndexReader = fn || ((event) => () => loadIndex(openBlobStore(event))); };
