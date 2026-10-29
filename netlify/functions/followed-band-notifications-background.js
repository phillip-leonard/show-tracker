// netlify/functions/followed-band-notifications-background.js
//
// The daily followed-band run: new-tour alerts and bucket-list venue
// matches for every band someone follows. What it decides, and why nobody
// is told twice, is in lib/followedBandAlerts.js; this file only connects
// it to Firestore, Ticketmaster, Resend and push (FCM: iOS and web).
//
// Replaces venue-bucket-list-notifications.js (5.24.0–5.45.x), which wrote
// its notification with set(merge) and emailed on every run, so the same
// match was re-sent each morning until the show. Its notification ids are
// kept, so nothing it already sent is sent again.
//
// Started only by followed-band-notifications.js, with a one-shot nonce
// from jobTriggers/{nonce} (deleted before the run, ignored after 10
// minutes). A background function: Netlify answers 202 at once and allows
// 15 minutes; the run stops taking new bands at 12.

const { getDb } = require('./lib/firebaseAdmin');
const { sendNotificationEmail } = require('./lib/outgoingEmail');
const { fetchArtistEvents } = require('./lib/ticketmasterEvents');
const { runFollowedBandJob } = require('./lib/followedBandAlerts');

const TOKEN_TTL_MS = 10 * 60 * 1000;
const RUN_BUDGET_MS = 12 * 60 * 1000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function claimNonce(db, event) {
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* no body */ }
  const nonce = String(body.nonce || '');
  if (!/^[a-f0-9]{32,64}$/.test(nonce)) return false;
  const ref = db.collection('jobTriggers').doc(nonce);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  const t = snap.data();
  return t.job === 'followed-band-notifications' && Date.now() - (t.createdAtMs || 0) < TOKEN_TTL_MS;
}

exports.handler = async function (event) {
  const db = getDb();
  if (!(await claimNonce(db, event))) {
    console.warn('[followedBands] refused: missing or stale trigger');
    return { statusCode: 403, body: '' };
  }
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    console.warn('[followedBands] skipped: TICKETMASTER_API_KEY not configured');
    return { statusCode: 200, body: '' };
  }
  const affiliateId = process.env.TICKETMASTER_AFFILIATE_ID;
  const { FieldValue } = require('firebase-admin/firestore');
  const started = Date.now();

  const totals = await runFollowedBandJob({
    db,
    fetchEvents: (name, ledger) => fetchArtistEvents(name, { apiKey, affiliateId, attractionId: ledger?.tmAttractionId || null }),
    // Ticketmaster allows 5 requests a second; a band costs up to two.
    pause: () => sleep(500),
    sendEmail: (msg) => sendNotificationEmail({ db, ...msg }),
    // One message for both kinds of token. On iOS, `data.link` is what a
    // tap opens (lib/pushAlerts.js hands it to lib/deepLinks.js); on the
    // web, fcmOptions.link does the same.
    sendPush: (token, { title, body, link, threadId, notificationId }) => require('firebase-admin/messaging').getMessaging().send({
      token,
      notification: { title, body },
      data: { link, notificationId },
      apns: { payload: { aps: { sound: 'default', 'thread-id': threadId } } },
      webpush: { fcmOptions: { link } },
    }),
    createdAt: FieldValue.serverTimestamp(),
    deadline: started + RUN_BUDGET_MS,
  });
  console.log('[followedBands] run finished', JSON.stringify({ ...totals, ms: Date.now() - started }));
  return { statusCode: 200, body: '' };
};
