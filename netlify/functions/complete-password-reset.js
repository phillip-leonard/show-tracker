/**
 * complete-password-reset — the reset page's submit (5.60.0).
 *
 * POST { token, newPassword }  →  200 { ok: true }
 *                              →  400 { error, code: 'invalid_link' }
 *                              →  400 { error, code: 'weak_password' }
 *
 * The token is the one send-password-reset mailed (lib/passwordReset.js);
 * it is looked up by its SHA-256. A missing, expired or used token gets
 * the same answer, INVALID_LINK, so the response never says which.
 *
 * In order:
 *   1. the password is checked against the sign-up rules first, so a weak
 *      one doesn't use up the link (lib/passwordRules.js)
 *   2. a transaction marks the token used: two submits of one link can't
 *      both get past this
 *   3. the account must still have the address the link was sent to
 *   4. auth.updateUser(uid, { password }), then revokeRefreshTokens(uid),
 *      which signs out every other session within the hour an ID token
 *      lives (sooner wherever the app re-checks)
 *   5. the user's other unused reset tokens are deleted
 * If step 4's update fails, the token is put back so the link still works.
 *
 * Limit: PER_IP_PER_HOUR attempts from one network (lib/rateLimit.js).
 * Guessing a 16-character base62 token is hopeless anyway; this stops a
 * script trying.
 */

const { getDb, getAdminAuth } = require('./lib/firebaseAdmin');
const { corsHeaders } = require('./lib/cors');
const { takeHourlyQuota, clientIp, ipHash } = require('./lib/rateLimit');
const { validatePassword } = require('./lib/passwordRules');
const { INVALID_LINK, isWellFormedToken, hashToken } = require('./lib/passwordReset');

const PER_IP_PER_HOUR = 20;

function millis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return Number(v) || 0;
}

/** Mark the token used. { ok, uid, email } or { ok: false }. */
async function consumeToken(db, ref, now) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false };
    const d = snap.data();
    if (d.used === true || millis(d.expiresAt) <= now || !d.uid) return { ok: false };
    tx.update(ref, { used: true, usedAt: new Date(now) });
    return { ok: true, uid: d.uid, email: d.email || '' };
  });
}

async function deleteOtherTokens(db, uid, keepId) {
  const snap = await db.collection('passwordResetTokens').where('uid', '==', uid).get();
  await Promise.all(snap.docs
    .filter((d) => d.id !== keepId && d.data().used !== true)
    .map((d) => d.ref.delete()));
}

exports.handler = async function (event) {
  const headers = { ...corsHeaders(event, { methods: 'POST, OPTIONS' }), 'Cache-Control': 'no-store' };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  const invalidLink = () => reply(400, { error: INVALID_LINK, code: 'invalid_link' });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid request' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Invalid request' });

  const now = Date.now();
  let db;
  try {
    db = getDb();
    const q = await takeHourlyQuota(db, `pwreset_done_ip_${ipHash(clientIp(event))}`, PER_IP_PER_HOUR, { now });
    if (!q.allowed) return reply(429, { error: 'Too many attempts. Try again in an hour.' });
  } catch (e) {
    console.error('[complete-password-reset] rate limit check failed:', e.message);
    return reply(500, { error: 'Couldn’t update your password right now. Try again later.' });
  }

  const { token, newPassword } = body;
  if (!isWellFormedToken(token)) return invalidLink();
  const weak = validatePassword(newPassword);
  if (weak) return reply(400, { error: weak, code: 'weak_password' });

  const id = hashToken(token);
  const ref = db.doc(`passwordResetTokens/${id}`);
  let claim;
  try {
    claim = await consumeToken(db, ref, now);
  } catch (e) {
    console.error('[complete-password-reset] token lookup failed:', e.message);
    return reply(500, { error: 'Couldn’t update your password right now. Try again later.' });
  }
  if (!claim.ok) return invalidLink();

  const auth = getAdminAuth();
  try {
    // The link went to an address; if the account has moved to another
    // since, it no longer speaks for it.
    const user = await auth.getUser(claim.uid);
    if (!user || user.disabled || String(user.email || '').toLowerCase() !== claim.email) return invalidLink();
  } catch {
    return invalidLink();
  }

  try {
    await auth.updateUser(claim.uid, { password: newPassword });
  } catch (e) {
    console.error('[complete-password-reset] updateUser failed:', e.code || e.message);
    try { await ref.update({ used: false, usedAt: null }); } catch { /* best effort */ }
    return reply(500, { error: 'Couldn’t update your password right now. Try again.' });
  }

  try {
    await auth.revokeRefreshTokens(claim.uid);
  } catch (e) {
    console.error('[complete-password-reset] revokeRefreshTokens failed:', e.message);
  }
  try {
    await deleteOtherTokens(db, claim.uid, id);
  } catch (e) {
    console.error('[complete-password-reset] clearing other tokens failed:', e.message);
  }

  console.log('[complete-password-reset] password updated');
  return reply(200, { ok: true });
};

exports.PER_IP_PER_HOUR = PER_IP_PER_HOUR;
