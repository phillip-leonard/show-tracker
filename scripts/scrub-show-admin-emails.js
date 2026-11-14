#!/usr/bin/env node
'use strict';

/**
 * Remove the admin's email address from show documents (5.60.3).
 *
 * Until 5.60.3, admin-bulk-import.js stamped every show it wrote with
 * `importedByAdmin: <the admin's email>`. Show documents are readable by
 * the owner's friends (firestore.rules, users/{uid}/shows), so that broke
 * the rule that no document other users can read carries an address.
 * 5.60.3 writes `importedByAdmin: true` instead; this replaces the copies
 * already stored with the same `true`. Who ran each import is still in
 * adminAuditLog (performedByUid), which only the admin can read.
 *
 * It also reports, as counts by field name, any other top-level show field
 * holding something shaped like an email address, so a second leak would
 * show up here. It changes only `importedByAdmin`.
 *
 *   node scripts/scrub-show-admin-emails.js           # dry run: counts only
 *   node scripts/scrub-show-admin-emails.js --apply   # write the fix
 *
 * Idempotent: a re-run after --apply finds nothing to change. Logs counts,
 * never addresses, user ids or show ids. Run it after the 5.60.3 deploy is
 * live, so nothing writes the field back. Credentials come from .env, same
 * as scripts/strip-profile-emails.js, or from the environment.
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

const EMAILISH = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const BATCH = 400;

/** What the scan found, as counts only. Pure, so it can be tested. */
function planScrub(docs) {
  const toFix = [];
  const otherFields = {};
  let flagged = 0;
  for (const d of docs) {
    const data = d.data() || {};
    if (typeof data.importedByAdmin === 'string') toFix.push(d);
    else if (data.importedByAdmin === true) flagged++;
    for (const [field, value] of Object.entries(data)) {
      if (field === 'importedByAdmin') continue;
      if (typeof value === 'string' && EMAILISH.test(value)) otherFields[field] = (otherFields[field] || 0) + 1;
    }
  }
  return { scanned: docs.length, toFix, alreadyFlagged: flagged, otherFields };
}

async function main() {
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const apply = process.argv.includes('--apply');

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
  const snap = await db.collectionGroup('shows').get();
  const plan = planScrub(snap.docs);

  console.log(`${plan.scanned} show documents scanned`);
  console.log(`  importedByAdmin holding an address: ${plan.toFix.length}`);
  console.log(`  importedByAdmin already true:       ${plan.alreadyFlagged}`);
  const others = Object.entries(plan.otherFields);
  console.log(others.length
    ? `  other fields holding an address: ${others.map(([f, n]) => `${f} (${n})`).join(', ')} (not changed; report them)`
    : '  no other field holds an address');

  if (!apply) {
    console.log('\nDry run: nothing written. Re-run with --apply to replace the addresses with `true`.');
    return;
  }

  for (let i = 0; i < plan.toFix.length; i += BATCH) {
    const batch = db.batch();
    for (const d of plan.toFix.slice(i, i + BATCH)) batch.update(d.ref, { importedByAdmin: true });
    await batch.commit();
    console.log(`  fixed ${Math.min(i + BATCH, plan.toFix.length)} / ${plan.toFix.length}`);
  }

  const after = planScrub((await db.collectionGroup('shows').get()).docs);
  console.log(after.toFix.length === 0
    ? '\nDone: no show document carries an admin address.'
    : `\n${after.toFix.length} still carry one (written since the scan?). Run again.`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
}

module.exports = { planScrub };
