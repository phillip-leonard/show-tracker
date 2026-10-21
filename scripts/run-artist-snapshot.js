#!/usr/bin/env node
'use strict';

/**
 * Manual trigger for the public band-page snapshot
 * (netlify/functions/lib/publicArtistSnapshot.js).
 *
 * Remote (default): writes a one-shot run token to the site's Blobs store
 * with the Netlify CLI (so it needs `netlify login` and a linked site,
 * nothing else), then asks the background function to run. The run itself
 * happens on Netlify, with Netlify's PHISHNET_API_KEY and SETLISTFM_API_KEY.
 * Watch it in the function log, or read the report afterwards with
 * --report.
 *
 * Local (--local): runs the same job in this process against live sources,
 * writing to a folder instead of Blobs. Keys come from the environment or
 * .env.local; phish.net is skipped without PHISHNET_API_KEY. For trying a
 * config change without touching the published snapshot.
 *
 * Usage:
 *   node scripts/run-artist-snapshot.js                      # due artists, on mysetlists.net
 *   node scripts/run-artist-snapshot.js --force              # every artist, incremental
 *   node scripts/run-artist-snapshot.js --full               # every artist, full history
 *   node scripts/run-artist-snapshot.js --artist=goose --artist=phish --force
 *   node scripts/run-artist-snapshot.js --site=https://deploy-preview-350--<site>.netlify.app --force
 *   node scripts/run-artist-snapshot.js --report             # print runs/latest.json
 *   node scripts/run-artist-snapshot.js --local --force [--dir=/tmp/artist-snapshot]
 *
 * The store is site-wide, so a run on a deploy preview publishes to the
 * same snapshot production reads.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const values = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));

const force = flag('full') ? 'full' : flag('force');
const only = values('artist');
const site = (values('site')[0] || 'https://mysetlists.net').replace(/\/+$/, '');

function netlify(cliArgs, opts = {}) {
  return execFileSync('netlify', cliArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

function loadEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function folderStore(dir) {
  const file = (key) => path.join(dir, key);
  return {
    async get(key) {
      try { return JSON.parse(fs.readFileSync(file(key), 'utf8')); } catch { return null; }
    },
    async set(key, value) {
      fs.mkdirSync(path.dirname(file(key)), { recursive: true });
      fs.writeFileSync(file(key), JSON.stringify(value));
    },
    async delete(key) { fs.rmSync(file(key), { force: true }); },
  };
}

async function main() {
  if (flag('report')) {
    process.stdout.write(netlify(['blobs:get', 'public-artists', 'runs/latest.json']));
    return;
  }

  if (flag('local')) {
    loadEnvLocal();
    const { runSnapshot } = require('../netlify/functions/lib/publicArtistSnapshot');
    const dir = path.resolve(values('dir')[0] || path.join(os.tmpdir(), 'mysetlists-artist-snapshot'));
    const report = await runSnapshot({ store: folderStore(dir), force, only: only.length ? only : null });
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nWritten to ${dir}`);
    return;
  }

  const nonce = crypto.randomBytes(24).toString('hex');
  const token = { createdAt: new Date().toISOString(), force, only: only.length ? only : null, by: 'scripts/run-artist-snapshot.js' };
  netlify(['blobs:set', 'public-artists', `trigger/${nonce}`, JSON.stringify(token)]);

  const res = await fetch(`${site}/.netlify/functions/public-artist-snapshot-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce }),
  });
  console.log(`Run requested on ${site}: HTTP ${res.status}${res.status === 202 ? ' (accepted; runs in the background)' : ''}`);
  console.log('Read the result when it finishes with: node scripts/run-artist-snapshot.js --report');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
