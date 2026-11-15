/**
 * admin-populate-setlist — Admin-only endpoint that populates a single show's
 * setlist from either another user's data or a fresh setlist.fm fetch.
 *
 * POST body:
 *   {
 *     userId: string,           // target user
 *     showId: string,           // target show document ID
 *     source: 'cross_reference' | 'setlist_fm',
 *     donorUserId?: string,     // if source=cross_reference, who has the setlist
 *     donorShowId?: string,     // if source=cross_reference, which show to copy from
 *     artist?: string,          // if source=setlist_fm, artist name for search
 *     date?: string,            // if source=setlist_fm, show date (YYYY-MM-DD)
 *     setlistData?: object,     // pre-fetched setlist data to populate directly
 *   }
 *
 * Auth: Authorization: Bearer {idToken} — admin only
 */

const { withCors } = require('./lib/cors');
const { missingSetlistfmKey } = require('./lib/setlistfmKey');
const { findSetlistfmMatch } = require('./lib/setlistOps');
const { setlistDeps } = require('./lib/setlistOpsHandler');
const { extractSongsFromSetlist } = require('../../lib/setlistParser');

// The one admin check: custom claim or verified allowlisted address (5.59.12).
const { isAdmin } = require('./lib/firebaseAdmin');
// The "never lose ratings" check every setlist write runs (5.60.3).
const { userNoteCounts, lostNotes, withoutUserNotes } = require('../../lib/setlistNotes');
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

// The setlist.fm search and the song parse are the app's own (5.60.7):
// lib/setlistOps.js findSetlistfmMatch and lib/setlistParser.js. This
// function had its own copies until then (its parser also flagged
// `debut` from setlist.fm's song info, which no other path does).
const extractSongs = (match) => extractSongsFromSetlist(match);

// Why a populate must not write over this show, as a 409 response, or null.
//
//   - a setlist the user made by hand (`isManual`), as before 5.60.3
//   - any setlist whose songs carry the user's ratings or comments, which a
//     replacement would lose (5.60.3). Until then a setlist.fm show with
//     rated songs (isManual: false) was simply overwritten.
function refuseOverwrite(show, incoming = []) {
  const existing = Array.isArray(show && show.setlist) ? show.setlist : [];
  if (existing.length > 0 && show.isManual) {
    return {
      statusCode: 409,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Show already has a user-created setlist. Skipping to preserve user data.', reason: 'manual-setlist' }),
    };
  }
  if (lostNotes(existing, incoming)) {
    return {
      statusCode: 409,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'The show\u2019s setlist has the user\u2019s song ratings or comments. Replacing it would lose them, so nothing was written.',
        reason: 'would-lose-notes',
        before: userNoteCounts(existing),
      }),
    };
  }
  return null;
}

exports.handler = async function (event) {
  const missingKey = missingSetlistfmKey();
  if (missingKey) return missingKey;

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
  const { userId, showId, source, donorUserId, donorShowId, artist, date, setlistData } = body;

  if (!userId || !showId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'userId and showId are required' }) };
  }

  try {
    // Verify target show exists
    const showRef = db.collection('users').doc(userId).collection('shows').doc(showId);
    const showSnap = await showRef.get();
    if (!showSnap.exists) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Show not found' }) };
    }

    const existingShow = showSnap.data();

    // Don't overwrite what the user wrote. Checked here, before any
    // setlist.fm request is spent, and again inside the transaction below
    // against the show as it is at write time.
    const refusal = refuseOverwrite(existingShow);
    if (refusal) return refusal;

    let songs = [];
    let setlistfmId = null;
    let setlistfmUrl = null;
    let tour = null;
    let populatedFrom = 'admin-tool';

    if (setlistData && setlistData.songs) {
      // Direct setlist data provided
      songs = setlistData.songs;
      setlistfmId = setlistData.setlistfmId || null;
      setlistfmUrl = setlistData.setlistfmUrl || null;
      tour = setlistData.tour || null;
      populatedFrom = setlistData.populatedFrom || 'admin-tool';
    } else if (source === 'cross_reference' && donorUserId && donorShowId) {
      // Copy from another user's show
      const donorRef = db.collection('users').doc(donorUserId).collection('shows').doc(donorShowId);
      const donorSnap = await donorRef.get();
      if (!donorSnap.exists || !donorSnap.data().setlist) {
        return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Donor show or setlist not found' }) };
      }
      const donorData = donorSnap.data();
      songs = donorData.setlist;
      setlistfmId = donorData.setlistfmId || null;
      setlistfmUrl = donorData.setlistfmUrl || null;
      tour = donorData.tour || null;
      populatedFrom = 'admin-cross-reference';
    } else if (source === 'setlist_fm') {
      // Fresh fetch from setlist.fm
      const searchArtist = artist || existingShow.artist;
      const searchDate = date || existingShow.date;
      if (!searchArtist || !searchDate) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Artist and date required for setlist.fm search' }) };
      }

      const match = await findSetlistfmMatch({ artist: searchArtist, date: searchDate }, setlistDeps());

      if (!match) {
        return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No matching setlist found on setlist.fm' }) };
      }

      songs = extractSongs(match);
      setlistfmId = match.id;
      setlistfmUrl = match.url || null;
      tour = match.tour ? match.tour.name : null;
      populatedFrom = 'admin-setlist-fm';
    } else {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid source. Use cross_reference, setlist_fm, or provide setlistData.' }) };
    }

    if (songs.length === 0) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Matched show has an empty setlist' }) };
    }

    // Populate the show. The songs never carry ratings or comments: a
    // cross-reference copies another user's show, and those notes are
    // theirs (until 5.60.3 they were copied along with the songs).
    const updates = {
      setlist: songs.map(withoutUserNotes),
      isManual: false,
      populatedAt: new Date().toISOString(),
      populatedFrom,
    };
    if (setlistfmId) updates.setlistfmId = setlistfmId;
    if (setlistfmUrl) updates.setlistfmUrl = setlistfmUrl;
    if (tour) updates.tour = tour;

    // Read, check and write in one transaction, so a rating the user adds
    // while the setlist.fm search runs is seen rather than overwritten.
    const blocked = await db.runTransaction(async (tx) => {
      const snap = await tx.get(showRef);
      if (!snap.exists) {
        return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Show not found' }) };
      }
      const current = snap.data();
      const refused = refuseOverwrite(current, updates.setlist);
      if (refused) return refused;
      tx.update(showRef, updates);
      return null;
    });
    if (blocked) return blocked;

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        showId,
        userId,
        songCount: songs.length,
        setlistfmId,
        tour,
        populatedFrom,
      }),
    };
  } catch (err) {
    console.error('[POPULATE] Error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
