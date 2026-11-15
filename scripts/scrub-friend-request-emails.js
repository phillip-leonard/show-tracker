#!/usr/bin/env node
'use strict';

/**
 * Remove email addresses from friendRequests (5.60.12).
 *
 * Both people on a friend request can read it (firestore.rules,
 * friendRequests), and requests made before 5.59.7 carry `fromEmail` and
 * `toEmail`: each side could read the other's address. That breaks the
 * standing rule that no document other users can read holds an address
 * (CLAUDE.md, security invariants). Since 5.59.7 the rules refuse both
 * keys on create (`hasOnly(['from', 'to', 'fromName', 'toName', 'status',
 * 'createdAt'])`) and nothing reads them, so this deletes the old copies.
 * Nothing is lost: Firebase Auth holds every account's address.
 *
 *   node scripts/scrub-friend-request-emails.js           # dry run: counts only
 *   node scripts/scrub-friend-request-emails.js --apply   # delete the fields
 *
 * Credentials come from .env, same as scripts/strip-profile-emails.js.
 */

(function loadDotEnv() {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

const FIELDS = ['fromEmail', 'toEmail'];
const BATCH = 400;

/** The address fields this document still carries (present, even if empty). */
function emailFieldsOf(data) {
  return FIELDS.filter((f) => data && Object.prototype.hasOwnProperty.call(data, f));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
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

  console.log(apply ? 'APPLY: deleting the fields' : 'DRY RUN: nothing is written (pass --apply to write)');
  const snap = await db.collection('friendRequests').get();
  const targets = snap.docs.map((d) => ({ ref: d.ref, fields: emailFieldsOf(d.data()) })).filter((t) => t.fields.length);
  console.log(`${snap.size} friend requests; ${targets.length} still carry an address field`);
  for (const f of FIELDS) console.log(`  ${f}: ${targets.filter((t) => t.fields.includes(f)).length}`);

  if (!apply || !targets.length) return;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = db.batch();
    for (const t of targets.slice(i, i + BATCH)) {
      batch.update(t.ref, Object.fromEntries(t.fields.map((f) => [f, FieldValue.delete()])));
    }
    await batch.commit();
  }
  const after = await db.collection('friendRequests').get();
  const left = after.docs.filter((d) => emailFieldsOf(d.data()).length).length;
  console.log(left === 0 ? 'Done: no friend request carries an address.' : `${left} still carry an address (written since the scan?). Run again.`);
}

module.exports = { emailFieldsOf, FIELDS };

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
