#!/usr/bin/env node
/**
 * normalize-show-dates — rewrite every stored show date to ISO "YYYY-MM-DD"
 * (5.59.10, B-06 to B-09).
 *
 *   node scripts/normalize-show-dates.js            # dry run: counts only, writes nothing
 *   node scripts/normalize-show-dates.js --apply    # write the fixes
 *
 * What it does, per document in users/{uid}/shows:
 *   - already ISO                      → left alone (so a re-run changes nothing)
 *   - DD-MM-YYYY that reads one way    → rewritten to ISO
 *   - NN-NN-YYYY that could be read
 *     either way (03-04-2024)          → NOT guessed. Checked against the
 *                                        show's setlist.fm setlist (its
 *                                        eventDate is the truth). Confirmed
 *                                        → rewritten; anything else → the
 *                                        manual-review file
 *   - unpadded / with a time           → rewritten to ISO
 *   - anything unreadable              → the manual-review file
 *
 * Each rewrite also stores the old value as `dateNormalizedFrom`, so a
 * change can be traced or undone. Only `date` and that field are written.
 *
 * Output is counts only (by format, before and after). Shows that need a
 * person go to scripts/output/show-dates-review-<timestamp>.json as
 * { path, date, reason } — document paths and the stored date, nothing
 * else. Shows that become duplicates once their dates agree are counted,
 * not merged.
 *
 * Older iOS builds read both formats (parseDate has accepted DD-MM-YYYY
 * since long before 3.13.7), so this is safe to run while they're in use.
 * It never runs on its own: run it after the 5.59.10 deploy is live.
 *
 * Credentials come from .env (FIREBASE_*), plus SETLISTFM_API_KEY for the
 * ambiguous dates. Without that key the ambiguous dates are only counted.
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
const https = require('https');

const BATCH = 400;
const SETLISTFM_DELAY_MS = 600; // setlist.fm allows about 2 requests a second

let showDate = null;
async function loadShowDate() {
  if (!showDate) showDate = await import(path.join(__dirname, '..', 'lib', 'showDate.js'));
  return showDate;
}

/**
 * planDateFix(show, { lookupSetlistDate }) → one of
 *   { action: 'keep', shape }
 *   { action: 'fix', shape, to }
 *   { action: 'review', shape, reason }
 * lookupSetlistDate(setlistfmId) → ISO date from setlist.fm, '' when not
 * found, or null when it can't be asked (no key).
 */
async function planDateFix(show, { lookupSetlistDate } = {}) {
  const { storedDateShape, toIsoDate } = await loadShowDate();
  const raw = show.date;
  const shape = storedDateShape(raw);
  if (shape === 'iso') return { action: 'keep', shape };
  if (shape === 'missing' || shape === 'other') return { action: 'review', shape, reason: shape === 'missing' ? 'no date' : 'unreadable date' };
  if (shape !== 'ambiguous') {
    const to = toIsoDate(raw);
    return to ? { action: 'fix', shape, to } : { action: 'review', shape, reason: 'unreadable date' };
  }

  // NN-NN-YYYY with both parts ≤ 12: ask the source, never guess.
  const [a, b, y] = String(raw).split('-');
  const dayFirst = `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
  const monthFirst = `${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
  if (!show.setlistfmId) return { action: 'review', shape, reason: 'ambiguous, no setlist.fm id to check' };
  if (!lookupSetlistDate) return { action: 'review', shape, reason: 'ambiguous, setlist.fm not asked' };
  const truth = await lookupSetlistDate(show.setlistfmId);
  if (truth === null) return { action: 'review', shape, reason: 'ambiguous, SETLISTFM_API_KEY not set' };
  if (truth === dayFirst || truth === monthFirst) return { action: 'fix', shape, to: truth };
  return { action: 'review', shape, reason: truth ? 'ambiguous, setlist.fm date matches neither reading' : 'ambiguous, setlist.fm id not found' };
}

function httpsGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode !== 200) return reject(new Error(`setlist.fm ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

function setlistfmLookup() {
  const key = process.env.SETLISTFM_API_KEY;
  if (!key) return async () => null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return async (id) => {
    await sleep(SETLISTFM_DELAY_MS);
    const { fromSetlistfmDate } = await loadShowDate();
    const data = await httpsGetJson(`https://api.setlist.fm/rest/1.0/setlist/${encodeURIComponent(id)}`,
      { 'x-api-key': key, Accept: 'application/json' });
    return data ? fromSetlistfmDate(data.eventDate) : '';
  };
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
  const { toIsoDate } = await loadShowDate();
  const lookup = setlistfmLookup();

  console.log(apply ? 'APPLY: writing fixes' : 'DRY RUN: nothing is written (pass --apply to write)');
  if (!process.env.SETLISTFM_API_KEY) console.log('SETLISTFM_API_KEY is not set: ambiguous dates are only counted.');

  const snap = await db.collectionGroup('shows').get();
  const docs = snap.docs.filter((d) => /^users\/[^/]+\/shows\/[^/]+$/.test(d.ref.path));
  const before = {};
  const after = {};
  const reasons = {};
  const review = [];
  const fixes = [];
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };

  for (const d of docs) {
    const show = d.data();
    const plan = await planDateFix(show, { lookupSetlistDate: lookup });
    inc(before, plan.shape);
    if (plan.action === 'fix') { fixes.push({ ref: d.ref, from: show.date, to: plan.to }); inc(after, 'iso'); }
    else if (plan.action === 'keep') inc(after, 'iso');
    else { inc(after, plan.shape); inc(reasons, plan.reason); review.push({ path: d.ref.path, date: show.date ?? null, reason: plan.reason }); }
  }

  // Shows that become the same night once dates agree (counted, not merged).
  const groups = new Map();
  for (const d of docs) {
    const s = d.data();
    const fixed = fixes.find((f) => f.ref.path === d.ref.path);
    const iso = fixed ? fixed.to : toIsoDate(s.date);
    if (!iso) continue;
    const key = `${d.ref.parent.parent.id}|${String(s.artist || '').trim().toLowerCase()}|${String(s.venue || '').trim().toLowerCase()}|${iso}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const duplicates = [...groups.values()].reduce((n, c) => n + (c > 1 ? c - 1 : 0), 0);

  console.log(`\n${docs.length} shows`);
  console.log('Before, by stored format:', JSON.stringify(before));
  console.log(`After${apply ? '' : ' (if applied)'}, by stored format:`, JSON.stringify(after));
  console.log(`To rewrite: ${fixes.length}. Need a person: ${review.length}${review.length ? ' ' + JSON.stringify(reasons) : ''}.`);
  console.log(`Same night logged twice once dates agree: ${duplicates} (not merged; shown as duplicates in the app).`);

  if (review.length) {
    const dir = path.join(__dirname, 'output');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `show-dates-review-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(review, null, 2));
    console.log(`Manual review list: ${path.relative(process.cwd(), file)}`);
  }

  if (!apply || !fixes.length) return;
  let written = 0;
  for (let i = 0; i < fixes.length; i += BATCH) {
    const batch = db.batch();
    for (const f of fixes.slice(i, i + BATCH)) batch.update(f.ref, { date: f.to, dateNormalizedFrom: f.from });
    await batch.commit();
    written += Math.min(BATCH, fixes.length - i);
  }
  console.log(`Wrote ${written} dates.`);
}

module.exports = { planDateFix, loadShowDate };

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
