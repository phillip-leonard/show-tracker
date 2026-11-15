/**
 * admin-find-missing-setlists — Admin-only endpoint that scans users for shows
 * missing setlists, then searches setlist.fm to find and optionally populate them.
 *
 * Efficient approach: only reads target users' shows (batched), then queries
 * setlist.fm for each unique artist+date combo (deduplicated, rate-limited).
 *
 * POST body:
 *   {
 *     userId?: string,         // scan a single user (omit to scan batch)
 *     autoPopulate?: boolean,  // auto-populate matches (default false)
 *     limit?: number,          // max users to scan (default 20)
 *   }
 *
 * Auth: Authorization: Bearer {idToken} — admin only
 */

const { withCors } = require('./lib/cors');
const { missingSetlistfmKey } = require('./lib/setlistfmKey');
const { findSetlistfmMatch, inTransaction } = require('./lib/setlistOps');
const { setlistDeps } = require('./lib/setlistOpsHandler');
const { extractSongsFromSetlist } = require('../../lib/setlistParser');

// The one admin check: custom claim or verified allowlisted address (5.59.12).
const { isAdmin } = require('./lib/firebaseAdmin');
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Firebase init ───────────────────────────────────────────────────

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

// ── Setlist.fm API ──────────────────────────────────────────────────

// The setlist.fm search and the song parse are the app's own (5.60.7):
// lib/setlistOps.js findSetlistfmMatch (the artist's year, up to three
// pages, under the name variants scanForMissingSetlists always tried,
// through search-setlists.js and its cache) and lib/setlistParser.js. This
// function had its own copies of both until then.
function searchSetlistFm(artist, date) {
  if (!artist || !date) return Promise.resolve(null);
  return findSetlistfmMatch({ artist, date }, setlistDeps());
}

const extractSongs = (match) => extractSongsFromSetlist(match);

// ── Handler ─────────────────────────────────────────────────────────

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
  const { userId, autoPopulate = false, limit = 20 } = body;

  try {
    // ─── Phase 1: Collect shows missing setlists from target users ───
    // Only reads target users — NOT every user in the system.
    console.log('[SCAN] Phase 1: Finding shows missing setlists...');

    let targetUserDocs;
    let totalUsersInSystem = 0;

    if (userId) {
      // Single user mode
      const profileSnap = await db.collection('userProfiles').doc(userId).get();
      targetUserDocs = profileSnap.exists ? [profileSnap] : [];
      totalUsersInSystem = 1;
    } else {
      // Batch mode — fetch users ordered by last login, limited batch
      const usersSnap = await db.collection('userProfiles')
        .orderBy('lastLogin', 'desc')
        .limit(limit)
        .get();
      targetUserDocs = usersSnap.docs;
      totalUsersInSystem = targetUserDocs.length;
    }

    const missingShows = []; // { userId, userEmail, showId, artist, venue, date }
    let usersScanned = 0;
    let totalShowsScanned = 0;

    for (const userDoc of targetUserDocs) {
      const uid = userDoc.id;
      const userData = userDoc.data();
      const userLabel = userData.displayName || userData.email || uid;
      usersScanned++;

      const showsSnap = await db.collection('users').doc(uid).collection('shows').get();
      if (showsSnap.empty) continue;

      for (const showDoc of showsSnap.docs) {
        const show = showDoc.data();
        totalShowsScanned++;

        if (!show.setlist || show.setlist.length === 0) {
          missingShows.push({
            userId: uid,
            userEmail: userLabel,
            showId: showDoc.id,
            artist: show.artist || 'Unknown',
            venue: show.venue || 'Unknown',
            date: show.date || 'Unknown',
          });
        }
      }
    }

    console.log(`[SCAN] Phase 1 done: ${usersScanned} users, ${totalShowsScanned} shows, ${missingShows.length} missing`);

    // ─── Phase 2: Search setlist.fm for matches ─────────────────────
    console.log('[SCAN] Phase 2: Searching setlist.fm for matches...');

    let matchesFoundFromSetlistFm = 0;
    let populatedCount = 0;
    let setlistFmCallCount = 0;
    const results = [];
    const errors = [];

    // Deduplicate: group missing shows by artist+date to avoid redundant API calls
    const queryCache = {}; // "artist|date" → { matchSource, matchData } or null

    for (const ms of missingShows) {
      const cacheKey = `${(ms.artist || '').toLowerCase().trim()}|${ms.date}`;

      let matchSource = 'none';
      let matchData = null;

      if (queryCache[cacheKey] !== undefined) {
        // Already queried this artist+date combo — reuse result
        const cached = queryCache[cacheKey];
        if (cached) {
          matchSource = cached.matchSource;
          matchData = cached.matchData;
        }
      } else {
        // Search setlist.fm (rate-limited to 30 unique artist+date combos per run)
        if (setlistFmCallCount < 30) {
          try {
            const sfmMatch = await searchSetlistFm(ms.artist, ms.date);
            setlistFmCallCount++;
            if (sfmMatch) {
              const songs = extractSongs(sfmMatch);
              if (songs.length > 0) {
                matchSource = 'setlist_fm';
                matchData = {
                  songs,
                  setlistfmId: sfmMatch.id,
                  setlistfmUrl: sfmMatch.url || null,
                  tour: sfmMatch.tour ? sfmMatch.tour.name : null,
                };
                matchesFoundFromSetlistFm++;
              }
            }
          } catch (err) {
            errors.push(`Setlist.fm error for ${ms.artist} (${ms.date}): ${err.message}`);
          }
        }

        // Cache the result for this artist+date combo
        queryCache[cacheKey] = matchData ? { matchSource, matchData } : null;
      }

      const result = {
        userId: ms.userId,
        userEmail: ms.userEmail,
        showId: ms.showId,
        artist: ms.artist,
        venue: ms.venue,
        date: ms.date,
        matchSource,
        matchSetlistfmId: matchData?.setlistfmId || null,
        songCount: matchData?.songs?.length || 0,
        tour: matchData?.tour || null,
        populated: false,
        error: null,
      };

      // Auto-populate if requested
      if (autoPopulate && matchData && matchData.songs.length > 0) {
        try {
          const updates = {
            setlist: matchData.songs,
            isManual: false,
            populatedAt: new Date().toISOString(),
            populatedFrom: 'admin-setlist-fm',
          };
          if (matchData.setlistfmId) updates.setlistfmId = matchData.setlistfmId;
          if (matchData.setlistfmUrl) updates.setlistfmUrl = matchData.setlistfmUrl;
          if (matchData.tour) updates.tour = matchData.tour;

          // Only into a setlist that is still empty, read in the same
          // transaction (5.60.7): a show that gained songs since the scan
          // read it is left alone, so nothing the user wrote is replaced.
          const written = await inTransaction(db, ms.userId, ms.showId, (current) => (
            (current.setlist || []).length > 0
              ? { ok: false, reason: 'has-setlist' }
              : { ok: true, update: updates }
          ));
          if (!written.ok) throw new Error(written.reason === 'has-setlist' ? 'the show has a setlist now; left alone' : written.reason);
          result.populated = true;
          populatedCount++;
        } catch (err) {
          result.error = `Failed to populate: ${err.message}`;
          errors.push(`Populate error for ${ms.userId}/${ms.showId}: ${err.message}`);
        }
      }

      results.push(result);
    }

    console.log(`[SCAN] Complete: ${usersScanned} users, ${missingShows.length} missing, ${matchesFoundFromSetlistFm} SFM matches, ${populatedCount} populated`);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        usersScanned,
        totalUsersInSystem,
        totalShowsScanned,
        showsMissingSetlists: missingShows.length,
        matchesFoundFromSetlistFm,
        populatedCount,
        setlistFmCallsUsed: setlistFmCallCount,
        results,
        errors,
      }),
    };
  } catch (err) {
    console.error('[SCAN] Fatal error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
