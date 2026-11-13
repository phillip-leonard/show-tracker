/**
 * send-email — the app's one browser-initiated email path (tags, invites,
 * friend-joined, suggestion nudges, replies/likes, venue verification,
 * admin messages).
 *
 * POST body:   { type, …ids }   e.g. { type: 'tag', tagId }
 *              See lib/emailAuthorization.js for every type and its ids.
 *              The legacy { to, subject, html, type } shape from the iOS
 *              app ≤ 3.13.5 is still accepted, but only to find the record
 *              behind it: its subject and html are ignored.
 * Auth header: Authorization: Bearer {idToken}   (any signed-in user)
 *
 * HOW IT GOT HERE.
 *   - Until 5.38 it took any to/subject/html from anyone, from any
 *     origin: an open relay. 5.38 added the ID token, the CORS allowlist,
 *     a per-sender hourly limit and server-side opt-out.
 *   - Until 5.59.6 a signed-in user could still send arbitrary HTML to an
 *     arbitrary address (S-06). Now the browser never supplies HTML, a
 *     subject or a free-form recipient: the server checks the caller sent
 *     the tag / invite / notification the email is about, looks the
 *     recipient up itself and builds the email from its own templates
 *     (lib/notificationTemplates.js).
 *
 * Limits: RATE_LIMIT_PER_HOUR across all types, plus a daily limit per
 * type (DAILY_LIMITS in lib/emailAuthorization.js); admins exempt. Each
 * email claims a one-time marker in emailSends/{key}, so the same record
 * is never emailed twice and an invite can't be re-sent within 24 hours.
 *
 * Opt-out (canEmail), the recipient's signed unsubscribe footer and the
 * List-Unsubscribe headers are unchanged.
 */

const { getDb, getAdminAuth } = require('./lib/firebaseAdmin');
const { requireUser } = require('./lib/requestAuth');
const { corsHeaders, ALLOWED_ORIGINS } = require('./lib/cors');
const { canEmail } = require('./lib/emailPolicy');
const { buildEmail, sendOne } = require('./lib/outgoingEmail');
const { authorizeEmail, DAILY_LIMITS } = require('./lib/emailAuthorization');
const { takeDailyQuota } = require('./lib/rateLimit');

const RATE_LIMIT_PER_HOUR = 30;
const WINDOW_MS = 60 * 60 * 1000;

/** Fixed hourly window per sender, in emailRateLimits/{uid}. */
async function takeRateLimit(db, uid, now = Date.now()) {
  const ref = db.doc(`emailRateLimits/${uid}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : null;
    const fresh = !d || now - (d.windowStart || 0) >= WINDOW_MS;
    const count = fresh ? 0 : d.count || 0;
    if (count >= RATE_LIMIT_PER_HOUR) return false;
    tx.set(ref, { uid, windowStart: fresh ? now : d.windowStart, count: count + 1, updatedAt: new Date(now) });
    return true;
  });
}

/**
 * Take the one-time marker for this email. False if it's already taken
 * (and, with a ttl, was taken less than ttl ago).
 */
async function claimSend(db, key, { ttlMs = null, now = Date.now(), type, uid = null } = {}) {
  if (!key) return true;
  const ref = db.doc(`emailSends/${key}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const sentAt = Number(snap.data().sentAtMs) || 0;
      if (!ttlMs || now - sentAt < ttlMs) return false;
    }
    // uid = the sender, so delete-account's purge can find their markers.
    tx.set(ref, { type: type || null, uid: uid || null, sentAtMs: now, sentAt: new Date(now) });
    return true;
  });
}

async function releaseSend(db, key) {
  if (!key) return;
  try { await db.doc(`emailSends/${key}`).delete(); } catch { /* best effort */ }
}

exports.handler = async function (event) {
  const headers = corsHeaders(event, { methods: 'POST, OPTIONS' });
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  const skipped = (reason) => reply(200, { success: true, skipped: true, reason });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const caller = await requireUser(event, headers, { message: 'Sign in required' });
  if (caller.response) return caller.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid request' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Invalid request' });

  if (!process.env.RESEND_API_KEY || !process.env.UNSUBSCRIBE_SECRET) {
    console.error('[send-email] RESEND_API_KEY or UNSUBSCRIBE_SECRET is not set');
    return reply(503, { error: 'Email is unavailable right now' });
  }

  const db = getDb();
  const auth = getAdminAuth();
  const now = Date.now();

  let decision;
  try {
    decision = await authorizeEmail({ db, auth, now }, caller, body);
  } catch (e) {
    console.error('[send-email] authorization failed:', e.message);
    return reply(500, { error: 'Could not send right now' });
  }
  if (!decision.ok) {
    // Type and reason only, never an address.
    console.log(`[send-email] not sent: ${body.type || 'unknown'} ${decision.reason}${decision.legacy ? ' (legacy)' : ''}`);
    // A legacy client gets a quiet 200, as it always has for a skipped
    // email; so does a recipient who hasn't opted in.
    if (decision.legacy || decision.status === 200) return skipped(decision.reason);
    return reply(decision.status || 403, { error: decision.status === 400 ? 'Invalid request' : 'Not allowed' });
  }

  try {
    if (!caller.isAdmin) {
      if (!(await takeRateLimit(db, caller.uid, now))) {
        return reply(429, { error: `Too many emails — the limit is ${RATE_LIMIT_PER_HOUR} per hour.` });
      }
      const daily = DAILY_LIMITS[decision.type];
      if (Number.isFinite(daily)) {
        const q = await takeDailyQuota(db, `email_${decision.type}_${caller.uid}`, daily, { now, uid: caller.uid });
        if (!q.allowed) return reply(429, { error: 'You’ve sent the most emails of this kind for today. Try again tomorrow.' });
      }
    }
  } catch (e) {
    console.error('[send-email] rate limit check failed:', e.message);
    return reply(500, { error: 'Could not send right now' });
  }

  const { recipient } = decision;
  if (!(await canEmail({ uid: recipient.uid, email: recipient.email, category: 'notification' }, { db }))) {
    return skipped('recipient opted out');
  }

  if (!(await claimSend(db, decision.dedupeKey, { ttlMs: decision.dedupeTtlMs, now, type: decision.type, uid: caller.uid }))) {
    return skipped('already sent');
  }

  const payload = buildEmail({
    recipient,
    subject: decision.email.subject,
    html: decision.email.html,
    scope: 'all',
    source: `notification:${decision.source}`,
  });

  const result = await sendOne(payload);
  if (result.ok) return reply(200, { success: true });
  await releaseSend(db, decision.dedupeKey);
  console.error(`[send-email] Resend ${result.status} for ${decision.type}`);
  return reply(502, { error: 'Email send failed' });
};

exports.takeRateLimit = takeRateLimit;
exports.claimSend = claimSend;
exports.RATE_LIMIT_PER_HOUR = RATE_LIMIT_PER_HOUR;
exports.ALLOWED_ORIGINS = ALLOWED_ORIGINS;
