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

const https = require('https');
const { setlistfmKey, missingSetlistfmKey } = require('./lib/setlistfmKey');

const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
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

function extractSongs(match) {
  const songs = [];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  let regularSetCount = 0;
  let encoreCount = 0;

  if (match.sets && match.sets.set) {
    match.sets.set.forEach((set) => {
      let setLabel;
      if (set.encore) {
        encoreCount++;
        setLabel = encoreCount === 1 ? 'Encore' : `Encore ${ROMAN[encoreCount - 1] || encoreCount}`;
      } else {
        regularSetCount++;
        setLabel = `Set ${ROMAN[regularSetCount - 1] || regularSetCount}`;
      }

      if (set.song) {
        set.song.forEach((song) => {
          const info = (song.info || '').toLowerCase();
          const isDebut = info.includes('debut');

          songs.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            name: (song.name || '').trim(),
            set: setLabel,
            cover: song.cover ? song.cover.name : null,
            tape: song.tape || false,
            debut: isDebut,
          });
        });
      }
    });
  }
  return songs;
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

    // Don't overwrite user-created/modified setlists
    if (existingShow.setlist && existingShow.setlist.length > 0 && existingShow.isManual) {
      return {
        statusCode: 409,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Show already has a user-created setlist. Skipping to preserve user data.' }),
      };
    }

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

      const year = searchDate.split('-')[0];
      const searchVariants = [searchArtist];
      if (searchArtist.includes('&')) searchVariants.push(searchArtist.replace(/&/g, 'and'));
      if (searchArtist.toLowerCase().startsWith('the ')) searchVariants.push(searchArtist.substring(4));
      else searchVariants.push('The ' + searchArtist);

      let match = null;
      for (const variant of searchVariants) {
        if (match) break;
        const params = new URLSearchParams({ artistName: variant, year, p: '1' });
        try {
          const { statusCode, data } = await fetchFromSetlistFm(params);
          if (statusCode === 200 && data.setlist) {
            match = data.setlist.find((s) => {
              if (!s.eventDate) return false;
              const parts = s.eventDate.split('-');
              if (parts.length !== 3) return false;
              return `${parts[2]}-${parts[1]}-${parts[0]}` === searchDate;
            });
          }
        } catch (err) {
          console.warn(`[POPULATE] Search error for "${variant}":`, err.message);
        }
        await new Promise((r) => setTimeout(r, 300));
      }

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

    // Populate the show
    const updates = {
      setlist: songs,
      isManual: false,
      populatedAt: new Date().toISOString(),
      populatedFrom,
    };
    if (setlistfmId) updates.setlistfmId = setlistfmId;
    if (setlistfmUrl) updates.setlistfmUrl = setlistfmUrl;
    if (tour) updates.tour = tour;

    await showRef.update(updates);

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
