// create-shared-collection.js
// Authenticated endpoint — requires Firebase ID token.
// Creates a shared collection snapshot in Firestore for public viewing.

const { withCors } = require('./lib/cors');
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

async function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }
  const { getAuth } = require('firebase-admin/auth');
  const token = authHeader.replace('Bearer ', '');
  return await getAuth().verifyIdToken(token);
}

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    initFirebase();

    // Verify authentication
    const decoded = await verifyToken(event.headers.authorization || event.headers.Authorization);
    const uid = decoded.uid;

    const body = JSON.parse(event.body || '{}');
    const { shows, stats, ownerName } = body;

    if (!shows || !Array.isArray(shows) || shows.length === 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'No shows provided' }),
      };
    }

    // Sanitize shows — only include safe fields
    const sanitizedShows = shows.map(s => ({
      artist: s.artist || '',
      venue: s.venue || '',
      city: s.city || '',
      date: s.date || '',
      rating: s.rating || null,
      setlist: (s.setlist || []).map(song => ({
        name: song.name || '',
        rating: song.rating || null,
      })),
    }));

    const { getFirestore, FieldValue } = require('firebase-admin/firestore');
    const db = getFirestore();

    const docRef = await db.collection('sharedCollections').add({
      ownerUid: uid,
      ownerName: ownerName || 'A Fan',
      shows: sanitizedShows,
      stats: {
        totalShows: stats?.totalShows || sanitizedShows.length,
        totalSongs: stats?.totalSongs || sanitizedShows.reduce((acc, s) => acc + (s.setlist?.length || 0), 0),
        topArtist: stats?.topArtist || '',
        avgRating: stats?.avgRating || null,
      },
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: null, // No expiry by default
    });

    const shareUrl = `https://mysetlists.net/shared/${docRef.id}`;

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ id: docRef.id, url: shareUrl }),
    };
  } catch (error) {
    console.error('create-shared-collection error:', error);
    const status = error.message.includes('Authorization') ? 401 : 500;
    return {
      statusCode: status,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
