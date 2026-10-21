'use strict';

/**
 * Netlify Function: run-tests
 *
 * Executes the pre-deploy API health checks and returns a JSON report.
 * This function is useful for:
 *   - Manual "are the APIs up?" checks via webhook
 *   - Netlify deploy notifications (call after deploy via webhook)
 *   - CI pipelines that want a JSON health report
 *
 * Note: Browser-based (Playwright) tests cannot run inside a Netlify Function.
 * Those run separately in GitHub Actions. This function covers the API-level
 * health checks that don't require a browser.
 *
 * Call: POST /.netlify/functions/run-tests
 *       Authorization: Bearer <ADMIN_SECRET>
 *
 * Response 200: { success: true, results: [...], summary: {...} }
 * Response 207: { success: false, results: [...], summary: {...} }  (partial failures)
 * Response 401: { error: "Unauthorized" }
 */

const https = require('https');
const { setlistfmKey } = require('./lib/setlistfmKey');

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── HTTP helper ──────────────────────────────────────────────────────────────

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'MySetlists-RunTests/1.0 (contact@mysetlists.net)',
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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 10s'));
    });
  });
}

// ── Individual checks ────────────────────────────────────────────────────────

async function checkSetlistFmApi() {
  // No fallback key (see lib/setlistfmKey.js). Reported as a failed check
  // rather than a 500, so the rest of the run still reports.
  if (!setlistfmKey()) {
    console.error('SETLISTFM_API_KEY is not set');
    return { name: 'setlist.fm API', passed: false, reason: 'SETLISTFM_API_KEY not configured' };
  }
  const apiKey = setlistfmKey();
  const { statusCode } = await httpsGet(
    'https://api.setlist.fm/rest/1.0/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711',
    { Accept: 'application/json', 'x-api-key': apiKey }
  );
  const ok = [200, 404].includes(statusCode); // 404 = API up, just artist not found
  return { name: 'setlist.fm API', passed: ok, statusCode };
}

async function checkSpotifyApi() {
  const { statusCode } = await httpsGet(
    'https://accounts.spotify.com/api/token'
  );
  const ok = [200, 400, 401].includes(statusCode);
  return { name: 'Spotify accounts API', passed: ok, statusCode };
}

async function checkNotionApi() {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    return {
      name: 'Notion API',
      passed: true,
      skipped: true,
      reason: 'NOTION_API_KEY not configured',
    };
  }
  const { statusCode } = await httpsGet(
    'https://api.notion.com/v1/users/me',
    {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
    }
  );
  const ok = [200, 401, 403].includes(statusCode);
  return { name: 'Notion API', passed: ok, statusCode };
}

async function checkResendApi() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      name: 'Resend (email) API',
      passed: true,
      skipped: true,
      reason: 'RESEND_API_KEY not configured — email sending disabled',
    };
  }
  const { statusCode } = await httpsGet('https://api.resend.com/emails', {
    Authorization: `Bearer ${apiKey}`,
  });
  // 405 = Method Not Allowed (GET on /emails) — API is up
  const ok = [200, 400, 401, 403, 405].includes(statusCode);
  return { name: 'Resend (email) API', passed: ok, statusCode };
}

function checkEnvVars() {
  const required = ['REACT_APP_FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID'];
  const missing = required.filter((v) => !process.env[v]);
  return {
    name: 'Required environment variables',
    passed: missing.length === 0,
    missing: missing.length > 0 ? missing : undefined,
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Simple auth check — caller must supply the admin secret
  const adminSecret = process.env.TEST_ADMIN_SECRET;
  if (adminSecret) {
    const authHeader = event.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ') || authHeader.slice(7) !== adminSecret) {
      return {
        statusCode: 401,
        headers: HEADERS,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }
  }

  const startTime = Date.now();
  console.log('[run-tests] Starting API health checks...');

  const results = await Promise.allSettled([
    checkEnvVars(),
    checkSetlistFmApi(),
    checkSpotifyApi(),
    checkNotionApi(),
    checkResendApi(),
  ]);

  const checks = results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : { name: 'unknown', passed: false, error: r.reason?.message }
  );

  const duration = Date.now() - startTime;
  const allPassed = checks.every((c) => c.passed);
  const failedChecks = checks.filter((c) => !c.passed);

  const summary = {
    passed: checks.filter((c) => c.passed).length,
    failed: failedChecks.length,
    total: checks.length,
    duration,
    allPassed,
    environment: process.env.ENVIRONMENT || 'production',
    timestamp: new Date().toISOString(),
  };

  console.log('[run-tests] Results:', JSON.stringify(summary));

  // Report to Notion if configured
  if (process.env.NOTION_API_KEY && process.env.NOTION_TEST_DATABASE_ID) {
    try {
      const notionBody = JSON.stringify({
        parent: { database_id: process.env.NOTION_TEST_DATABASE_ID },
        properties: {
          'Test Run': {
            title: [
              {
                text: {
                  content: `API Health — ${new Date().toISOString().split('T')[0]}`,
                },
              },
            ],
          },
          Passed: { number: summary.passed },
          Failed: { number: summary.failed },
          Total: { number: summary.total },
          Duration: { number: duration },
          Status: { select: { name: allPassed ? 'Pass' : 'Fail' } },
          Suite: { rich_text: [{ text: { content: 'API Health Checks' } }] },
          Environment: {
            select: { name: process.env.ENVIRONMENT || 'production' },
          },
        },
      });

      await new Promise((resolve) => {
        const req = https.request(
          {
            hostname: 'api.notion.com',
            path: '/v1/pages',
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(notionBody),
            },
          },
          (res) => {
            res.on('data', () => {});
            res.on('end', resolve);
          }
        );
        req.on('error', () => resolve());
        req.write(notionBody);
        req.end();
      });
    } catch (e) {
      console.warn('[run-tests] Notion reporting failed:', e.message);
    }
  }

  return {
    statusCode: allPassed ? 200 : 207,
    headers: HEADERS,
    body: JSON.stringify({ success: allPassed, results: checks, summary }),
  };
};
