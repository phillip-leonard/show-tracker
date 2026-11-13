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
 *   5. Increment userProfiles/{targetUid}.showCount
 *   6. Write audit log to adminAuditLog
 *
 * Response:    { success, imported, duplicatesSkipped, targetUid }
 */

const { withCors } = require('./lib/cors');
const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];
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
  if (!ADMIN_EMAILS.includes(decoded.email)) throw new Error('Forbidden');
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
    const existingKeys = new Set();
    existingSnap.docs.forEach(d => {
      const s = d.data();
      const key = `${(s.artist || '').trim().toLowerCase()}|${(s.venue || '').trim().toLowerCase()}|${s.date || ''}`;
      existingKeys.add(key);
    });

    // ── Step 3: Filter duplicates and validate shows ──────────────────────────
    const toImport = [];
    let duplicatesSkipped = 0;

    for (const show of shows) {
      if (!show.artist || !show.venue || !show.date) {
        continue; // Skip invalid rows (should have been filtered client-side)
      }
      const key = `${show.artist.trim().toLowerCase()}|${show.venue.trim().toLowerCase()}|${show.date}`;
      if (existingKeys.has(key)) {
        duplicatesSkipped++;
        continue;
      }
      existingKeys.add(key); // Prevent duplicates within the same import batch
      toImport.push(show);
    }

    // ── Step 4: Batch-write new shows ─────────────────────────────────────────
    const CHUNK = 500;
    const baseTimestamp = Date.now();

    for (let i = 0; i < toImport.length; i += CHUNK) {
      const batch = db.batch();
      const chunk = toImport.slice(i, i + CHUNK);

      chunk.forEach((show, idx) => {
        const showId = (baseTimestamp + i + idx).toString();
        const ref = db.doc(`users/${targetUid}/shows/${showId}`);
        batch.set(ref, {
          artist: show.artist.trim(),
          venue: show.venue.trim(),
          date: show.date,
          city: (show.city || '').trim(),
          country: (show.country || '').trim(),
          rating: show.rating || null,
          comment: (show.comment || '').trim(),
          tour: (show.tour || '').trim(),
          setlist: [],
          createdAt: FieldValue.serverTimestamp(),
          isManual: true,
          importedByAdmin: adminDecoded.email,
        });
      });

      await batch.commit();
    }

    // ── Step 5: Update user profile showCount ─────────────────────────────────
    if (toImport.length > 0) {
      await db.doc(`userProfiles/${targetUid}`).update({
        showCount: FieldValue.increment(toImport.length),
      });
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
