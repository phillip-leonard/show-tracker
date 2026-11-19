#!/usr/bin/env node
/**
 * count-festival-records — what the festival rules tightening has to allow
 * for (5.60.36, Stage 5; docs/ios-native/GATED-CLEANUPS.md). Read-only;
 * prints counts only, never an id, a name or any text from a document.
 *
 *   node scripts/count-festival-records.js
 *
 * Reads FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL and FIREBASE_PROJECT_ID
 * from .env / .env.local or the environment, as scan-show-decode.js does.
 *
 *   attendanceRecords  users/{uid}/festivals documents, and how many users
 *   unmigrated         records from before 5.30.0 (no festivalId): their
 *                      owners edit name and dates on the record itself,
 *                      which the tightened rule refuses. 0 before tightening,
 *                      or run admin-migrate-festivals (dry run first)
 *   dangling           records whose canonical festival is gone
 *   attendanceFields   how many records carry each field (the tightened
 *                      update rule allows notes, rating, myLineup, updatedAt)
 *   canonical          festivals documents: seeded (catalog) and user-made
 */

const path = require('path');
const fs = require('fs');

(function loadDotEnv() {
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
}());

async function main() {
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!privateKey || !clientEmail || !projectId) {
      console.error('FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL and FIREBASE_PROJECT_ID must be set (in .env or the environment).');
      process.exit(1);
    }
    initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
  }
  const db = getFirestore();

  const attendance = (await db.collectionGroup('festivals').get()).docs
    .filter((d) => /^users\/[^/]+\/festivals\/[^/]+$/.test(d.ref.path));
  const canonical = await db.collection('festivals').get();
  const canonicalIds = new Set(canonical.docs.map((d) => d.id));

  const fields = {};
  attendance.forEach((d) => Object.keys(d.data()).forEach((k) => { fields[k] = (fields[k] || 0) + 1; }));
  const seeded = canonical.docs.filter((d) => d.data().source === 'seed').length;

  console.log(JSON.stringify({
    attendanceRecords: attendance.length,
    users: new Set(attendance.map((d) => d.ref.path.split('/')[1])).size,
    unmigrated: attendance.filter((d) => !d.data().festivalId).length,
    dangling: attendance.filter((d) => d.data().festivalId && !canonicalIds.has(d.data().festivalId)).length,
    attendanceFields: fields,
    canonical: canonical.size,
    seeded,
    userMade: canonical.size - seeded,
  }, null, 2));
}

main().catch((err) => { console.error(err.message); process.exit(1); });
