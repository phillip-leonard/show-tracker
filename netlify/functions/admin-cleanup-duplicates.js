/**
 * admin-cleanup-duplicates — Admin-only endpoint that scans for and merges duplicate shows.
 *
 * POST body:   { dryRun?: boolean }  (default dryRun=true — set to false to actually delete)
 * Auth header: Authorization: Bearer {idToken}   (admin account only)
 *
 * Duplicates are identified by: same user + same artist (case-insensitive) + same venue (case-insensitive) + same date.
 * When merging, the earliest-created show is kept and metadata from duplicates is merged in.
 *
 * Response:    { success, dryRun, usersScanned, duplicatesFound, duplicatesMerged, details[] }
 */

const { withCors } = require('./lib/cors');
// The one admin check: custom claim or verified allowlisted address (5.59.12).
const { isAdmin } = require('./lib/firebaseAdmin');
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

  try {
    await verifyAdmin(token);
  } catch {
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const { getFirestore } = require('firebase-admin/firestore');
  const db = getFirestore();

  const body = JSON.parse(event.body || '{}');
  const dryRun = body.dryRun !== false; // default to dry run

  try {
    // Get all user profiles
    const usersSnap = await db.collection('userProfiles').get();
    let usersScanned = 0;
    let duplicatesFound = 0;
    let duplicatesMerged = 0;
    const details = [];

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      usersScanned++;

      // Get all shows for this user
      const showsSnap = await db.collection('users').doc(uid).collection('shows').get();
      if (showsSnap.empty) continue;

      // Group by normalized key: artist|venue|date
      const groups = {};
      showsSnap.docs.forEach(showDoc => {
        const data = showDoc.data();
        const key = [
          (data.artist || '').toLowerCase().trim(),
          (data.venue || '').toLowerCase().trim(),
          data.date || '',
        ].join('|');
        if (!groups[key]) groups[key] = [];
        groups[key].push({ id: showDoc.id, ...data });
      });

      // Find groups with more than one show (duplicates)
      for (const [key, groupShows] of Object.entries(groups)) {
        if (groupShows.length <= 1) continue;

        duplicatesFound += groupShows.length - 1;

        // Sort by createdAt — keep the earliest
        groupShows.sort((a, b) => {
          const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
          const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
          return aTime - bTime;
        });

        const keeper = groupShows[0];
        const dupes = groupShows.slice(1);

        // Merge metadata from duplicates into keeper
        const mergedFields = {};
        for (const dupe of dupes) {
          // Preserve any tag data, comments, ratings from dupes
          if (dupe.taggedBy && !keeper.taggedBy) {
            mergedFields.taggedBy = dupe.taggedBy;
            mergedFields.taggedByUid = dupe.taggedByUid;
          }
          if (dupe.rating && !keeper.rating) {
            mergedFields.rating = dupe.rating;
          }
          if (dupe.comment && !keeper.comment) {
            mergedFields.comment = dupe.comment;
          }
          // If dupe has a setlist and keeper doesn't, use dupe's
          if (dupe.setlist?.length > 0 && (!keeper.setlist || keeper.setlist.length === 0)) {
            mergedFields.setlist = dupe.setlist;
          }
          if (dupe.setlistfmId && !keeper.setlistfmId) {
            mergedFields.setlistfmId = dupe.setlistfmId;
          }
        }

        details.push({
          uid,
          artist: keeper.artist,
          venue: keeper.venue,
          date: keeper.date,
          keptShowId: keeper.id,
          removedShowIds: dupes.map(d => d.id),
          mergedFields: Object.keys(mergedFields),
        });

        if (!dryRun) {
          const batch = db.batch();

          // Update keeper with merged data
          if (Object.keys(mergedFields).length > 0) {
            batch.update(
              db.collection('users').doc(uid).collection('shows').doc(keeper.id),
              mergedFields
            );
          }

          // Delete duplicates
          for (const dupe of dupes) {
            batch.delete(
              db.collection('users').doc(uid).collection('shows').doc(dupe.id)
            );
            duplicatesMerged++;
          }

          await batch.commit();
        } else {
          duplicatesMerged += dupes.length;
        }
      }
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        dryRun,
        usersScanned,
        duplicatesFound,
        duplicatesMerged,
        details,
      }),
    };
  } catch (error) {
    console.error('Cleanup error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
