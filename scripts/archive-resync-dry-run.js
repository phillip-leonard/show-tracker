#!/usr/bin/env node
'use strict';

/**
 * The Internet Archive backfill's dry run, from a laptop: every Grateful
 * Dead show in the database, what the Archive would propose for it, and
 * the diff. Writes nothing to any show — `dryRun` is forced on, whatever
 * else is passed — and runs the same walk as admin-resync-setlists.js
 * (runResync), so its report is the one a live run would act on.
 *
 * Archive lookups go through band-setlist.js's cache, so a lookup this
 * makes is cached in bandSetlistCache like any other, and a later live run
 * re-asks the Archive nothing.
 *
 *   node scripts/archive-resync-dry-run.js report.json
 *   node scripts/archive-resync-dry-run.js report.json --user <uid>
 *
 * Credentials come from .env, same as the seed script.
 */

const fs = require('fs');
const path = require('path');

(function loadDotEnv() {
  for (const name of ['.env', '.env.local']) {
    const file = path.join(__dirname, '..', name);
    if (!fs.existsSync(file)) continue;
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
  }
})();

const { runResync } = require('../netlify/functions/admin-resync-setlists');

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/archive-resync-dry-run.js <report.json> [--user <uid>]');
  process.exit(1);
}
const userFlag = process.argv.indexOf('--user');
const userId = userFlag > 0 ? process.argv[userFlag + 1] : undefined;

(async () => {
  const { report, error } = await runResync({
    dryRun: true,
    source: 'archive',
    limit: 1000,
    userId,
    // No Netlify window here; the Archive's one-request-a-second gap is
    // what sets the pace.
    budgetMs: 3 * 60 * 60 * 1000,
  });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  if (error) {
    console.error(`Stopped with an error: ${error} (partial report written to ${out})`);
    process.exit(1);
  }
  console.log(`${report.considered} Grateful Dead shows considered, ${report.wouldChange} would get a proposal, `
    + `${report.needsReview} need review, ${report.sourceReturnedNothing.length} with nothing from the Archive, `
    + `${report.errors.length} errors. Report: ${out}`);
})();
