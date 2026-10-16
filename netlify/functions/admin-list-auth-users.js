/**
 * admin-list-auth-users — every Firebase Auth account's creation time,
 * for the admin Users tab's signup-date filter (v5.44.0).
 *
 * WHY THIS EXISTS. userProfiles.createdAt is not a reliable signup date.
 * updateUserProfile() in AppContext only writes it when the profile does
 * not exist yet, and since 5.36.2 sign-in writes to the profile first
 * (terms acceptance, then the server-side name sync), so nearly every
 * account created since then has no createdAt at all. Auth's
 * metadata.creationTime is set by Firebase when the account is made and
 * is the one date that is right for every user, old or new.
 *
 * Read-only: nothing is written anywhere. Admin-only, same token check as
 * the other admin-* functions.
 *
 * Response: { users: [{ uid, createdAt, lastSignInAt }] }, dates as ISO
 * strings (null when Auth has none).
 */

const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];
const CORS_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

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
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' },
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

  try {
    const { getAuth } = require('firebase-admin/auth');
    const users = [];
    // listUsers returns at most 1000 per page.
    let pageToken;
    do {
      const page = await getAuth().listUsers(1000, pageToken);
      for (const u of page.users) {
        users.push({
          uid: u.uid,
          createdAt: toIso(u.metadata.creationTime),
          lastSignInAt: toIso(u.metadata.lastSignInTime),
        });
      }
      pageToken = page.pageToken;
    } while (pageToken);

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ users }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
