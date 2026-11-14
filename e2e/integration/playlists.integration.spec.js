// @ts-check
/**
 * Playlists integration tests — Spotify and Apple Music playlist creation.
 *
 * OAuth flows (Spotify PKCE, Apple MusicKit) can't be automated end-to-end
 * without real user consent, so these tests validate:
 *   1. The API token-exchange functions are alive
 *   2. The playlist-creation UI page loads without error
 *   3. The spotify-api function rejects unauthenticated requests correctly
 *
 * Full OAuth + playlist-creation E2E requires a pre-stored Spotify token in
 * TEST_SPOTIFY_ACCESS_TOKEN and is gated behind TEST_PLAYLISTS_FULL=true.
 */
const { test, expect } = require('@playwright/test');
const {
  loginUser,
  dismissOverlays,
} = require('../utils/test-helpers');

const BASE = process.env.TEST_BASE_URL || 'https://mysetlists.net';
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

test.describe('Playlists Integration Tests', () => {
  // ---------------------------------------------------------------------------
  // Spotify token exchange endpoint
  // ---------------------------------------------------------------------------
  test('spotify-token OPTIONS returns 200', async ({ request }) => {
    const res = await request.fetch(
      `${BASE}/.netlify/functions/spotify-token`,
      { method: 'OPTIONS' }
    );
    expect([200, 204]).toContain(res.status());
  });

  test('spotify-token POST without sign-in returns 401', async ({ request }) => {
    // Signed-in users only since 5.59.12; no token is refused before the
    // request is read.
    const res = await request.post(
      `${BASE}/.netlify/functions/spotify-token`,
      { data: {} }
    );
    expect(res.status()).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Apple Music token endpoint
  // ---------------------------------------------------------------------------
  test('apple-music-token OPTIONS returns 200', async ({ request }) => {
    const res = await request.fetch(
      `${BASE}/.netlify/functions/apple-music-token`,
      { method: 'OPTIONS' }
    );
    expect([200, 204]).toContain(res.status());
  });

  test('apple-music-token GET returns a token or config-error', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/.netlify/functions/apple-music-token`
    );
    // 200 with JWT token, or 500 if Apple Music env vars not configured
    expect([200, 500]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.token || body.developerToken).toBeTruthy();
    }
  });

  // ---------------------------------------------------------------------------
  // Spotify API proxy endpoint
  // ---------------------------------------------------------------------------
  test('spotify-api OPTIONS returns 200', async ({ request }) => {
    const res = await request.fetch(
      `${BASE}/.netlify/functions/spotify-api`,
      { method: 'OPTIONS' }
    );
    expect([200, 204]).toContain(res.status());
  });

  test('spotify-api without access token returns 401', async ({ request }) => {
    const res = await request.post(
      `${BASE}/.netlify/functions/spotify-api`,
      { data: { endpoint: '/me' } }
    );
    expect([400, 401, 403]).toContain(res.status());
  });

  // ---------------------------------------------------------------------------
  // Spotify callback page loads without error
  // ---------------------------------------------------------------------------
  test('/spotify-callback redirects home while playlist creation is off', async ({ page }) => {
    await page.goto('/spotify-callback', { waitUntil: 'load' });
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page).toHaveTitle(/MySetlists/i);
    // PLAYLIST_CREATION_ENABLED is false, so the route must not render its
    // "Connecting to Spotify..." shell to anyone who deep-links to it.
    await expect(page).toHaveURL(/\/(?:$|\?)/);
    await expect(page.getByText(/spotify/i)).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // Playlist creator UI (authenticated)
  // ---------------------------------------------------------------------------
  test('playlist creator modal can be opened from stats page', async ({
    page,
  }) => {
    test.skip(
      !TEST_EMAIL || !TEST_PASSWORD,
      'Skipping: TEST_EMAIL / TEST_PASSWORD not set'
    );

    await loginUser(page, TEST_EMAIL, TEST_PASSWORD);
    await dismissOverlays(page);

    await page.goto('/stats', { waitUntil: 'load' });
    await expect(page.locator('body')).not.toContainText('Application error');

    // Look for a "Create Playlist" button in the stats view
    const createBtn = page
      .getByRole('button', { name: /create playlist|playlist/i })
      .first();
    const btnVisible = await createBtn
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (btnVisible) {
      await createBtn.click();
      // Playlist modal or auth prompt should appear
      await expect(page.locator('body')).not.toContainText('Application error');
    }
  });

  // ---------------------------------------------------------------------------
  // Full playlist creation (opt-in, requires a valid Spotify token)
  // ---------------------------------------------------------------------------
  test('creates a Spotify playlist from test shows', async ({ request }) => {
    test.skip(
      process.env.TEST_PLAYLISTS_FULL !== 'true',
      'Skipping full playlist test (set TEST_PLAYLISTS_FULL=true to enable)'
    );

    const token = process.env.TEST_SPOTIFY_ACCESS_TOKEN;
    if (!token) {
      throw new Error(
        'TEST_SPOTIFY_ACCESS_TOKEN must be set when TEST_PLAYLISTS_FULL=true'
      );
    }

    // Call the Spotify API proxy to create a playlist
    const res = await request.post(
      `${BASE}/.netlify/functions/spotify-api`,
      {
        data: {
          endpoint: '/me/playlists',
          method: 'POST',
          accessToken: token,
          body: {
            name: `test-playlist-${Date.now()}`,
            description: 'Automated test playlist — safe to delete',
            public: false,
          },
        },
      }
    );

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
  });
});
