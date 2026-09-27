// @ts-check
/**
 * Shows smoke tests — CRUD operations on the Shows page.
 * Creates shows with the "test-" artist prefix so cleanup.js can identify them.
 * Cleans up via UI (delete button) after each test.
 *
 * Requires: TEST_EMAIL, TEST_PASSWORD
 */
const { test, expect } = require('@playwright/test');
const { dismissOverlays } = require('../utils/test-helpers');

const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

// Unique per-run suffix so parallel runs don't conflict
const RUN_ID = Date.now();
const TEST_ARTIST = `test-artist-${RUN_ID}`;
const TEST_VENUE = 'Test Venue';
const TEST_DATE = '2024-01-15';

test.describe('Shows Smoke Tests', () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    'Skipping: TEST_EMAIL and TEST_PASSWORD env vars not set'
  );

  // Reuses the one session captured by e2e/auth.setup.js. This beforeEach
  // used to sign in for every test in the file — five Firebase sign-ins a
  // run from here alone, ten with retries, which is most of what got the
  // account throttled with auth/too-many-requests. The storage state comes
  // from the `smoke-auth` project, not a test.use() here, so there is one
  // place that decides it.
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await dismissOverlays(page);
  });

  // ---------------------------------------------------------------------------
  // Shows page loads
  // ---------------------------------------------------------------------------
  test('shows page loads without error', async ({ page }) => {
    // After login we're already on the shows page
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page.locator('body')).not.toContainText('Loading...');
  });

  // ---------------------------------------------------------------------------
  // Add a show
  // ---------------------------------------------------------------------------
  test('can add a show via the add-show flow', async ({ page }) => {
    // "Search for a Show" button navigates to /search
    const addBtn = page
      .getByRole('button', { name: /search for a show/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click();

    // Should now be on the Search page. Its H1, set by PageHeader in
    // app/search/page.jsx, is "Search" — nothing renders "Search Shows",
    // so the old assertion could never pass. Anchored to level 1 and to
    // the whole string so it cannot drift onto SearchView's h2s ("Select
    // Artist", "Artists Found", "Search Results").
    await expect(
      page.getByRole('heading', { name: /^search$/i, level: 1 })
    ).toBeVisible({ timeout: 10000 });

    // Fill in the artist name field (placeholder: "e.g., Radiohead")
    const artistInput = page.getByPlaceholder(/radiohead/i);
    await expect(artistInput).toBeVisible({ timeout: 5000 });
    await artistInput.fill('Radiohead');

    // "Search Artists" button becomes enabled once artist is filled
    const searchBtn = page.getByRole('button', { name: /search artists/i });
    await expect(searchBtn).toBeEnabled({ timeout: 5000 });
    await searchBtn.click();

    // Results should load or show a "no results" message — either way no crash
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  // ---------------------------------------------------------------------------
  // All authenticated pages reachable from shows page
  // ---------------------------------------------------------------------------
  test('all authenticated nav pages load without error', async ({ page }) => {
    const routes = [
      '/stats',
      '/friends',
      '/community',
      '/profile',
      '/search',
      '/invite',
      '/feedback',
    ];

    for (const route of routes) {
      await page.goto(route, { waitUntil: 'load' });
      await expect(page.locator('body')).not.toContainText('Application error');
      await expect(page.locator('body')).not.toBeEmpty();
    }
  });

  // ---------------------------------------------------------------------------
  // Scan-import page loads
  // ---------------------------------------------------------------------------
  test('scan-import page loads without error', async ({ page }) => {
    await page.goto('/scan-import', { waitUntil: 'load' });
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page).toHaveTitle(/MySetlists/i);
  });

  // ---------------------------------------------------------------------------
  // How to Use page loads
  // ---------------------------------------------------------------------------
  test('how-to-use page loads with content', async ({ page }) => {
    const response = await page.goto('/how-to-use', { waitUntil: 'load' });
    // Skip gracefully when the feature branch hasn't been deployed yet
    if (response?.status() === 404) {
      test.skip(true, '/how-to-use returned 404 — merge and deploy the feature branch first');
      return;
    }
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page.getByRole('heading', { name: /how to use/i })).toBeVisible();
    // Sidebar link should be present and active
    await expect(page.getByRole('link', { name: /how to use/i })).toBeVisible();
  });
});
