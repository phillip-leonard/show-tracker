// netlify/functions/anniversary-notifications.js
//
// Daily scheduled function: finds shows whose date falls on today's
// month-day in a past year, and creates an anniversary notification
// (Firestore doc, optional push, optional email) for the owning user,
// respecting their userProfiles/{uid}.notificationPrefs.anniversaries
// setting (default: enabled, both push and email). What it sends, and why
// nobody is told twice, is in lib/anniversaryAlerts.js; this file only
// connects it to Firestore, Resend and FCM (every device: lib/pushDelivery.js).
//
// No cron/scheduled-job infrastructure existed in this repo before this —
// see components/ReleaseNotesView.jsx's v5.16.0 note re: digest emails
// needing "a scheduled job that doesn't exist yet". This is that job,
// registered as a Netlify Scheduled Function via the `schedule` setting in
// netlify.toml (this repo's functions use the classic exports.handler
// style, not the v2 `export default` style that takes an inline
// `export const config = { schedule }`).
//
// Scale note: does a single collectionGroup('shows').get() across every
// user rather than an indexed per-day query, since this app is small
// (landing page copy: "14+ fans tracking their shows"). Revisit with a
// stored `monthDay` field + collectionGroup query filtered on it if the
// user base grows enough that a full daily scan gets expensive.

const { sendNotificationEmail } = require('./lib/outgoingEmail');
const { utcIsoDate } = require('./lib/anniversaryMatch');
const { findAnniversaries, deliverAnniversaries } = require('./lib/anniversaryAlerts');
const { loadPushTokens, fcmMessage } = require('./lib/pushDelivery');

function initFirebase() {
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  if (getApps().length > 0) return;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) throw new Error('Firebase env vars not configured');
  initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
}

exports.handler = async function () {
  initFirebase();
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const db = getFirestore();

  // UTC on purpose; see lib/anniversaryMatch.js for why that is right at
  // this job's hour.
  const todayISO = utcIsoDate();
  const year = Number(todayISO.slice(0, 4));

  const showsSnap = await db.collectionGroup('shows').get();
  const shows = [];
  showsSnap.forEach((docSnap) => {
    const uid = docSnap.ref.parent.parent?.id;
    if (uid) shows.push({ uid, showId: docSnap.id, show: docSnap.data() });
  });
  const matches = findAnniversaries(shows, todayISO);

  if (matches.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ processed: 0, notified: 0 }) };
  }

  const uids = Array.from(new Set(matches.map((m) => m.uid)));
  const profiles = new Map();
  await Promise.all(uids.map(async (uid) => {
    const snap = await db.collection('userProfiles').doc(uid).get();
    profiles.set(uid, snap.exists ? snap.data() : {});
  }));

  const totals = await deliverAnniversaries({
    db,
    matches,
    profiles,
    tokens: await loadPushTokens(db, profiles),
    year,
    createdAt: FieldValue.serverTimestamp(),
    // Opt-out check, signed unsubscribe footer and List-Unsubscribe headers
    // all live in lib/outgoingEmail.js, shared with every other send path.
    sendEmail: (msg) => sendNotificationEmail({ db, ...msg }),
    sendPush: (token, msg) => require('firebase-admin/messaging').getMessaging().send(fcmMessage(token, msg)),
  });
  console.log('[anniversary] run finished', JSON.stringify({ processed: matches.length, ...totals }));

  return { statusCode: 200, body: JSON.stringify({ processed: matches.length, notified: totals.created, ...totals }) };
};
