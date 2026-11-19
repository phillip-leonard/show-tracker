#!/usr/bin/env node
/**
 * cleanup-meetup-names — replaces email addresses stored as names on
 * meetups (5.60.38, Stage 6 call J).
 *
 * Until 5.60.38 the meetup card passed `user.displayName || user.email`, so
 * an account without a display name wrote its email address into
 * `meetups.createdByName`, `meetups.attendeeNames` and
 * `meetupComments.authorName`, on documents every account can read
 * (CLAUDE.md: no email address on any document other users can read).
 * Each such name becomes the person's display name, or "Someone" (a
 * message: "Anonymous", as moderate-content names them).
 *
 *   node scripts/cleanup-meetup-names.js            dry run: counts only
 *   node scripts/cleanup-meetup-names.js --apply    writes the fixes
 *
 * Prints counts only, never an id, a name or an address. Run the dry run
 * first; run --apply after 5.60.38 is live (so nothing writes new ones).
 * Reads FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL and FIREBASE_PROJECT_ID
 * from .env / .env.local or the environment.
 */

const path = require('path');
const fs = require('fs');
const { looksLikeEmail, meetupName } = require('../netlify/functions/lib/meetupActions');

/**
 * The writes that fix one batch of documents. `profiles` maps uid → profile
 * (or undefined). Pure, so tests/security/socialServer.test.js runs it.
 *   meetups  [{ id, data }]  → [{ id, update: { createdByName?, attendeeNames? }, names }]
 *   comments [{ id, data }]  → [{ id, update: { authorName } }]
 */
function planMeetupFixes(meetups, profiles) {
  const nameFor = (uid) => meetupName(profiles.get(uid));
  return meetups.map(({ id, data }) => {
    const update = {};
    let names = 0;
    if (looksLikeEmail(data.createdByName)) {
      update.createdByName = nameFor(data.createdBy);
      names += 1;
    }
    const map = data.attendeeNames && typeof data.attendeeNames === 'object' && !Array.isArray(data.attendeeNames) ? data.attendeeNames : null;
    if (map && Object.values(map).some(looksLikeEmail)) {
      update.attendeeNames = Object.fromEntries(Object.entries(map).map(([uid, name]) => {
        if (!looksLikeEmail(name)) return [uid, name];
        names += 1;
        return [uid, nameFor(uid)];
      }));
    }
    return { id, update, names };
  }).filter((p) => Object.keys(p.update).length);
}

function planCommentFixes(comments, profiles) {
  return comments
    .filter(({ data }) => looksLikeEmail(data.authorName))
    .map(({ id, data }) => {
      const name = meetupName(profiles.get(data.authorUid));
      return { id, update: { authorName: name === 'Someone' ? 'Anonymous' : name } };
    });
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
  const apply = process.argv.includes('--apply');
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

  const meetups = (await db.collection('meetups').get()).docs.map((d) => ({ id: d.id, data: d.data() }));
  const comments = (await db.collection('meetupComments').get()).docs.map((d) => ({ id: d.id, data: d.data() }));

  // Profiles only for the people whose names need fixing.
  const uids = new Set();
  for (const { data } of meetups) {
    if (looksLikeEmail(data.createdByName) && data.createdBy) uids.add(data.createdBy);
    for (const [uid, name] of Object.entries(data.attendeeNames || {})) if (looksLikeEmail(name)) uids.add(uid);
  }
  for (const { data } of comments) if (looksLikeEmail(data.authorName) && data.authorUid) uids.add(data.authorUid);
  const profiles = new Map();
  for (const uid of uids) {
    const snap = await db.doc(`userProfiles/${uid}`).get();
    profiles.set(uid, snap.exists ? snap.data() : undefined);
  }

  const meetupFixes = planMeetupFixes(meetups, profiles);
  const commentFixes = planCommentFixes(comments, profiles);
  const people = uids.size;
  console.log(`meetups:          ${meetups.length} (${meetupFixes.length} with an email-shaped name, ${meetupFixes.reduce((n, p) => n + p.names, 0)} names)`);
  console.log(`meetup messages:  ${comments.length} (${commentFixes.length} with an email-shaped author name)`);
  console.log(`people affected:  ${people} (${[...profiles.values()].filter((p) => meetupName(p) !== 'Someone').length} have a display name to use instead)`);

  if (!apply) {
    console.log('\nDry run: nothing written. Run with --apply to replace them.');
    return;
  }
  const writes = [
    ...meetupFixes.map((p) => [db.doc(`meetups/${p.id}`), p.update]),
    ...commentFixes.map((p) => [db.doc(`meetupComments/${p.id}`), p.update]),
  ];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [ref, update] of writes.slice(i, i + 400)) batch.update(ref, update);
    await batch.commit();
  }
  console.log(`\nWrote ${writes.length} document(s).`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('cleanup-meetup-names failed:', e.message);
    process.exit(1);
  });
}

module.exports = { planMeetupFixes, planCommentFixes };
