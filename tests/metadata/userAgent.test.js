/**
 * One User-Agent for every outside data source (5.60.33): the functions name
 * themselves "MySetlists/<version> ( https://mysetlists.net;
 * support@mysetlists.net )" through netlify/functions/lib/userAgent.js, the
 * form MusicBrainz's rate-limit rules ask for. Read from the sources, so a
 * new function that hard-codes an agent fails here.
 *
 *   node tests/metadata/userAgent.test.js
 */
const { test, run } = require('../email/harness');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FUNCTIONS = path.join(__dirname, '..', '..', 'netlify', 'functions');
const { version } = require('../../package.json');
const { USER_AGENT } = require('../../netlify/functions/lib/userAgent');

// Calls to our own site, which may say which job is asking.
const OWN_SITE = new Set(['run-tests.js', 'admin-resync-setlists.js']);

function sources(dir = FUNCTIONS, rel = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === '__tests__') return [];
    const r = path.join(rel, e.name);
    if (e.isDirectory()) return sources(path.join(dir, e.name), r);
    return /\.(c|m)?js$/.test(e.name) ? [{ rel: r, text: fs.readFileSync(path.join(dir, e.name), 'utf8') }] : [];
  });
}

test('the agent names the app, its version and how to reach us', () => {
  assert.strictEqual(USER_AGENT, `MySetlists/${version} ( https://mysetlists.net; support@mysetlists.net )`);
});

test('no function sends the old generic agents', () => {
  const offenders = sources().filter((f) => /ShowTrackerApp|MySetlistsApp/.test(f.text)).map((f) => f.rel);
  assert.deepStrictEqual(offenders, []);
});

test('every User-Agent header is the shared one (our own site excepted)', () => {
  const offenders = [];
  for (const f of sources()) {
    if (OWN_SITE.has(path.basename(f.rel)) || f.rel === path.join('lib', 'userAgent.js')) continue;
    for (const m of f.text.matchAll(/['"]User-Agent['"]\s*:\s*([^,}\n]+)/g)) {
      if (m[1].trim() !== 'USER_AGENT') offenders.push(`${f.rel}: ${m[1].trim()}`);
    }
    if (/\bUSER_AGENT\b/.test(f.text)) {
      if (/const\s+USER_AGENT\s*=/.test(f.text)) offenders.push(`${f.rel}: its own USER_AGENT`);
      if (!/require\(['"]\.\.?\/(lib\/)?userAgent['"]\)/.test(f.text)) offenders.push(`${f.rel}: USER_AGENT not from lib/userAgent`);
    }
  }
  assert.deepStrictEqual(offenders, []);
});

run();
