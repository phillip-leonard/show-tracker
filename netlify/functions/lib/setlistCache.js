// netlify/functions/lib/setlistCache.js
//
// The one place a setlist.fm response is cached, read back, and dated.
//
// setlist.fm's API terms allow "cached information for short periods" and
// nothing longer: no copies, no archive. So the shared `setlistCache`
// collection follows three rules, and every function that caches a
// setlist.fm response goes through this file so none can drift from them:
//
//   1. Nothing lives longer than MAX_TTL_HOURS (24). A caller may ask for
//      less; it can never get more.
//   2. An expired entry is never served, not even as a fallback when
//      setlist.fm is down. Until 5.47.5 search-setlists, get-artist-tours
//      and get-tour-shows all served expired entries ("STALE") on a 429 or
//      an outage, which made an expired entry worth keeping forever: in
//      October 2026 the collection held 922 expired entries going back to
//      March. A caller that can't reach setlist.fm now says so.
//   3. Every entry carries `expiresAt`, and the collection has a Firestore
//      TTL policy on that field, so Firestore deletes it on its own (within
//      about a day of expiry, per Firestore's TTL docs). The read check in
//      rule 2 covers the gap between expiry and deletion.
//      scripts/setlist-cache-ttl.js applies the policy and purges what
//      expired before it existed.
//
// Usage:
//
//   const cached = await readFresh(db, key);
//   if (cached) return { ...body: cached.response };
//   ...fetch...
//   writeEntry(db, key, { response, ttlHours: 24, queryParams });

const COLLECTION = 'setlistCache';
const MAX_TTL_HOURS = 24;

/** A requested TTL, held to (0, MAX_TTL_HOURS]. Anything unusable gets the max. */
function clampTtlHours(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return MAX_TTL_HOURS;
  return Math.min(h, MAX_TTL_HOURS);
}

/** True when the entry's expiresAt is still in the future. Missing = expired. */
function isFresh(entry, now = Date.now()) {
  const expiresMs = entry?.expiresAt?.toMillis?.() || 0;
  return expiresMs > now;
}

/**
 * The cached entry for `key` when it has not expired, otherwise null.
 * Expired entries are reported as misses, never returned. Bumps hitCount on
 * a hit, without waiting for it.
 */
async function readFresh(db, key, now = Date.now()) {
  if (!db) return null;
  try {
    const snap = await db.collection(COLLECTION).doc(key).get();
    if (!snap.exists) return null;
    const entry = snap.data();
    if (!isFresh(entry, now)) return null;
    snap.ref.update({ hitCount: (entry.hitCount || 0) + 1 }).catch(() => {});
    return entry;
  } catch (e) {
    console.warn('[CACHE] Read error:', e.message);
    return null;
  }
}

/** The document written for one cached response. */
function buildEntry({ response, ttlHours, queryParams = {} }, now = Date.now()) {
  const { Timestamp } = require('firebase-admin/firestore');
  const hours = clampTtlHours(ttlHours);
  return {
    response,
    fetchedAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + hours * 3600 * 1000),
    ttlHours: hours,
    queryParams,
    hitCount: 0,
  };
}

/** Writes one entry. Resolves either way; a failed write is only logged. */
function writeEntry(db, key, fields, now = Date.now()) {
  if (!db) return Promise.resolve();
  return db.collection(COLLECTION).doc(key).set(buildEntry(fields, now))
    .catch((e) => console.warn('[CACHE] Write error:', e.message));
}

module.exports = { COLLECTION, MAX_TTL_HOURS, clampTtlHours, isFresh, readFresh, buildEntry, writeEntry };
