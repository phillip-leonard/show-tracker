#!/usr/bin/env node
'use strict';

/**
 * Remove email addresses from documents other users can read (5.59.7, S-01):
 * every userProfiles doc, and every roadmapItems doc.
 *
 * Every signed-in user can read every profile (names, counts and handles
 * are public in the app), and until 5.59.7 each profile also carried the
 * account's `email`, plus `invitedByEmail` (the inviter's address) on
 * invited accounts. Anyone signed in could list them all.
 *
 * 5.59.7 stops the app writing either field, firestore.rules refuses them,
 * and every server reader gets the address from Firebase Auth instead
 * (netlify/functions/lib/accountEmails.js). This deletes the copies
 * already stored. Nothing is lost: Auth holds every account's address.
 *
 * Roadmap items are readable by anyone, signed in or not, and carried
 * submitterEmail, contributors[].email and notifiedEmails. Those move to
 * roadmapItems/{id}/private/notifications (which no client can read, and
 * which notify-roadmap-completion.js now uses) and leave the item.
 *
 * Run it after the 5.59.7 deploy is live (so nothing writes them back):
 *
 *   node scripts/strip-profile-emails.js           # dry run: counts only
 *   node scripts/strip-profile-emails.js --yes     # delete the fields
 *
 * Credentials come from .env, same as scripts/purge-user.js.
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

const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const FIELDS = ['email', 'invitedByEmail'];
const WRITE = process.argv.includes('--yes');
const BATCH = 400;

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

const ROADMAP_FIELDS = ['submitterEmail', 'contributors', 'notifiedEmails'];

async function stripRoadmapItems(db) {
  const snap = await db.collection('roadmapItems').get();
  const targets = snap.docs.filter((d) => ROADMAP_FIELDS.some((f) => d.data()[f] !== undefined));
  console.log(`\n${snap.size} roadmap items; ${targets.length} still carry addresses`);
  if (!WRITE) return;
  const norm = (e) => String(e || '').trim().toLowerCase();
  for (const d of targets) {
    const it = d.data();
    const contributors = Array.isArray(it.contributors) ? it.contributors : [];
    const notified = [...(it.notifiedEmails || []), ...contributors.filter((c) => c.notified).map((c) => c.email)].map(norm).filter(Boolean);
    const pending = [it.submitterEmail, ...contributors.filter((c) => !c.notified).map((c) => c.email)].map(norm).filter((e) => e && !notified.includes(e));
    const privateRef = d.ref.collection('private').doc('notifications');
    const prev = (await privateRef.get()).data() || {};
    await privateRef.set({
      notifiedEmails: [...new Set([...(prev.notifiedEmails || []), ...notified])],
      legacyEmails: [...new Set([...(prev.legacyEmails || []), ...pending])],
      updatedAt: new Date(),
    }, { merge: true });
    await d.ref.update(Object.fromEntries(ROADMAP_FIELDS.map((f) => [f, FieldValue.delete()])));
  }
  console.log(`  moved addresses off ${targets.length} roadmap items`);
}

async function main() {
  const db = getFirestore();
  const snap = await db.collection('userProfiles').get();
  const targets = snap.docs.filter((d) => FIELDS.some((f) => d.data()[f] !== undefined));
  const counts = Object.fromEntries(FIELDS.map((f) => [f, targets.filter((d) => d.data()[f] !== undefined).length]));

  console.log(`${snap.size} profiles; ${targets.length} still carry an address`);
  for (const f of FIELDS) console.log(`  ${f}: ${counts[f]}`);

  if (!WRITE) {
    await stripRoadmapItems(db);
    console.log('\nDry run. Re-run with --yes to delete these fields.');
    return;
  }

  const del = Object.fromEntries(FIELDS.map((f) => [f, FieldValue.delete()]));
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = db.batch();
    for (const d of targets.slice(i, i + BATCH)) batch.update(d.ref, del);
    await batch.commit();
    console.log(`  cleared ${Math.min(i + BATCH, targets.length)} / ${targets.length}`);
  }

  await stripRoadmapItems(db);

  const after = await db.collection('userProfiles').get();
  const left = after.docs.filter((d) => FIELDS.some((f) => d.data()[f] !== undefined)).length;
  console.log(left === 0 ? '\nDone: no profile carries an address.' : `\n${left} profiles still carry an address (written since the scan?). Run again.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
