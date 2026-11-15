#!/usr/bin/env node
/**
 * normalize-tag-dates — rewrite the show date carried by every tag to ISO
 * "YYYY-MM-DD" (5.60.12, before the native app).
 *
 *   node scripts/normalize-tag-dates.js            # dry run: counts only, writes nothing
 *   node scripts/normalize-tag-dates.js --apply    # write the fixes
 *
 * normalize-show-dates.js (5.59.10) fixed users/{uid}/shows, but a tag
 * keeps its own copy of the show (`showData`), taken when it was sent. On
 * 2026-11-14, 108 of 127 showTags and 7 of 8 pendingEmailTags still carried
 * setlist.fm's DD-MM-YYYY. Readers accept both (lib/showDate.js), and
 * normalize-show normalizes a tag when it is accepted, so nothing is broken;
 * this is so no stored date anywhere needs the legacy reader.
 *
 * Per document in showTags and pendingEmailTags, the same decisions as
 * normalize-show-dates.js (planDateFix):
 *   - already ISO                   → left alone (a re-run changes nothing)
 *   - DD-MM-YYYY that reads one way → rewritten
 *   - NN-NN-YYYY that reads both
 *     ways (03-04-2024)             → checked, never guessed: first against
 *                                     the sender's own show with the same
 *                                     setlist.fm id (already normalized, and
 *                                     checked, by 5.59.10), then setlist.fm
 *                                     itself. Anything unconfirmed goes to
 *                                     the manual-review file.
 *   - anything unreadable           → the manual-review file
 *
 * Only `showData.date` and `showData.dateNormalizedFrom` (the old value, so
 * a change can be traced or undone) are written.
 *
 * Output is counts only. The review file holds document paths, the stored
 * date and the reason: no names or addresses.
 *
 * Credentials come from .env (FIREBASE_*), plus SETLISTFM_API_KEY for
 * ambiguous dates the sender's show can't settle.
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

const fs = require('fs');
const path = require('path');
const { planDateFix, setlistfmLookup, usableKey } = require('./normalize-show-dates');

const COLLECTIONS = ['showTags', 'pendingEmailTags'];
const BATCH = 400;

/**
 * senderShowLookup(readSenderShows) → (fromUid) → (setlistfmId) → ISO date,
 * '' when the sender has no show with that id, or null when they couldn't
 * be read. readSenderShows(uid) → [{ setlistfmId, date }]; read once per
 * sender.
 */
function senderShowLookup(readSenderShows) {
  const cache = new Map();
  return (fromUid) => async (setlistfmId) => {
    if (!fromUid || !setlistfmId) return '';
    if (!cache.has(fromUid)) cache.set(fromUid, Promise.resolve(readSenderShows(fromUid)).catch(() => null));
    const shows = await cache.get(fromUid);
    if (!shows) return null;
    const match = shows.find((s) => s && s.setlistfmId === setlistfmId && /^\d{4}-\d{2}-\d{2}$/.test(String(s.date || '')));
    return match ? match.date : '';
  };
}

/**
 * planTagDateFix(tag, { senderLookup, setlistfmLookup }) → planDateFix's
 * answer for the tag's showData, asking the sender's show first and
 * setlist.fm only when the sender's show can't settle an ambiguous date.
 */
async function planTagDateFix(tag, { senderLookup, lookupSetlistDate } = {}) {
  const show = (tag && tag.showData) || {};
  const fromSender = senderLookup ? senderLookup(tag && tag.fromUid) : null;
  const lookup = async (id) => {
    const own = fromSender ? await fromSender(id) : '';
    if (own) return own;
    return lookupSetlistDate ? lookupSetlistDate(id) : null;
  };
  return planDateFix(show, { lookupSetlistDate: lookup });
}

async function main() {
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
  const rawKey = process.env.SETLISTFM_API_KEY;
  const setlistfm = setlistfmLookup();
  const senderLookup = senderShowLookup(async (uid) => {
    const snap = await db.collection('users').doc(uid).collection('shows').get();
    return snap.docs.map((d) => ({ setlistfmId: d.get('setlistfmId'), date: d.get('date') }));
  });

  console.log(apply ? 'APPLY: writing fixes' : 'DRY RUN: nothing is written (pass --apply to write)');
  if (!rawKey) console.log('SETLISTFM_API_KEY is not set: ambiguous dates the sender\'s show can\'t settle are only counted.');
  else if (!usableKey(rawKey)) console.log('SETLISTFM_API_KEY is masked: paste the real key. Ambiguous dates the sender\'s show can\'t settle are only counted.');

  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const fixes = [];
  const review = [];
  for (const name of COLLECTIONS) {
    const snap = await db.collection(name).get();
    const before = {};
    const byStatus = {};
    const reasons = {};
    let toFix = 0;
    for (const d of snap.docs) {
      const tag = d.data();
      const plan = await planTagDateFix(tag, { senderLookup, lookupSetlistDate: setlistfm });
      inc(before, plan.shape);
      if (plan.action === 'fix') {
        toFix++;
        inc(byStatus, String(tag.status || 'none'));
        fixes.push({ ref: d.ref, from: tag.showData.date, to: plan.to });
      } else if (plan.action === 'review') {
        inc(reasons, plan.reason);
        review.push({ path: d.ref.path, date: tag.showData ? tag.showData.date ?? null : null, reason: plan.reason });
      }
    }
    console.log(`\n${name}: ${snap.size} documents`);
    console.log('  Stored format:', JSON.stringify(before));
    console.log(`  To rewrite: ${toFix}${toFix ? ` (by status ${JSON.stringify(byStatus)})` : ''}. Need a person: ${Object.values(reasons).reduce((a, b) => a + b, 0)}${Object.keys(reasons).length ? ' ' + JSON.stringify(reasons) : ''}.`);
  }

  if (review.length) {
    const dir = path.join(__dirname, 'output');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `tag-dates-review-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(review, null, 2));
    console.log(`\nManual review list: ${path.relative(process.cwd(), file)}`);
  }

  if (!apply || !fixes.length) return;
  let written = 0;
  for (let i = 0; i < fixes.length; i += BATCH) {
    const batch = db.batch();
    for (const f of fixes.slice(i, i + BATCH)) {
      batch.update(f.ref, { 'showData.date': f.to, 'showData.dateNormalizedFrom': f.from });
    }
    await batch.commit();
    written += Math.min(BATCH, fixes.length - i);
  }
  console.log(`\nWrote ${written} dates.`);
}

module.exports = { planTagDateFix, senderShowLookup };

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
