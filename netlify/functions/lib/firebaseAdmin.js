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

// The admin allowlist. Since 5.59.12 this is the only copy in the
// functions: every admin check goes through isAdmin() below.
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

/**
 * isAdmin(decodedToken) — the one admin check (5.59.12). Every function
 * uses it, firestore.rules' and storage.rules' isAdmin() say the same, and
 * the client's isAdminUser (lib/adminAccess.js) mirrors it for UI only.
 *
 * True for either:
 *   - the custom claim `admin: true` (set with scripts/set-admin-claim.js),
 *     the long-term source of truth, or
 *   - an allowlisted address the token says is verified. email_verified
 *     matters: an unverified token can carry any address its holder typed.
 *     The admin account signs in with Google, whose tokens are verified.
 * Once the claim is set and confirmed, a later change can drop the email
 * half here and in the rules.
 */
function isAdmin(decoded) {
  if (!decoded) return false;
  if (decoded.admin === true) return true;
  return decoded.email_verified === true && ADMIN_EMAILS.includes(decoded.email);
}

/**
 * isAnonymous(decodedToken) — a guest: Firebase anonymous auth, with no
 * credential linked yet (5.60.13, native app Part 2). The same rule as
 * isAnonymous() in firestore.rules and storage.rules:
 *
 *   firebase.sign_in_provider is 'anonymous'  AND  firebase.identities is empty
 *
 * Both, because Firebase doesn't document whether sign_in_provider changes
 * when an anonymous account links Apple, Google or email; a linked account
 * always has an identity (tests/auth/anonymousLink.test.js checks both
 * against the Auth emulator). A token with no `firebase` claim at all is
 * not anonymous: every real sign-in carries one, and treating its absence
 * as a guest would lock real accounts out on a malformed token's say-so
 * (they are refused by verifyIdToken anyway).
 */
function isAnonymous(decoded) {
  if (!decoded || typeof decoded !== 'object') return false;
  const fb = decoded.firebase;
  if (!fb || typeof fb !== 'object') return false;
  if (fb.sign_in_provider !== 'anonymous') return false;
  const ids = fb.identities;
  return !ids || typeof ids !== 'object' || Object.keys(ids).length === 0;
}

/**
 * isAnonymousAuthUser(userRecord) — the same question asked of an Auth user
 * record (auth.getUser / listUsers) rather than a token: a guest has no
 * provider linked (providerData is empty). What the stats jobs and the
 * welcome email use, since they work from Auth, not from a request.
 */
function isAnonymousAuthUser(user) {
  return !!user && Array.isArray(user.providerData) && user.providerData.length === 0;
}

/**
 * listAnonymousUids(auth) → Set of every guest's uid, from Firebase Auth
 * (listUsers, 1,000 a page). For the stats jobs, which leave guests out of
 * rankings and totals. Throws if Auth can't be read: a job that can't tell
 * guests apart should fail and keep the last good numbers, not count them.
 */
async function listAnonymousUids(auth) {
  const out = new Set();
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users || []) if (isAnonymousAuthUser(u)) out.add(u.uid);
    pageToken = page.pageToken;
  } while (pageToken);
  return out;
}

// The 5.59.6 name, kept for the functions that already use it.
const isAdminClaims = isAdmin;

function __setTestFirebase({ db = null, auth = null } = {}) {
  testDb = db;
  testAuth = auth;
}

module.exports = { getDb, getAdminAuth, verifyUser, isAdmin, isAdminClaims, isAnonymous, isAnonymousAuthUser, listAnonymousUids, bearerToken, ADMIN_EMAILS, __setTestFirebase };
