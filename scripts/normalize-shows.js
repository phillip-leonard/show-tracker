#!/usr/bin/env node
/**
 * normalize-shows — the normalize-show sweep, run by hand (5.60.5).
 *
 *   node scripts/normalize-shows.js            # dry run: counts only, writes nothing
 *   node scripts/normalize-shows.js --apply    # write the fixes
 *
 * The same two passes as the hourly normalize-shows-sweep function
 * (netlify/functions/lib/showSweep.js):
 *   pending  shows written with needsNormalization, normalized from their
 *            own saved input (none exist until the app uses normalize-show,
 *            Part 1b)
 *   stored   every show: the date as ISO, isManual by the buildShowDoc
 *            rule, a missing setlist as []. Never a user's rating, comment,
 *            setlist or anything else they wrote. Also counts the shows
 *            carrying normalizationError (5.60.7): ones the pending pass
 *            gave up on because the server refused their input, by code.
 *
 * The dry run also prints the shape report: how stored shows differ from
 * the canonical shape new documents have (lib/showInputs.js), by field.
 * Informational; nothing writes those.
 *
 * Idempotent: a second --apply finds nothing. Counts only: no names, ids
 * or addresses. Credentials come from .env, same as the other scripts.
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

async function main() {
  const apply = process.argv.includes('--apply');
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const { getAuth } = require('firebase-admin/auth');
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
  const { sweepPending, sweepStored, shapeReport } = require('../netlify/functions/lib/showSweep');
  const emailFor = async (uid) => { try { return (await getAuth().getUser(uid)).email || null; } catch { return null; } };

  let pending;
  try {
    pending = await sweepPending(db, { write: apply, emailFor, FieldValue });
  } catch (err) {
    // The collection-group index on needsNormalization (firestore.indexes.json)
    // is deployed with the rules; until it has built, this query fails.
    pending = { error: err.message.split('\n')[0] };
  }
  const stored = await sweepStored(db, { write: apply });

  console.log('Pending (needsNormalization):', JSON.stringify(pending));
  console.log(`Stored: ${stored.scanned} shows, ${stored.changed} to fix`, JSON.stringify(stored.byField));
  const errs = stored.normalizationError;
  console.log(`normalizationError: ${errs.total} show${errs.total === 1 ? '' : 's'} the sweep couldn't normalize${errs.total ? ` ${JSON.stringify(errs.byCode)}` : ''}`);
  if (!apply) {
    const shape = await shapeReport(db);
    console.log(`\nShape (informational, never written): ${shape.differ} of ${shape.scanned} stored shows differ from the shape new documents have`);
    Object.entries(shape.byField).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));
    console.log('\nDry run: nothing written. --apply writes the fixes.');
    return;
  }
  const again = await sweepStored(db, { write: false });
  console.log(`\nWritten. A re-check finds ${again.changed} still to fix.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error('Failed:', err.message); process.exit(1); });
