/**
 * firebaseAdmin — one place the email functions get Firestore and Auth.
 *
 * Every older function inlines its own initFirebase(); the email and
 * unsubscribe functions share this instead so their unit tests can swap in
 * an in-memory Firestore and a fake Auth (see tests/email/fakeFirestore.js)
 * and exercise the real handlers without credentials or a network.
 */

let testDb = null;
let testAuth = null;

function initFirebase() {
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  if (getApps().length > 0) return;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) throw new Error('Firebase env vars not configured');
  initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
}

function getDb() {
  if (testDb) return testDb;
  initFirebase();
  return require('firebase-admin/firestore').getFirestore();
}

function getAdminAuth() {
  if (testAuth) return testAuth;
  initFirebase();
  return require('firebase-admin/auth').getAuth();
}

// Same list every admin-* function hard-codes, and the same address
// firestore.rules' isAdmin() checks.
const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];

function bearerToken(event) {
  const h = event.headers || {};
  return String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
}

/** Verified ID token claims, or null. */
async function verifyUser(event) {
  const token = bearerToken(event);
  if (!token) return null;
  try {
    return await getAdminAuth().verifyIdToken(token);
  } catch {
    return null;
  }
}

// email_verified too (5.59.6): the allowlist is an address, and an
// unverified token can carry any address its holder typed. The admin
// account signs in with Google, whose tokens are always verified.
function isAdminClaims(decoded) {
  return !!decoded && decoded.email_verified === true && ADMIN_EMAILS.includes(decoded.email);
}

function __setTestFirebase({ db = null, auth = null } = {}) {
  testDb = db;
  testAuth = auth;
}

module.exports = { getDb, getAdminAuth, verifyUser, isAdminClaims, bearerToken, ADMIN_EMAILS, __setTestFirebase };
