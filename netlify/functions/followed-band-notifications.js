// netlify/functions/followed-band-notifications.js
//
// Scheduled daily (netlify.toml). Starts the followed-band run in
// followed-band-notifications-background.js, which does the work: a
// scheduled function gets 30 seconds, and a run makes one or two
// Ticketmaster calls per followed band at four a second.
//
// Anyone can POST to a function URL, so the background function only runs
// for a one-shot nonce this function writes to jobTriggers/{nonce} with the
// admin SDK. Clients can't write there (firestore.rules has no match for
// it, so it is denied). "Run now" on this function in the Netlify UI is
// the manual trigger.

const crypto = require('crypto');
const { getDb } = require('./lib/firebaseAdmin');

exports.handler = async function () {
  const db = getDb();
  const nonce = crypto.randomBytes(24).toString('hex');
  await db.collection('jobTriggers').doc(nonce).set({
    job: 'followed-band-notifications',
    createdAtMs: Date.now(),
  });
  const base = process.env.URL || 'https://mysetlists.net';
  const res = await fetch(`${base}/.netlify/functions/followed-band-notifications-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce }),
  });
  console.log(`[followedBands] background run requested: HTTP ${res.status}`);
  return { statusCode: 200, body: '' };
};
