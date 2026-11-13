const { withCors } = require('./lib/cors');
const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];
const CORS_HEADERS = { 'Content-Type': 'application/json' };

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

function getDb() {
  const { getFirestore } = require('firebase-admin/firestore');
  return getFirestore();
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...CORS_HEADERS,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
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
  } catch (e) {
    const status = e.message === 'Forbidden' ? 403 : 401;
    return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }

  const { by, name, key } = JSON.parse(event.body || '{}');
  const db = getDb();

  try {
    if (by === 'artist' && name) {
      const snapshot = await db.collection('setlistCache')
        .where('queryParams.artistName', '==', name.toLowerCase().trim())
        .get();
      if (snapshot.size > 0) {
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
      console.log(`[CLEAR-CACHE] artist "${name}": deleted ${snapshot.size} entries`);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ deleted: snapshot.size, by: 'artist', name }),
      };
    }

    if (key) {
      await db.collection('setlistCache').doc(key).delete();
      console.log(`[CLEAR-CACHE] key "${key}": deleted`);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ deleted: 1, key }),
      };
    }

    if (by === 'all') {
      let total = 0;
      let snap;
      do {
        snap = await db.collection('setlistCache').limit(500).get();
        if (snap.size > 0) {
          const batch = db.batch();
          snap.docs.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
          total += snap.size;
        }
      } while (snap.size === 500);
      console.log(`[CLEAR-CACHE] all: deleted ${total} entries`);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ deleted: total, by: 'all' }),
      };
    }

    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Provide by=artist with name, a cache key, or by=all' }),
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
