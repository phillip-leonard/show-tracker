/**
 * accountEmails — an account's email address, from Firebase Auth.
 *
 * Until 5.59.7 every userProfiles doc carried `email`, and every signed-in
 * user could read every profile, so any account could list everyone's
 * address (S-01). Profiles no longer hold it: the client stopped writing
 * it, firestore.rules forbids it, and scripts/strip-profile-emails.js
 * removes the old copies. Auth is the one place an address lives.
 *
 * During the changeover a profile may still carry the old field, so the
 * helpers take it when present (it was written from the same Auth
 * address) and ask Auth otherwise.
 */

const { normalizeEmail } = require('./unsubscribeToken');

const GET_USERS_MAX = 100; // Auth's getUsers limit per call

/** One account's address, or null (no account, or no email on it). */
async function emailForUid(auth, uid, profile = null) {
  if (profile && profile.email) return normalizeEmail(profile.email);
  if (!auth || !uid) return null;
  try {
    const u = await auth.getUser(uid);
    return u && u.email ? normalizeEmail(u.email) : null;
  } catch {
    return null;
  }
}

/** Map(uid → address) for many accounts, in batches of 100. */
async function emailsForUids(auth, uids) {
  const out = new Map();
  const unique = [...new Set((uids || []).filter(Boolean))];
  if (!auth || unique.length === 0) return out;
  if (typeof auth.getUsers !== 'function') {
    for (const uid of unique) {
      const e = await emailForUid(auth, uid);
      if (e) out.set(uid, e);
    }
    return out;
  }
  for (let i = 0; i < unique.length; i += GET_USERS_MAX) {
    const chunk = unique.slice(i, i + GET_USERS_MAX).map((uid) => ({ uid }));
    const res = await auth.getUsers(chunk);
    for (const u of res.users || []) {
      if (u.email) out.set(u.uid, normalizeEmail(u.email));
    }
  }
  return out;
}

/**
 * Fills `email` on profile-shaped rows ({ uid, email? }) that lack one.
 * Returns new objects; rows whose account has no address keep email ''.
 */
async function withAccountEmails(auth, rows) {
  const missing = rows.filter((r) => !r.email).map((r) => r.uid);
  const found = await emailsForUids(auth, missing);
  return rows.map((r) => (r.email ? r : { ...r, email: found.get(r.uid) || '' }));
}

module.exports = { emailForUid, emailsForUids, withAccountEmails };
