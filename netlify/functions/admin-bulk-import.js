/**
 * admin-bulk-import — Admin-only endpoint that bulk-imports shows into a target user's profile.
 *
 * POST body:   { targetUid: string, shows: Array<{ artist, venue, date, city?, country?, rating?, comment?, tour? }> }
 * Auth header: Authorization: Bearer {idToken}   (admin account only)
 *
 * Steps:
 *   1. Verify admin identity via Firebase ID token
 *   2. Validate target user exists in userProfiles/{targetUid}
 *   3. Fetch existing shows from users/{targetUid}/shows for duplicate detection
 *   4. Batch-write new (non-duplicate) shows to users/{targetUid}/shows/{showId}
 *   5. Recompute userStats/{targetUid} (lib/userStats.js)
 *   6. Write audit log to adminAuditLog
 *
 * Response:    { success, imported, duplicatesSkipped, targetUid }
 */

const { withCors } = require('./lib/cors');
// The one admin check: custom claim or verified allowlisted address (5.59.12).
const { isAdmin } = require('./lib/firebaseAdmin');
const { recomputeUserStats } = require('./lib/userStats');
// The show document every add path builds (5.60.5).
const { canonicalShowData, showDataFromFields } = require('../../lib/showInputs');
const { buildShowDoc, mintShowId } = require('../../lib/showDoc');
const { classifyDuplicate } = require('../../lib/showIdentity');
const { SETLISTFM_SOURCE_ID } = require('../../lib/setlistSources');
const { SHOW_SCHEMA_VERSION } = require('../../lib/normalizeShow');
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
  initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
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

  const { targetUid, shows } = body;
  if (!targetUid) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'targetUid is required' }) };
  }
  if (!Array.isArray(shows) || shows.length === 0) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'shows array is required and must be non-empty' }) };
  }
  if (shows.length > 500) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Maximum 500 shows per request. Split into multiple imports.' }) };
  }

  try {
    const { getFirestore, FieldValue } = require('firebase-admin/firestore');
    const db = getFirestore();

    // ── Step 1: Validate target user exists ───────────────────────────────────
    const profileDoc = await db.doc(`userProfiles/${targetUid}`).get();
    if (!profileDoc.exists) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Target user not found' }) };
    }
    const targetProfile = profileDoc.data();
    // From Auth: profiles stopped carrying `email` in 5.59.7 (S-01).
    const targetEmail = targetProfile.email
      || (await require('firebase-admin/auth').getAuth().getUser(targetUid).then((u) => u.email || '').catch(() => ''));
    const targetDisplayName = targetProfile.displayName || targetProfile.firstName || '';

    // ── Step 2: Fetch existing shows for duplicate detection ──────────────────
    const existingSnap = await db.collection(`users/${targetUid}/shows`).get();
    const known = existingSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // ── Step 3: Build each show as every other add path does (5.60.5) ─────────
    // The canonical shape (lib/showInputs.js) and lib/showDoc.js, with a
    // minted id, so an admin import is the same document normalize-show
    // writes: the date as ISO, isManual by the rule, setlistSource stamped.
    // No band-source lookup here (an import of hundreds of rows must finish
    // inside the function's time limit); the setlist scan fills setlists
    // later. Duplicates by the one rule (lib/showIdentity.js): a certain
    // match is skipped, a possible one is imported, as before.
    const toImport = [];
    let duplicatesSkipped = 0;

    for (const show of shows) {
      if (!show.artist || !show.venue || !show.date) {
        continue; // Skip invalid rows (should have been filtered client-side)
      }
      const data = canonicalShowData({ ...showDataFromFields(show), setlist: [], setlistSource: SETLISTFM_SOURCE_ID });
      const doc = { ...buildShowDoc(data, mintShowId()), normalizedVersion: SHOW_SCHEMA_VERSION };
      const dup = classifyDuplicate(known, doc);
      if (dup && dup.rule !== 'possible') {
        duplicatesSkipped++;
        continue;
      }
      known.push(doc); // Prevent duplicates within the same import batch
      toImport.push(doc);
    }

    // ── Step 4: Batch-write new shows ─────────────────────────────────────────
    const CHUNK = 500;

    for (let i = 0; i < toImport.length; i += CHUNK) {
      const batch = db.batch();
      toImport.slice(i, i + CHUNK).forEach((doc) => {
        const { id: showId, ...fields } = doc;
        batch.set(db.doc(`users/${targetUid}/shows/${showId}`), {
          ...fields,
          createdAt: FieldValue.serverTimestamp(),
          // A flag, not who: show documents are readable by the owner's
          // friends, so no email address may go on one (5.60.3). Who ran
          // the import is in adminAuditLog (performedByUid, below).
          importedByAdmin: true,
        });
      });
      await batch.commit();
    }

    // ── Step 5: Recompute the user's server stats (5.59.15) ─────────────────
    // userStats/{uid} from their shows (lib/userStats.js), rather than
    // bumping the profile's client-written showCount, which nothing reads
    // any more. Best-effort: the scheduled rebuild catches a failure.
    if (toImport.length > 0) {
      await recomputeUserStats(db, targetUid, { serverTimestamp: () => FieldValue.serverTimestamp() })
        .catch((err) => console.warn('[admin-bulk-import] stats recompute failed; the scheduled run will catch up:', err.message));
    }

    // ── Step 6: Write audit log ───────────────────────────────────────────────
    await db.collection('adminAuditLog').add({
      action: 'bulk_import',
      targetUid,
      targetEmail,
      targetDisplayName,
      showCount: toImport.length,
      duplicatesSkipped,
      totalSubmitted: shows.length,
      performedByUid: adminDecoded.uid,
      performedByEmail: adminDecoded.email,
      performedAt: FieldValue.serverTimestamp(),
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        imported: toImport.length,
        duplicatesSkipped,
        targetUid,
      }),
    };
  } catch (e) {
    console.error('admin-bulk-import error:', e);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
