/**
 * notify-block — tells the developer that one user blocked another.
 *
 * App Store Guideline 1.2 asks that blocking "notify the developer", not
 * only that it hide content. Blocking was silent: it wrote the blocker's
 * own `userBlocks` document and nothing else, so nobody at MySetlists
 * ever learned that someone had found another user bad enough to shut
 * out. A block is the strongest signal a user can send without filing a
 * report, and several blocks against one account is a pattern no single
 * report shows.
 *
 * WHAT IT WRITES. A `reports` document with `reason: 'blocked'`, so it
 * lands in the same admin queue, on the same 24-hour clock, as every
 * other thing needing a human. A separate `blocks` collection would have
 * needed its own query, its own sort, its own SLA badge and its own
 * corner of the admin screen to be looked at — and a moderation signal
 * nobody looks at is not a signal.
 *
 * WHAT MAKES IT DIFFERENT FROM A REPORT. It has no `contentPath`: a block
 * is about a person, not a document. The queue and moderate-report.js
 * both branch on that, and neither offers "delete content" for one.
 * Instead it carries a snapshot of that account's recent posts, gathered
 * here, so an admin can judge the account without hunting for it.
 *
 * WHAT IT NEVER DOES. It never tells the blocked user. It never fails the
 * block: the user's own `userBlocks` write has already happened on the
 * client by the time this is called, and an account that could not be
 * blocked because an email bounced would be a far worse outcome than a
 * notification nobody received.
 *
 * Since 5.60.27 the block itself, and its side effects, are written by the
 * server: friends.js action `block` (Stage 2, C-7), which records this same
 * notice through lib/blockNotice.js. This endpoint stays for app builds
 * that write their own userBlocks document and then call it (iOS 3.13.42
 * and earlier); it can go once minSupportedIosVersion passes them
 * (docs/ios-native/GATED-CLEANUPS.md).
 *
 * POST body: { blockedUserId }
 * Auth header: Authorization: Bearer {idToken}   (any signed-in user)
 */

const { isAnonymous } = require('./lib/firebaseAdmin');
const { withCors } = require('./lib/cors');
const { recordBlockNotice } = require('./lib/blockNotice');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function initFirebase() {
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  if (getApps().length > 0) return;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) throw new Error('Firebase env vars not configured');
  initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return json(401, { error: 'Unauthorized' });

  let blockerUid;
  let guest = false;
  let db;
  try {
    initFirebase();
    const { getAuth } = require('firebase-admin/auth');
    const decoded = await getAuth().verifyIdToken(token);
    blockerUid = decoded.uid;
    guest = isAnonymous(decoded);
    const { getFirestore } = require('firebase-admin/firestore');
    db = getFirestore();
  } catch (e) {
    console.error('[notify-block] Auth failed:', e.message);
    return json(401, { error: 'Your session has expired.' });
  }
  if (guest) return json(403, { error: 'Create an account to block someone.', code: 'account_required' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Body must be JSON' });
  }

  const blockedUserId = String(body.blockedUserId || '').trim();
  if (!blockedUserId) return json(400, { error: 'blockedUserId is required' });
  if (blockedUserId === blockerUid) return json(400, { error: 'You cannot block yourself.' });

  try {
    const { FieldValue } = require('firebase-admin/firestore');
    const result = await recordBlockNotice(db, { blockerUid, blockedUserId, timestamp: () => FieldValue.serverTimestamp() });
    return json(200, result);
  } catch (e) {
    console.error('[notify-block] Failed:', e.message, e);
    return json(500, { error: 'Could not record that block.' });
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
