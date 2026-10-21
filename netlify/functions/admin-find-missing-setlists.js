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

const https = require('https');
const { setlistfmKey, missingSetlistfmKey } = require('./lib/setlistfmKey');

const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
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
  if (!ADMIN_EMAILS.includes(decoded.email)) throw new Error('Forbidden');
  return decoded;
}

// ── Setlist.fm API ──────────────────────────────────────────────────

function fetchFromSetlistFm(params) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.setlist.fm',
      path: `/rest/1.0/search/setlists?${params.toString()}`,
      method: 'GET',
      headers: {
        'x-api-key': setlistfmKey(),
        Accept: 'application/json',
        'User-Agent': 'MySetlists/3.8',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function searchSetlistFm(artist, date) {
  if (!artist || !date) return null;
  const year = date.split('-')[0];

  const searchVariants = [artist];
  if (artist.includes('&')) searchVariants.push(artist.replace(/&/g, 'and'));
  if (artist.toLowerCase().startsWith('the ')) searchVariants.push(artist.substring(4));
  else searchVariants.push('The ' + artist);

  for (const searchArtist of searchVariants) {
    try {
      const params = new URLSearchParams({ artistName: searchArtist, year, p: '1' });
      const { statusCode, data } = await fetchFromSetlistFm(params);

      if (statusCode === 429) {
        await new Promise((r) => setTimeout(r, 2000));
        const retry = await fetchFromSetlistFm(params);
        if (retry.statusCode === 200 && retry.data.setlist) {
          const match = findDateMatch(retry.data.setlist, date);
          if (match) return match;
        }
        continue;
      }

      if (statusCode !== 200 || !data.setlist || data.setlist.length === 0) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }

      const match = findDateMatch(data.setlist, date);
      if (match) return match;
    } catch (err) {
      console.warn(`[SETLIST.FM] Error searching "${searchArtist}":`, err.message);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

function findDateMatch(setlists, targetDate) {
  return setlists.find((s) => {
    if (!s.eventDate) return false;
    const parts = s.eventDate.split('-');
    if (parts.length !== 3) return false;
    return `${parts[2]}-${parts[1]}-${parts[0]}` === targetDate;
  }) || null;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const toRoman = (n) => ROMAN[n - 1] || String(n);

// Counts regular sets and encores separately so labels come out right even
// when a show has multiple regular sets before its encore(s).
function extractSongs(match) {
  const songs = [];
  let regularSetCount = 0;
  let encoreCount = 0;
  if (match.sets && match.sets.set) {
    match.sets.set.forEach((set) => {
      let setLabel;
      if (set.encore) {
        encoreCount++;
        setLabel = encoreCount === 1 ? 'Encore' : `Encore ${toRoman(encoreCount)}`;
      } else {
        regularSetCount++;
        setLabel = `Set ${toRoman(regularSetCount)}`;
      }

      if (set.song) {
        set.song.forEach((song) => {
          songs.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            name: song.name.trim(),
            set: setLabel,
            cover: song.cover ? song.cover.name : null,
            tape: song.tape || false,
          });
        });
      }
    });
  }
  return songs;
}

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
          if (matchData.tour) updates.tour = matchData.tour;

          await db.collection('users').doc(ms.userId).collection('shows').doc(ms.showId).update(updates);
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
