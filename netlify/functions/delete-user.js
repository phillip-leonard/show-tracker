/**
 * delete-user — admin-only endpoint that permanently removes a user and all
 * their data.
 *
 * What gets deleted is defined once, in netlify/functions/lib/userDataPurge.js,
 * and shared with delete-account.js (the self-service path). Do not re-add a
 * hand-written list here: the two functions drifting apart is exactly how
 * comments, photos, Storage objects, handles and the users/{uid}/festivals
 * subcollection ended up surviving deletion.
 *
 * POST body:   { targetUid: string }
 * Auth header: Authorization: Bearer {idToken}   (admin account only)
 */

const { withCors } = require('./lib/cors');
const { purgeUserData } = require('./lib/userDataPurge');

// The one admin check: custom claim or verified allowlisted address (5.59.12).
const { isAdmin } = require('./lib/firebaseAdmin');
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

async function verifyAdmin(token) {
  initFirebase();
  const { getAuth } = require('firebase-admin/auth');
  const decoded = await getAuth().verifyIdToken(token);
  if (!isAdmin(decoded)) throw new Error('Forbidden');
  return decoded;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let adminDecoded;
  try {
    adminDecoded = await verifyAdmin(token);
  } catch (e) {
    const status = e.message === 'Forbidden' ? 403 : 401;
    return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { targetUid } = body;
  if (!targetUid) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'targetUid is required' }) };
  }

  // Prevent self-deletion
  if (targetUid === adminDecoded.uid) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Cannot delete your own account' }) };
  }

  try {
    const { getFirestore, FieldValue } = require('firebase-admin/firestore');
    const { getAuth } = require('firebase-admin/auth');
    const db = getFirestore();

    // Fetch target user info for the audit log before deleting anything
    let targetEmail = '';
    let targetDisplayName = '';
    try {
      const targetAuthUser = await getAuth().getUser(targetUid);
      targetEmail = targetAuthUser.email || '';
      targetDisplayName = targetAuthUser.displayName || '';
    } catch (_) {
      // User may not exist in Auth — still proceed with Firestore cleanup
    }

    // ── Step 1: Write audit log FIRST ────────────────────────────────────────
    await db.collection('adminAuditLog').add({
      action: 'delete_user',
      targetUid,
      targetEmail,
      targetDisplayName,
      performedByUid: adminDecoded.uid,
      performedByEmail: adminDecoded.email,
      performedAt: FieldValue.serverTimestamp(),
    });

    // ── Step 2: Purge everything the user owns ───────────────────────────────
    // Collections, array memberships, tombstones, Storage objects and the
    // Auth record — see lib/userDataPurge.js for the map.
    let bucket = null;
    try {
      const { getStorage } = require('firebase-admin/storage');
      bucket = getStorage().bucket();
    } catch (e) {
      console.warn('[delete-user] Storage bucket unavailable; files will not be removed:', e.message);
    }

    const report = await purgeUserData({ db, auth: getAuth(), bucket }, targetUid);
    console.log('[delete-user] purged', JSON.stringify({
      targetUid, deleted: report.deleted, tombstoned: report.tombstoned, storage: report.storage,
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, deletedUid: targetUid, report }),
    };
  } catch (e) {
    console.error('delete-user error:', e);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
