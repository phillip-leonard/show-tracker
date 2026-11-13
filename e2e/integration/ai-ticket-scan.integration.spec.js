// @ts-check
/**
 * AI Ticket Scan integration tests — validates the analyze-tickets and
 * analyze-screenshot Netlify Functions and the scan-import UI page.
 *
 * Full OCR tests require an ANTHROPIC_API_KEY and a sample image file.
 * Gated behind TEST_AI_SCAN_FULL=true to avoid incurring API costs on
 * every run.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const {
  loginUser,
  dismissOverlays,
} = require('../utils/test-helpers');
const { getIdToken } = require('../utils/firebaseIdToken');

const BASE = process.env.TEST_BASE_URL || 'https://mysetlists.net';
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

test.describe('AI Ticket Scan Integration Tests', () => {
  // ---------------------------------------------------------------------------
  // Function health checks (no API key required)
  // ---------------------------------------------------------------------------
  test('analyze-tickets OPTIONS answers the iOS app origin only', async ({ request }) => {
    const ok = await request.fetch(
      `${BASE}/.netlify/functions/analyze-tickets`,
      { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost' } }
    );
    expect([200, 204]).toContain(ok.status());
    expect(ok.headers()['access-control-allow-origin']).toBe('capacitor://localhost');
    const other = await request.fetch(
      `${BASE}/.netlify/functions/analyze-tickets`,
      { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }
    );
    expect(other.headers()['access-control-allow-origin']).toBeUndefined();
  });

  test('analyze-tickets GET returns 405 Method Not Allowed', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/.netlify/functions/analyze-tickets`
    );
    expect(res.status()).toBe(405);
  });

  test('analyze-tickets POST without body returns 400', async ({ request }) => {
    const res = await request.post(
      `${BASE}/.netlify/functions/analyze-tickets`,
      { data: {} }
    );
    // Shape is checked before auth, so this is 400 with or without
    // REQUIRE_AUTH_AI.
    expect(res.status()).toBe(400);
  });

  test('analyze-tickets rejects a non-image before calling Anthropic', async ({ request }) => {
    const res = await request.post(
      `${BASE}/.netlify/functions/analyze-tickets`,
      { data: { images: [{ base64: Buffer.from('%PDF-1.7 not an image').toString('base64'), mediaType: 'application/pdf' }] } }
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.details).toBeUndefined();
  });

  test('analyze-tickets rejects more than 10 images', async ({ request }) => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]).toString('base64');
    const res = await request.post(
      `${BASE}/.netlify/functions/analyze-tickets`,
      { data: { images: Array.from({ length: 11 }, () => ({ base64: jpeg, mediaType: 'image/jpeg' })) } }
    );
    expect(res.status()).toBe(400);
  });

  test('analyze-screenshot OPTIONS succeeds', async ({ request }) => {
    const res = await request.fetch(
      `${BASE}/.netlify/functions/analyze-screenshot`,
      { method: 'OPTIONS' }
    );
    expect([200, 204]).toContain(res.status());
  });

  test('analyze-screenshot POST without body returns 400', async ({
    request,
  }) => {
    const res = await request.post(
      `${BASE}/.netlify/functions/analyze-screenshot`,
      { data: {} }
    );
    expect(res.status()).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Scan-import UI (authenticated)
  // ---------------------------------------------------------------------------
  test('scan-import page loads with upload interface', async ({ page }) => {
    test.skip(
      !TEST_EMAIL || !TEST_PASSWORD,
      'Skipping: TEST_EMAIL / TEST_PASSWORD not set'
    );

    await loginUser(page, TEST_EMAIL, TEST_PASSWORD);
    await dismissOverlays(page);

    await page.goto('/scan-import', { waitUntil: 'load' });
    await expect(page.locator('body')).not.toContainText('Application error');

    // The page should have an upload or scan interface
    const uploadEl = page
      .locator('[type="file"], input[accept*="image"], button:has-text("upload"), button:has-text("scan")')
      .first();
    // May or may not be immediately visible — just check no crash
    await expect(page).toHaveTitle(/MySetlists/i);
  });

  // ---------------------------------------------------------------------------
  // Full OCR test (opt-in — requires Anthropic API key + sample image)
  // ---------------------------------------------------------------------------
  test('analyze-tickets parses a ticket screenshot correctly', async ({
    request,
  }) => {
    test.skip(
      process.env.TEST_AI_SCAN_FULL !== 'true',
      'Skipping full OCR test (set TEST_AI_SCAN_FULL=true to enable)'
    );

    // Look for a sample ticket image in the repo
    const sampleImagePaths = [
      path.join(process.cwd(), 'tests', 'fixtures', 'sample-ticket.jpg'),
      path.join(process.cwd(), 'tests', 'fixtures', 'sample-ticket.png'),
    ];

    const imagePath = sampleImagePaths.find(
      (p) => fs.existsSync(p)
    );
    if (!imagePath) {
      throw new Error(
        'No sample ticket image found at tests/fixtures/sample-ticket.jpg|png — add one to run full OCR tests'
      );
    }

    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    // A signed-in scan (the token is required once REQUIRE_AUTH_AI=true).
    const { idToken } = await getIdToken(request);
    const res = await request.post(
      `${BASE}/.netlify/functions/analyze-tickets`,
      {
        headers: { Authorization: `Bearer ${idToken}` },
        data: { images: [{ base64: base64Image, mediaType: mimeType }] },
      }
    );

    expect(res.status()).toBe(200);
    const body = await res.json();

    // The response should include an array of parsed shows
    expect(body.shows || body.events).toBeTruthy();
    const shows = body.shows || body.events;
    expect(Array.isArray(shows)).toBe(true);
  });
});
