// netlify/functions/onsale-scan-background.js
//
// The on-sale scan: what it decides, and why nobody is told twice, is in
// lib/onsaleAlerts.js; this file only connects it to Firestore, Ticketmaster,
// Resend and push. Started only by onsale-scan.js or the admin, with a one-shot
// nonce (lib/jobTrigger.js). A background function: Netlify answers 202 at once
// and allows 15 minutes; the run stops taking new bands at 12.
//
// Ticketmaster allows 5,000 calls a day and 5 a second. Four scans at MAX_BANDS
// is 3,600 of those, leaving room for the daily followed-band job. Bands not
// reached go first next run.
//
// It also retries emails whose parser never ran.

const { getDb } = require('./lib/firebaseAdmin');
const { claimJobTrigger } = require('./lib/jobTrigger');
const { sendNotificationEmail } = require('./lib/outgoingEmail');
const { fetchArtistEvents, findVenueLocation } = require('./lib/ticketmasterEvents');
const { runOnsaleScan } = require('./lib/onsaleAlerts');
const { lookupCity } = require('./lib/cityLookup');
const { parseStoredEmail } = require('./lib/presaleParser');
const { fcmMessage } = require('./lib/pushDelivery');

const RUN_BUDGET_MS = 12 * 60 * 1000;
const MAX_BANDS = 900;
const STUCK_PARSE_MS = 15 * 60 * 1000;
const MAX_PARSE_RETRIES = 10;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function retryStuckParses(db) {
  const snap = await db.collection('inboundEmails').where('status', '==', 'queued').get();
  const stuck = snap.docs
    .filter((d) => Date.now() - (d.data().receivedAtMs || 0) > STUCK_PARSE_MS)
    .slice(0, MAX_PARSE_RETRIES);
  for (const d of stuck) await parseStoredEmail({ db, emailId: d.id });
  return stuck.length;
}

exports.handler = async function (event) {
  const db = getDb();
  if (!(await claimJobTrigger(db, event, 'onsale-scan'))) {
    console.warn('[onsale] refused: missing or stale trigger');
    return { statusCode: 403, body: '' };
  }
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) console.warn('[onsale] TICKETMASTER_API_KEY not configured: scanning emailed shows only');
  const { FieldValue } = require('firebase-admin/firestore');
  const started = Date.now();

  const retried = await retryStuckParses(db);

  const totals = await runOnsaleScan({
    db,
    // No affiliate id: ticket links carry no affiliate parameter.
    fetchEvents: async (name, { attractionId }) => (apiKey ? fetchArtistEvents(name, { apiKey, attractionId }) : { events: [], attractionId: null }),
    locate: async (show) => lookupCity(show.city, show.state) || findVenueLocation(show, { apiKey }),
    pause: () => sleep(500),
    sendEmail: (msg) => sendNotificationEmail({ db, ...msg }),
    sendPush: (token, msg) => require('firebase-admin/messaging').getMessaging().send(fcmMessage(token, msg)),
    createdAt: FieldValue.serverTimestamp(),
    deadline: started + RUN_BUDGET_MS,
    maxBands: MAX_BANDS,
  });
  await db.collection('onsaleConfig').doc('lastScan').set({ ...totals, retried, atMs: Date.now(), ms: Date.now() - started });
  console.log('[onsale] run finished', JSON.stringify({ ...totals, retried, ms: Date.now() - started }));
  return { statusCode: 200, body: '' };
};
