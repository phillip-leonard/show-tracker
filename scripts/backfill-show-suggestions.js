#!/usr/bin/env node
/**
 * backfill-show-suggestions — the "were you there together?" suggestions
 * the app never managed to create (5.60.11).
 *
 *   node scripts/backfill-show-suggestions.js            # dry run: the report, writes nothing
 *   node scripts/backfill-show-suggestions.js --apply    # write them
 *
 * Until 5.60.11 the app checked whether a suggestion existed with a read
 * the rules refuse for a document that doesn't exist, so it never created
 * one: production had none, though mutual friends shared many nights.
 * 5.60.11 makes them on the server for every new show; this makes them
 * once for the nights friends already share.
 *
 * What it writes, and doesn't:
 *   - one suggestion per pair of mutual friends per shared night, with the
 *     id the app always used (netlify/functions/lib/showSuggestions.js)
 *   - none for a night the two are already tagged together on, none
 *     across a block, none for the App Review accounts
 *   - in-app only: each is marked `backfill: true`, and send-email refuses
 *     the suggestion email for those (lib/emailAuthorization.js); nothing
 *     sends a push for a suggestion
 *   - one card per suggestion: the Friends page shows them one by one
 *     (with "accept all from <friend>"); a single grouped entry would need
 *     new UI
 *
 * The dry run reports how many each user would get, by uid (no names or
 * addresses), and flags anyone over FLAG_OVER. --apply refuses to run
 * until config/app.latestIosVersion is at least REQUIRED_IOS (the build
 * that shows them the new way), unless --skip-version-check.
 *
 * Idempotent: an existing suggestion is never overwritten (create, not
 * set), so a second --apply writes nothing. Credentials come from .env,
 * same as the other scripts.
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

const { planSuggestions, suggestionDoc } = require('../netlify/functions/lib/showSuggestions');
const { reviewAccountReason } = require('../netlify/functions/lib/reviewAccounts');

const REQUIRED_IOS = '3.13.27';
const FLAG_OVER = 10;

function versionAtLeast(v, min) {
  const p = (x) => String(x || '').split('.').map((n) => Number(n) || 0);
  const a = p(v);
  const b = p(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

/**
 * planBackfill({ friendEdges, blocked, showsByUid, existingIds, excludedUids })
 *   -> { pairs, suggestions: [{ docId, a, b, key, show }], skippedTagged, perUser }
 * friendEdges: ['a>b', …] (b is in a's list). blocked: Set of 'a|b'.
 * Pure, so the tests run it.
 */
function planBackfill({ friendEdges, blocked = new Set(), showsByUid, existingIds = new Set(), excludedUids = new Set() }) {
  const edges = new Set(friendEdges);
  const suggestions = [];
  const perUser = {};
  let pairs = 0;
  let skippedTagged = 0;
  const done = new Set();
  for (const edge of edges) {
    const [a, b] = edge.split('>');
    const pair = [a, b].sort().join('|');
    if (done.has(pair)) continue;
    done.add(pair);
    if (!edges.has(`${b}>${a}`) || blocked.has(`${a}|${b}`) || blocked.has(`${b}|${a}`)) continue;
    if (excludedUids.has(a) || excludedUids.has(b)) continue;
    pairs += 1;
    for (const p of planSuggestions({ myUid: a, myShows: showsByUid.get(a) || [], friendUid: b, friendShows: showsByUid.get(b) || [], existingIds })) {
      if (p.skipped) { skippedTagged += 1; continue; }
      suggestions.push({ docId: p.docId, a, b, key: p.key, show: p.show });
      perUser[a] = (perUser[a] || 0) + 1;
      perUser[b] = (perUser[b] || 0) + 1;
    }
  }
  return { pairs, suggestions, skippedTagged, perUser };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const skipVersion = process.argv.includes('--skip-version-check');
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

  const [friendsSnap, showsSnap, blocksSnap, suggestionsSnap, profilesSnap, configSnap] = await Promise.all([
    db.collectionGroup('friends').get(),
    db.collectionGroup('shows').get(),
    db.collection('userBlocks').get(),
    db.collection('showSuggestions').get(),
    db.collection('userProfiles').get(),
    db.doc('config/app').get(),
  ]);
  const friendEdges = [];
  friendsSnap.docs.forEach((d) => { const p = d.ref.path.split('/'); if (p.length === 4 && p[0] === 'users') friendEdges.push(`${p[1]}>${p[3]}`); });
  const blocked = new Set();
  blocksSnap.docs.forEach((d) => (d.data().blockedUserIds || []).forEach((b) => { blocked.add(`${d.id}|${b}`); }));
  const showsByUid = new Map();
  showsSnap.docs.forEach((d) => {
    const p = d.ref.path.split('/');
    if (p.length !== 4 || p[0] !== 'users' || p[2] !== 'shows') return;
    if (!showsByUid.has(p[1])) showsByUid.set(p[1], []);
    showsByUid.get(p[1]).push({ id: d.id, ...d.data() });
  });
  const profiles = new Map(profilesSnap.docs.map((d) => [d.id, d.data()]));
  const excludedUids = new Set([...profiles].filter(([, p]) => reviewAccountReason(p)).map(([id]) => id));
  const existingIds = new Set(suggestionsSnap.docs.map((d) => d.id));

  const plan = planBackfill({ friendEdges, blocked, showsByUid, existingIds, excludedUids });
  const users = Object.entries(plan.perUser).sort((x, y) => y[1] - x[1]);
  const flagged = users.filter(([, n]) => n > FLAG_OVER);

  console.log(`Mutual friend pairs: ${plan.pairs}. Existing suggestions: ${existingIds.size}.`);
  console.log(`Suggestions to create: ${plan.suggestions.length} (skipped ${plan.skippedTagged} nights already tagged together).`);
  console.log(`Per user (how many each would see; uid only):`);
  users.forEach(([uid, n]) => console.log(`  ${String(n).padStart(4)}  ${uid}${n > FLAG_OVER ? `   <-- over ${FLAG_OVER}` : ''}`));
  console.log(flagged.length ? `${flagged.length} user(s) over ${FLAG_OVER}.` : `Nobody over ${FLAG_OVER}.`);

  if (!apply) {
    console.log('\nDry run: nothing written. --apply writes them (after iOS ' + REQUIRED_IOS + ' is live).');
    return;
  }
  const latest = configSnap.exists ? configSnap.data().latestIosVersion : null;
  if (!skipVersion && !versionAtLeast(latest, REQUIRED_IOS)) {
    console.error(`\nNot applied: config/app.latestIosVersion is ${latest || 'unset'}; run this once iOS ${REQUIRED_IOS} is approved and live (or pass --skip-version-check).`);
    process.exit(1);
  }

  const names = (uid) => {
    const p = profiles.get(uid) || {};
    return String(p.displayName || p.firstName || 'Friend').slice(0, 80);
  };
  const now = new Date();
  let written = 0;
  let alreadyThere = 0;
  for (const s of plan.suggestions) {
    try {
      await db.collection('showSuggestions').doc(s.docId).create(
        suggestionDoc({ a: s.a, b: s.b, names: { [s.a]: names(s.a), [s.b]: names(s.b) }, show: s.show, key: s.key, now, backfill: true }),
      );
      written += 1;
    } catch (err) {
      if (err && (err.code === 6 || /ALREADY_EXISTS/.test(String(err.message)))) alreadyThere += 1;
      else throw err;
    }
  }
  console.log(`\nWrote ${written}${alreadyThere ? ` (${alreadyThere} already existed, left alone)` : ''}.`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => { console.error('Failed:', err.message); process.exit(1); });
}

module.exports = { planBackfill, versionAtLeast, REQUIRED_IOS, FLAG_OVER };
