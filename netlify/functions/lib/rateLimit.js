/**
 * rateLimit — daily counters in rateLimits/{key}_{YYYY-MM-DD}.
 *
 * Server-only: firestore.rules has no rule for rateLimits, so every
 * client read and write is denied, and only the Admin SDK touches it.
 *
 * One document per key per UTC day, incremented in a transaction so two
 * concurrent requests can't both take the last unit. Each document carries
 * `expiresAt` (two days later) so a Firestore TTL policy on that field can
 * delete old counters; nothing here depends on it.
 *
 * Keys in use:
 *   ai_{uid}                  signed-in scans (analyze-tickets + analyze-screenshot)
 *   ai_anon_global            scans without a token, everyone together
 *   ai_anon_ip_{hash}         scans without a token, per client IP (hashed, never stored raw)
 *   email_{type}_{uid}        send-email, per sender per email type
 */

const crypto = require('crypto');

function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function docId(key, now) {
  return `${String(key).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 300)}_${utcDay(now)}`;
}

/**
 * takeDailyQuota(db, key, limit, { uid }) → { allowed, count, limit }
 * Counts this request when it is allowed; a refused request writes nothing.
 */
async function takeDailyQuota(db, key, limit, { now = Date.now(), cost = 1, uid = null } = {}) {
  const ref = db.doc(`rateLimits/${docId(key, now)}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? Number(snap.data().count) || 0 : 0;
    if (count + cost > limit) return { allowed: false, count, limit };
    tx.set(ref, {
      key: String(key),
      // The user a counter belongs to, so delete-account's purge
      // (lib/userDataPurge.js) can find it; null for the tokenless pool.
      uid: uid || null,
      day: utcDay(now),
      count: count + cost,
      updatedAt: new Date(now),
      expiresAt: new Date(now + 2 * 24 * 60 * 60 * 1000),
    });
    return { allowed: true, count: count + cost, limit };
  });
}

/** Today's count for a key, without taking anything. */
async function peekDailyQuota(db, key, { now = Date.now() } = {}) {
  const snap = await db.doc(`rateLimits/${docId(key, now)}`).get();
  return snap.exists ? Number(snap.data().count) || 0 : 0;
}

/** The caller's IP as Netlify reports it, or ''. */
function clientIp(event) {
  const h = (event && event.headers) || {};
  const raw = h['x-nf-client-connection-ip'] || h['client-ip'] || String(h['x-forwarded-for'] || '').split(',')[0];
  return String(raw || '').trim();
}

/**
 * A stable, non-reversible id for an IP. Keyed with the server's
 * UNSUBSCRIBE_SECRET when it's set (an existing secret, so no new env var),
 * so the 4 billion IPv4 addresses can't simply be hashed and compared.
 */
function ipHash(ip) {
  const key = process.env.UNSUBSCRIBE_SECRET || 'mysetlists-rate-limit';
  return crypto.createHmac('sha256', key).update(String(ip || 'unknown')).digest('hex').slice(0, 32);
}

module.exports = { takeDailyQuota, peekDailyQuota, clientIp, ipHash, utcDay };
