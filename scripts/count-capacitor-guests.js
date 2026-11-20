#!/usr/bin/env node
/**
 * count-capacitor-guests — how many people would lose shows at cutover
 * (docs/ios-native/TESTFLIGHT.md, Q-02). Read-only; prints counts only,
 * never an id, a user agent or any other text from a document.
 *
 *   node scripts/count-capacitor-guests.js
 *
 * A Capacitor (or web) guest's shows live only in that app's storage, with a
 * `guestSessions` document as the only trace (context/AppContext.jsx
 * enterGuestMode). Installing the native app over the Capacitor app (same
 * bundle ID) leaves that storage behind, so a guest who never made an
 * account loses their shows. Native guests are accounts on anonymous auth
 * and aren't affected.
 *
 * Reads FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL and FIREBASE_PROJECT_ID
 * from .env / .env.local or the environment, as count-festival-records.js does.
 *
 *   total              guestSessions documents
 *   unconverted        never became an account
 *   withShows          unconverted and added at least one show
 *   iosApp             of those, on an iPhone or iPad in the app (a WebView
 *                      user agent has no "Safari/" token; Safari's does)
 *   iosAppShows        the shows those sessions added, summed
 *   iosAppLast30d/90d  of iosApp, sessions started in the last 30 / 90 days
 */

const path = require('path');
const fs = require('fs');

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Capacitor app's WebView: an Apple device without Safari's token. */
function isIosApp(userAgent) {
  const ua = String(userAgent || '');
  return /iPhone|iPad/.test(ua) && !/Safari\//.test(ua);
}

function startedAtMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const n = new Date(value).getTime();
  return Number.isNaN(n) ? 0 : n;
}

/** The counts for a list of guestSessions documents' data. */
function countGuests(sessions, now = Date.now()) {
  const c = { total: 0, unconverted: 0, withShows: 0, iosApp: 0, iosAppShows: 0, iosAppLast30d: 0, iosAppLast90d: 0 };
  for (const s of sessions || []) {
    c.total++;
    if (!s || s.converted) continue;
    c.unconverted++;
    const shows = Number(s.showsAdded) || 0;
    if (shows <= 0) continue;
    c.withShows++;
    if (!isIosApp(s.userAgent)) continue;
    c.iosApp++;
    c.iosAppShows += shows;
    const age = now - startedAtMs(s.startedAt);
    if (age < 30 * DAY_MS) c.iosAppLast30d++;
    if (age < 90 * DAY_MS) c.iosAppLast90d++;
  }
  return c;
}

function loadDotEnv() {
  for (const name of ['.env', '.env.local']) {
    const file = path.join(__dirname, '..', name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = raw.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      let value = m[2].trim();
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  }
}

async function main() {
  loadDotEnv();
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    console.error('Needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (.env.local).');
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId: FIREBASE_PROJECT_ID, clientEmail: FIREBASE_CLIENT_EMAIL, privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
  const snap = await getFirestore().collection('guestSessions').get();
  console.log(JSON.stringify(countGuests(snap.docs.map((d) => d.data())), null, 2));
}

if (require.main === module) {
  main().catch((err) => { console.error('count-capacitor-guests failed:', err.message); process.exit(1); });
}

module.exports = { countGuests, isIosApp };
