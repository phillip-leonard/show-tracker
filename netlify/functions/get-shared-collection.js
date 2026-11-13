// get-shared-collection.js
// Public endpoint — no auth required.
// Returns a shared collection by ID for public viewing.

const { withCors } = require('./lib/cors');
const CORS_HEADERS = {
  'Content-Type': 'application/json',
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

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const id = event.queryStringParameters?.id;
  if (!id) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing id parameter' }),
    };
  }

  try {
    initFirebase();

    const { getFirestore } = require('firebase-admin/firestore');
    const db = getFirestore();

    const docSnap = await db.collection('sharedCollections').doc(id).get();

    if (!docSnap.exists) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Collection not found' }),
      };
    }

    const data = docSnap.data();

    // Check expiry
    if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
      return {
        statusCode: 410,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'This shared collection has expired' }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        id: docSnap.id,
        ownerName: data.ownerName || 'A Fan',
        shows: data.shows || [],
        stats: data.stats || {},
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      }),
    };
  } catch (error) {
    console.error('get-shared-collection error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
