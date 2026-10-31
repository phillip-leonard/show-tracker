/**
 * jobTrigger — starting a background function so that only we can start it.
 * Anyone can POST to a function URL, so a background function runs only for a
 * one-shot nonce written to jobTriggers/{nonce} with the admin SDK (clients
 * can't write there). The same scheme followed-band-notifications.js uses.
 */

const crypto = require('crypto');

const TRIGGER_TTL_MS = 10 * 60 * 1000;

/** Write a nonce and POST it to the background function. Extra fields travel on the trigger doc. */
async function startBackgroundJob(db, job, fn, extra = {}) {
  const nonce = crypto.randomBytes(24).toString('hex');
  await db.collection('jobTriggers').doc(nonce).set({ ...extra, job, createdAtMs: Date.now() });
  const base = process.env.URL || 'https://mysetlists.net';
  const res = await fetch(`${base}/.netlify/functions/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce }),
  });
  return res.status;
}

/** The trigger's fields if this request carries a fresh nonce for `job`, else null. Single use. */
async function claimJobTrigger(db, event, job) {
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* no body */ }
  const nonce = String(body.nonce || '');
  if (!/^[a-f0-9]{32,64}$/.test(nonce)) return null;
  const ref = db.collection('jobTriggers').doc(nonce);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.delete();
  const t = snap.data();
  return t.job === job && Date.now() - (t.createdAtMs || 0) < TRIGGER_TTL_MS ? t : null;
}

module.exports = { startBackgroundJob, claimJobTrigger };
