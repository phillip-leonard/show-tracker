/**
 * ticketCacheStore — the shared `ticketCache` documents (an artist's
 * upcoming Ticketmaster / SeatGeek dates), written only by the functions
 * that fetch them.
 *
 * Until 5.59.7 the browser wrote these after calling ticketmaster-events
 * or seatgeek-events, and firestore.rules let any signed-in user write
 * any of them, so anyone could put fake dates and ticket links in front
 * of every fan of a band (S-02). The functions now write the cache
 * themselves and the rules make it read-only to clients.
 *
 * Keys match lib/ticketEvents.js: `tm_<slug>` and `sg_<slug>`.
 * Best-effort: a cache write that fails never fails the request.
 */

const { getDb } = require('./firebaseAdmin');

function artistSlug(artistName) {
  return String(artistName || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
}

async function readTicketCache(key) {
  try {
    const snap = await getDb().collection('ticketCache').doc(key).get();
    return snap.exists ? snap.data() : null;
  } catch (e) {
    console.warn('[ticketCache] read failed:', e.message);
    return null;
  }
}

async function writeTicketCache(key, fields) {
  try {
    await getDb().collection('ticketCache').doc(key).set({ ...fields, cachedAt: new Date() });
  } catch (e) {
    console.warn('[ticketCache] write failed:', e.message);
  }
}

module.exports = { artistSlug, readTicketCache, writeTicketCache };
