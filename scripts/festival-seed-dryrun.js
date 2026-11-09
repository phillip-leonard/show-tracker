#!/usr/bin/env node
'use strict';

/**
 * Read-only dry run of the festival catalog seeder.
 *
 * Reads the production `festivals` collection with the Admin SDK, runs the
 * seeder's own planner (netlify/functions/lib/festivalSeed.js, the same code
 * admin-seed-festivals.js runs) over data/festival-seed.json, and prints the
 * plan as one table per action. WRITES NOTHING, and has no flag that would:
 * the only write path is the admin function with { "commit": true }, behind
 * the admin account's ID token (AdminView → "Seed festival catalog").
 *
 *   node scripts/festival-seed-dryrun.js                 # reads ./.env
 *   node scripts/festival-seed-dryrun.js --env ../.env.local
 *   node scripts/festival-seed-dryrun.js --json          # raw plan
 *   node scripts/festival-seed-dryrun.js --confidence verified,high
 *
 * Credentials come from FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
 * FIREBASE_PRIVATE_KEY, as for the Netlify functions.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const envArg = args.indexOf('--env');
const envFile = envArg >= 0 ? path.resolve(args[envArg + 1]) : path.join(__dirname, '..', '.env');

(function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
})(envFile);

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { planSeed, formatPlanReport } = require('../netlify/functions/lib/festivalSeed');
const { loadCatalog } = require('../netlify/functions/admin-seed-festivals');
const SEED = require('../data/festival-seed.json');

(async () => {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const { FIREBASE_CLIENT_EMAIL: clientEmail, FIREBASE_PROJECT_ID: projectId } = process.env;
  if (!privateKey || !clientEmail || !projectId) {
    console.error(`Firebase env vars not set (looked in ${envFile}). Pass --env <file>.`);
    process.exit(1);
  }
  initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });

  const confArg = args.indexOf('--confidence');
  const confidence = confArg >= 0 ? args[confArg + 1] : undefined;

  const catalog = await loadCatalog(getFirestore());
  const plan = planSeed(SEED.festivals, catalog, { confidence });
  if (args.includes('--json')) {
    console.log(JSON.stringify({ catalogCount: catalog.length, ...plan }, null, 2));
  } else {
    console.log(formatPlanReport(plan, { catalogCount: catalog.length }));
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
