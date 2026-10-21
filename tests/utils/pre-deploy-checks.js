#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * Pre-deploy health checks — runs during Netlify build (no browser required).
 *
 * Checks:
 *   1. Required environment variables are present
 *   2. External APIs (setlist.fm, Spotify auth) are reachable
 *   3. Netlify function files exist and have no obvious syntax errors
 *
 * Exit code 0 = all checks passed (deploy proceeds)
 * Exit code 1 = one or more checks failed (deploy is blocked)
 *
 * Add to netlify.toml:
 *   command = "npm run build && node tests/utils/pre-deploy-checks.js"
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function pass(name) {
  console.log(`  ✓ ${name}`);
  passed++;
}

function fail(name, reason) {
  console.error(`  ✗ ${name}: ${reason}`);
  failed++;
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'MySetlists-PreDeployChecks/1.0 (contact@mysetlists.net)',
          ...headers,
        },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode, body: data })
        );
      }
    );
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Request timed out')));
  });
}

// ── Check 1: Required environment variables ──────────────────────────────────

function checkEnvVars() {
  console.log('\n1. Environment Variables');

  // Variables required for the build
  const required = ['REACT_APP_FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID'];
  for (const v of required) {
    if (process.env[v]) {
      pass(v);
    } else {
      fail(v, 'not set');
    }
  }

  // Variables that are important but optional — warn only
  const recommended = [
    'SETLISTFM_API_KEY',
    'RESEND_API_KEY',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
    'ANTHROPIC_API_KEY',
  ];
  for (const v of recommended) {
    if (process.env[v]) {
      pass(`${v} (optional)`);
    } else {
      console.warn(`  ⚠  ${v} not set (optional — some features may be limited)`);
    }
  }
  // Email (v5.38.0). Warn rather than fail: a missing value doesn't break
  // the site, it stops email — every send path refuses to go out without
  // UNSUBSCRIBE_SECRET, and announcements refuse without MAILING_ADDRESS.
  // Failing the build would block unrelated deploys until both are set.
  const email = {
    UNSUBSCRIBE_SECRET: 'no email will be sent — every email needs a signed unsubscribe link',
    MAILING_ADDRESS: 'announcements cannot be sent — CAN-SPAM requires a physical address',
  };
  for (const [v, consequence] of Object.entries(email)) {
    if (process.env[v]) {
      pass(v);
    } else {
      console.warn(`  ⚠  ${v} not set — ${consequence}. Set it in Netlify → Site settings → Environment variables.`);
    }
  }
  if (process.env.UNSUBSCRIBE_SECRET && process.env.UNSUBSCRIBE_SECRET.length < 32) {
    console.warn('  ⚠  UNSUBSCRIBE_SECRET is shorter than 32 characters — use a long random string.');
  }
}

// ── Check 2: Netlify function files exist ─────────────────────────────────────

function checkFunctionFiles() {
  console.log('\n2. Netlify Function Files');

  const functionsDir = path.join(process.cwd(), 'netlify', 'functions');
  const required = [
    'send-email.js',
    'unsubscribe.js',
    'update-email-preferences.js',
    'admin-send-announcement.js',
    'admin-list-unsubscribes.js',
    'search-setlists.js',
    'search-artists.js',
    'enrich-artist.js',
    'get-entity-info.js',
    'analyze-tickets.js',
    'spotify-token.js',
    'apple-music-token.js',
    'create-shared-collection.js',
    'get-shared-collection.js',
  ];

  for (const file of required) {
    const fullPath = path.join(functionsDir, file);
    if (fs.existsSync(fullPath)) {
      // Basic syntax check — require() will throw on parse errors
      try {
        // Clear cache to re-parse
        delete require.cache[require.resolve(fullPath)];
        require(fullPath);
        pass(file);
      } catch (e) {
        // Module load failures due to missing env vars are OK at build time
        if (
          e.message.includes('Cannot find module') &&
          !e.message.includes(fullPath)
        ) {
          pass(`${file} (loaded, missing optional dep: ${e.message})`);
        } else if (
          e.code === 'MODULE_NOT_FOUND' ||
          e.message.includes('firebase')
        ) {
          pass(`${file} (file exists, runtime dep missing — OK at build time)`);
        } else {
          fail(file, `syntax/load error: ${e.message}`);
        }
      }
    } else {
      fail(file, 'file not found');
    }
  }
}

// ── Check 3: External API reachability ───────────────────────────────────────

async function checkExternalApis() {
  console.log('\n3. External API Reachability');

  // setlist.fm
  try {
    const apiKey =
      process.env.SETLISTFM_API_KEY || '';
    const { statusCode } = await httpsGet(
      'https://api.setlist.fm/rest/1.0/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711',
      { Accept: 'application/json', 'x-api-key': apiKey }
    );
    if (statusCode === 200 || statusCode === 403) {
      // 403 = key problem but API is reachable
      pass(`setlist.fm API (${statusCode})`);
    } else {
      fail('setlist.fm API', `unexpected status ${statusCode}`);
    }
  } catch (e) {
    fail('setlist.fm API', e.message);
  }

  // Spotify accounts (just check the domain resolves)
  try {
    const { statusCode } = await httpsGet(
      'https://accounts.spotify.com/api/token'
    );
    // 400/401 = reachable but missing auth; 405 = GET not allowed (POST-only endpoint) — all fine
    if ([200, 400, 401, 405].includes(statusCode)) {
      pass(`Spotify accounts API (${statusCode})`);
    } else {
      fail('Spotify accounts API', `unexpected status ${statusCode}`);
    }
  } catch (e) {
    fail('Spotify accounts API', e.message);
  }

  // Notion API (if configured)
  if (process.env.NOTION_API_KEY) {
    try {
      const { statusCode } = await httpsGet('https://api.notion.com/v1/users/me', {
        Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      });
      if ([200, 401, 403].includes(statusCode)) {
        pass(`Notion API (${statusCode})`);
      } else {
        fail('Notion API', `unexpected status ${statusCode}`);
      }
    } catch (e) {
      fail('Notion API', e.message);
    }
  }
}

// ── Lambda env-var size check ─────────────────────────────────────────────────
// AWS Lambda rejects functions when the total env var payload exceeds 4 KB.
// Netlify only injects site-level env vars with "functions" scope into Lambda,
// but during the build process.env contains many additional system/build-only
// variables.  We query the Netlify API to measure only the vars that will
// actually be present in the deployed function environment.

async function fetchFunctionScopedEnvSize() {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  const siteId = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const accountId = process.env.ACCOUNT_ID;
  if (!token || !siteId || !accountId) return null;

  const https = require('https');
  const url = `https://api.netlify.com/api/v1/accounts/${accountId}/env?site_id=${siteId}`;

  return new Promise((resolve) => {
    const req = https.get(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (!Array.isArray(data)) { resolve(null); return; }

          let totalBytes = 0;
          const large = [];
          for (const v of data) {
            if (!v.scopes || !v.scopes.includes('functions')) continue;
            const val = v.values && v.values[0] ? v.values[0].value || '' : '';
            const size = Buffer.byteLength(v.key + '=' + val, 'utf8');
            totalBytes += size;
            if (size > 256) large.push({ key: v.key, bytes: size });
          }
          resolve({ totalBytes, large });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

async function checkEnvVarSize() {
  console.log('\n4. Lambda Environment Variable Size');
  const LAMBDA_LIMIT_BYTES = 4 * 1024; // 4 KB
  const WARN_THRESHOLD = 3 * 1024;     // Warn at 3 KB

  // Try the Netlify API first for an accurate count of function-scoped vars
  const apiResult = await fetchFunctionScopedEnvSize();

  let totalBytes;
  let large;

  if (apiResult) {
    totalBytes = apiResult.totalBytes;
    large = apiResult.large;
  } else {
    // Fallback: estimate from process.env, excluding known build-only vars
    totalBytes = 0;
    large = [];
    const buildOnlyPrefixes = [
      'npm_', 'NPM_', 'NVM_', 'NODE_', 'YARN_', 'PNPM_',
      'NETLIFY', 'BUILD_', 'DEPLOY_', 'CACHED_', 'INCOMING_',
      'CI', 'GITHUB_', 'GITLAB_', 'BITBUCKET_',
      'AWS_', 'LAMBDA_',
      'LANG', 'LC_',
      'GOPATH', 'GIMME_', 'GO_', 'GEM_', 'RUBY', 'BUNDLE_',
      'CPATH', 'C_INCLUDE', 'CPLUS_', 'LD_', 'LIBRARY_', 'PKG_CONFIG',
    ];
    const buildOnlyExact = new Set([
      'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'HOSTNAME',
      'PWD', 'OLDPWD', 'SHLVL', '_', 'TMPDIR', 'TEMP', 'TMP',
      'EDITOR', 'VISUAL', 'PAGER', 'LESS', 'MANPATH',
      'FEATURE_FLAGS',
      'URL', 'REPOSITORY_URL', 'HEAD', 'BRANCH', 'CONTEXT', 'REVIEW_ID',
      'COMMIT_REF', 'PULL_REQUEST', 'ENVIRONMENT',
      'NETLIFY_AUTH_TOKEN', 'SITE_ID', 'ACCOUNT_ID',
    ]);

    for (const [key, value] of Object.entries(process.env)) {
      if (buildOnlyExact.has(key)) continue;
      if (buildOnlyPrefixes.some((p) => key.startsWith(p))) continue;
      const size = Buffer.byteLength(key + '=' + (value || ''), 'utf8');
      totalBytes += size;
      if (size > 256) large.push({ key, bytes: size });
    }
  }

  if (totalBytes >= LAMBDA_LIMIT_BYTES) {
    const kb = (totalBytes / 1024).toFixed(1);
    const top = large
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5)
      .map(({ key, bytes }) => `${key} (${(bytes / 1024).toFixed(1)} KB)`)
      .join(', ');
    fail(
      'Lambda env var size',
      `${kb} KB exceeds the 4 KB limit — deploy will fail at function upload.\n` +
      `  Largest variables: ${top}\n` +
      `  Fix: in Netlify dashboard → Environment variables, change the scope of\n` +
      `  large secrets (e.g. APPLE_MUSIC_PRIVATE_KEY, FIREBASE_ADMIN_PRIVATE_KEY)\n` +
      `  from "All scopes" to "Builds" only so they are not injected into functions.`
    );
  } else if (totalBytes >= WARN_THRESHOLD) {
    const kb = (totalBytes / 1024).toFixed(1);
    pass(`Lambda env var size (${kb} KB — approaching 4 KB limit, monitor this)`);
  } else {
    const kb = (totalBytes / 1024).toFixed(1);
    pass(`Lambda env var size (${kb} KB)`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 MySetlists Pre-Deploy Checks\n');
  console.log(`   Environment: ${process.env.ENVIRONMENT || 'production'}`);
  console.log(`   Node.js:     ${process.version}`);

  checkEnvVars();
  checkFunctionFiles();
  await checkExternalApis();
  await checkEnvVarSize();

  console.log('\n─────────────────────────────────────');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log('─────────────────────────────────────');

  if (failed > 0) {
    console.error('\n❌ Pre-deploy checks FAILED — deploy blocked.\n');
    process.exit(1);
  } else {
    console.log('\n✅ All pre-deploy checks passed.\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Pre-deploy checks crashed:', err);
  process.exit(1);
});
