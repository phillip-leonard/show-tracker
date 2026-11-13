/**
 * delete-account — self-service account deletion (App Store Guideline 5.1.1(v)).
 *
 * Apple requires an app that lets you create an account to let you delete it,
 * along with its data. "Its data" is the part that is easy to get wrong: this
 * function used to carry its own list of collections, which fell behind the
 * schema and left comments, photos, videos, meetup posts, activity items, the
 * user's handle, ratings, wishlists, every Storage object and the
 * users/{uid}/festivals subcollection alive in production.
 *
 * The list now lives in netlify/functions/lib/userDataPurge.js, shared with
 * delete-user.js, and tests/deletion/completeness.test.js fails if a
 * collection is added to the app but not to the map.
 *
 * Order matters. The account is disabled and its refresh tokens revoked
 * BEFORE the purge starts, so the moment the user confirms they are locked
 * out — even if the purge is still running, or times out and has to be
 * re-run. Netlify functions have a wall clock; a heavy account can exceed it.
 * purgeUserData is idempotent, so a retry finishes the job rather than
 * starting over.
 *
 * POST body:   { confirmEmail: string }  — must match the account's email
 *           or { confirmText: "DELETE" } — for Hide My Email users, who
 *                                          cannot reasonably type a
 *                                          @privaterelay.appleid.com address
 * Auth header: Authorization: Bearer {idToken}
 */

const { withCors } = require('./lib/cors');
const { purgeUserData } = require('./lib/userDataPurge');

const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'show-tracker-d7a4d.firebasestorage.app';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function initFirebase() {
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  if (getApps().length > 0) return;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) throw new Error('Firebase env vars not configured');
  initializeApp({
    credential: cert({ privateKey, clientEmail, projectId }),
    projectId,
    storageBucket: STORAGE_BUCKET,
  });
}

const json = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return json(401, { error: 'Unauthorized' });

  // initFirebase() used to sit inside the try below, so a missing or malformed
  // FIREBASE_* env var surfaced to the user as 'Invalid token' — an auth error
  // for what is actually a server misconfiguration. Keep them separate.
  try {
    initFirebase();
  } catch (e) {
    console.error('[delete-account] Firebase Admin not configured:', e.message);
    return json(500, { error: 'Account deletion is temporarily unavailable. Please contact support@mysetlists.net.' });
  }

  let decoded;
  try {
    const { getAuth } = require('firebase-admin/auth');
    decoded = await getAuth().verifyIdToken(token);
  } catch (e) {
    return json(401, { error: 'Invalid token' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  // Confirmation. Either form is deliberate friction, not security — the
  // token above is what authorises this.
  const { confirmEmail, confirmText } = body;
  const emailMatches = confirmEmail && confirmEmail.toLowerCase() === (decoded.email || '').toLowerCase();
  const textMatches = typeof confirmText === 'string' && confirmText.trim().toUpperCase() === 'DELETE';
  if (!emailMatches && !textMatches) {
    return json(400, { error: 'Type your email address, or the word DELETE, to confirm.' });
  }

  const uid = decoded.uid;

  try {
    const { getFirestore, FieldValue } = require('firebase-admin/firestore');
    const { getAuth } = require('firebase-admin/auth');
    const { getStorage } = require('firebase-admin/storage');
    const db = getFirestore();
    const auth = getAuth();

    // The immutable record that this happened, written first so it survives
    // any failure in the purge itself.
    await db.collection('adminAuditLog').add({
      action: 'self_delete_account',
      targetUid: uid,
      targetEmail: decoded.email || '',
      performedByUid: uid,
      performedByEmail: decoded.email || '',
      performedAt: FieldValue.serverTimestamp(),
    });

    // Lock the account out NOW. Everything after this point can be retried;
    // this is the part the user is entitled to have happen immediately.
    await auth.updateUser(uid, { disabled: true }).catch(() => {});
    await auth.revokeRefreshTokens(uid).catch(() => {});

    let bucket = null;
    try {
      bucket = getStorage().bucket();
    } catch (e) {
      console.warn('[delete-account] Storage bucket unavailable; files will not be removed:', e.message);
    }

    const report = await purgeUserData({ db, auth, bucket }, uid);

    console.log('[delete-account] purged', JSON.stringify({
      uid, deleted: report.deleted, tombstoned: report.tombstoned, storage: report.storage,
      authUserDeleted: report.authUserDeleted,
    }));

    // A step that failed no longer aborts the purge, so judge the outcome on
    // the thing the user actually asked for: is the account gone? Residual
    // documents are a cleanup job (scripts/purge-user.js, by uid) — they are
    // not a reason to tell someone their deletion failed when their login has
    // in fact been destroyed.
    if (report.errors.length) {
      console.error('[delete-account] completed with errors for uid', uid, JSON.stringify(report.errors));
    }

    if (!report.authUserDeleted) {
      return json(500, {
        error: 'Your account has been disabled and you have been signed out, but removing all of your data did not finish. Please contact support@mysetlists.net and it will be completed.',
        detail: report.errors.join('; '),
      });
    }

    return json(200, { success: true, warnings: report.errors.length });
  } catch (e) {
    console.error('delete-account error:', e);
    // The account is already disabled at this point, so the user is out even
    // though the purge did not finish. Say so rather than implying nothing
    // happened.
    return json(500, {
      error: 'Your account has been disabled and you have been signed out, but removing all of your data did not finish. Please contact support@mysetlists.net and it will be completed.',
      detail: e.message,
    });
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
