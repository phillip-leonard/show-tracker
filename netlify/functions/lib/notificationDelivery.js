/**
 * notificationDelivery — sending an email that lib/emailAuthorization.js
 * has approved: the sender's limits, the recipient's opt-out, the one-time
 * marker, then Resend. send-email.js uses it for every browser-initiated
 * email, and friends.js for invites (5.60.28), so both apply the same
 * limits and markers.
 *
 *   deliverAuthorized({ db, now }, caller, decision)
 *     caller    { uid, isAdmin }
 *     decision  an { ok: true } answer from authorizeEmail
 *   resolves
 *     { sent: true }
 *     { skipped: 'recipient opted out' | 'already sent' }
 *     { error: status, message }   429 (a limit), 502 (Resend refused),
 *                                  503 (email not configured)
 *
 * Limits: RATE_LIMIT_PER_HOUR across all types, plus a daily limit per
 * type (DAILY_LIMITS); admins exempt. The marker in emailSends/{key} keeps
 * the same record from being emailed twice, and an invite from being
 * re-sent to an address within 24 hours; it's released if Resend refuses,
 * so a retry can send.
 */

const { canEmail } = require('./emailPolicy');
const { buildEmail, sendOne } = require('./outgoingEmail');
const { DAILY_LIMITS } = require('./emailAuthorization');
const { takeDailyQuota } = require('./rateLimit');

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

/** True when the email provider is configured. */
function emailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.UNSUBSCRIBE_SECRET);
}

async function deliverAuthorized({ db, now = Date.now() }, caller, decision) {
  if (!emailConfigured()) {
    console.error('[email] RESEND_API_KEY or UNSUBSCRIBE_SECRET is not set');
    return { error: 503, message: 'Email is unavailable right now' };
  }
  if (!caller.isAdmin) {
    if (!(await takeRateLimit(db, caller.uid, now))) {
      return { error: 429, message: `Too many emails — the limit is ${RATE_LIMIT_PER_HOUR} per hour.` };
    }
    const daily = DAILY_LIMITS[decision.type];
    if (Number.isFinite(daily)) {
      const q = await takeDailyQuota(db, `email_${decision.type}_${caller.uid}`, daily, { now, uid: caller.uid });
      if (!q.allowed) return { error: 429, message: 'You’ve sent the most emails of this kind for today. Try again tomorrow.' };
    }
  }

  const { recipient } = decision;
  if (!(await canEmail({ uid: recipient.uid, email: recipient.email, category: 'notification' }, { db }))) {
    return { skipped: 'recipient opted out' };
  }

  if (!(await claimSend(db, decision.dedupeKey, { ttlMs: decision.dedupeTtlMs, now, type: decision.type, uid: caller.uid }))) {
    return { skipped: 'already sent' };
  }

  const payload = buildEmail({
    recipient,
    subject: decision.email.subject,
    html: decision.email.html,
    scope: 'all',
    source: `notification:${decision.source}`,
  });

  const result = await sendOne(payload);
  if (result.ok) return { sent: true };
  await releaseSend(db, decision.dedupeKey);
  console.error(`[email] Resend ${result.status} for ${decision.type}`);
  return { error: 502, message: 'Email send failed' };
}

module.exports = { deliverAuthorized, takeRateLimit, claimSend, releaseSend, emailConfigured, RATE_LIMIT_PER_HOUR };
