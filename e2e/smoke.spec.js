// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'https://mysetlists.net';
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

// ---------------------------------------------------------------------------
// 1. Landing Page (unauthenticated)
// ---------------------------------------------------------------------------
test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
  });

  test('loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/MySetlists/i);
  });

  test('shows sign-in and get started buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /get started/i }).first()).toBeVisible();
  });

  test('shows guest mode button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /try it first/i })).toBeVisible();
  });

  test('renders feature grid', async ({ page }) => {
    // Check feature headings specifically to avoid matching body text
    const features = ['Track Every Show', 'Scan Ticket Stubs', 'Import Your History', 'Create Playlists', 'Discover Your Stats', 'Connect with Friends'];
    for (const feature of features) {
      await expect(page.getByRole('heading', { name: feature })).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Legal Pages
// ---------------------------------------------------------------------------
test.describe('Legal Pages', () => {
  test('/privacy loads', async ({ page }) => {
    await page.goto('/privacy', { waitUntil: 'load' });
    await expect(page.getByText(/privacy/i).first()).toBeVisible();
  });

  test('/terms loads', async ({ page }) => {
    await page.goto('/terms', { waitUntil: 'load' });
    await expect(page.getByText(/terms/i).first()).toBeVisible();
  });

  test('/cookies loads', async ({ page }) => {
    await page.goto('/cookies', { waitUntil: 'load' });
    await expect(page.getByText(/cookie/i).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Public Roadmap
// ---------------------------------------------------------------------------
test.describe('Public Roadmap', () => {
  test('/roadmap loads', async ({ page }) => {
    await page.goto('/roadmap', { waitUntil: 'load' });
    // Wait for either roadmap content or the loading state to resolve
    await expect(page.locator('body')).not.toContainText('Application error');
    // The page title or heading should be visible
    await expect(page).toHaveTitle(/MySetlists/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Release Notes
// ---------------------------------------------------------------------------
test.describe('Release Notes', () => {
  test('/release-notes loads', async ({ page }) => {
    await page.goto('/release-notes', { waitUntil: 'load' });
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page).toHaveTitle(/MySetlists/i);
  });
});

// ---------------------------------------------------------------------------
// 5. Auth Modal
// ---------------------------------------------------------------------------
test.describe('Auth Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
  });

  test('sign in opens login form', async ({ page }) => {
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText('Welcome Back')).toBeVisible();
    await expect(page.getByPlaceholder('Email address')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
  });

  test('get started opens signup form', async ({ page }) => {
    await page.getByRole('button', { name: /get started/i }).first().click();
    await expect(page.getByPlaceholder('Email address')).toBeVisible();
  });

  test('can switch between login and signup', async ({ page }) => {
    // Open login modal
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText('Welcome Back')).toBeVisible();
    // "Sign up" is a text link inside a <p>, not a role=button
    await page.getByText('Sign up').click();
    // Signup form should have a Full name field
    await expect(page.getByPlaceholder(/name/i).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 6. Guest Mode Flow
// ---------------------------------------------------------------------------
test.describe('Guest Mode', () => {
  test('enter guest mode and navigate pages', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });

    // Enter guest mode
    await page.getByRole('button', { name: /try it first/i }).click();

    // Wait for the shows page to render (sidebar shows "Guest")
    await expect(page.getByText('Guest').first()).toBeVisible({ timeout: 15000 });

    // Navigate to stats
    await page.getByRole('link', { name: /stats/i }).click();
    await expect(page.locator('body')).not.toContainText('Application error');

    // Navigate to search (use sidebar link specifically to avoid matching CTA buttons)
    await page.getByRole('link', { name: 'Search for a Show' }).click();
    await expect(page.locator('body')).not.toContainText('Application error');

    // Navigate to roadmap
    await page.getByRole('link', { name: /roadmap/i }).click();
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('exit guest mode returns to landing', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.getByRole('button', { name: /try it first/i }).click();

    // Wait for guest mode to load
    await expect(page.getByText('Guest').first()).toBeVisible({ timeout: 15000 });


    // Click exit guest mode (force in case anything still overlaps)
    await page.getByText('Exit Guest Mode').click({ force: true });

    // Should return to landing page
    await expect(page.getByRole('button', { name: /get started/i }).first()).toBeVisible({ timeout: 15000 });
  });
});

// ---------------------------------------------------------------------------
// 7. Authenticated Flow (requires TEST_EMAIL + TEST_PASSWORD env vars)
// ---------------------------------------------------------------------------
test.describe('Authenticated Flow', () => {
  test.skip(!TEST_EMAIL || !TEST_PASSWORD, 'Skipping: TEST_EMAIL and TEST_PASSWORD env vars not set');

  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/', { waitUntil: 'load' });
    await page.getByRole('button', { name: /sign in/i }).click();
    // Guideline 1.2: the submit button is disabled until the terms
    // agreement is ticked.
    const termsBox = page.getByTestId('terms-agree-checkbox');
    await termsBox.waitFor({ state: 'visible', timeout: 10000 });
    await termsBox.check();
    await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
    await page.getByPlaceholder('Password').fill(TEST_PASSWORD);
    await page.locator('form').getByRole('button', { name: /sign in/i }).click();
    // Wait for sidebar to show user name (meaning auth + redirect complete)
    await expect(page.locator('[class*="bg-sidebar"]').getByText(/shows/i).first()).toBeVisible({ timeout: 20000 });

    // Dismiss What's New modal if it appears (overlays sidebar and blocks clicks)
    const whatsNewClose = page.getByRole('button', { name: 'Got it' });
    if (await whatsNewClose.isVisible({ timeout: 2000 }).catch(() => false)) {
      await whatsNewClose.click();
      await whatsNewClose.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }

    // Dismiss onboarding tooltip if it appears
    const tooltipDismiss = page.getByRole('button', { name: /got it/i });
    if (await tooltipDismiss.isVisible({ timeout: 1500 }).catch(() => false)) {
      await tooltipDismiss.click();
    }

  });

  test('shows page loads with user content', async ({ page }) => {
    // Should not show "Loading..."
    await expect(page.locator('body')).not.toContainText('Loading...');
    // Should not show error
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('all authenticated pages load without error', async ({ page }) => {
    const pages = ['/stats', '/friends', '/community', '/profile', '/search', '/invite', '/feedback'];

    for (const path of pages) {
      await page.goto(path, { waitUntil: 'load' });
      await expect(page.locator('body')).not.toContainText('Application error');
      await expect(page.locator('body')).not.toBeEmpty();
    }
  });

  test('logout returns to landing page', async ({ page }) => {
    await page.getByText('Logout').click({ force: true });
    await expect(page.getByRole('button', { name: /get started/i }).first()).toBeVisible({ timeout: 15000 });
  });
});

// ---------------------------------------------------------------------------
// 8. API Health Checks (Netlify Functions)
// ---------------------------------------------------------------------------
test.describe('API Health', () => {
  test('get-entity-info returns data for known artist', async ({ request }) => {
    const res = await request.get(`${BASE}/.netlify/functions/get-entity-info?name=Radiohead&type=artist`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
  });

  test('enrich-artist returns data for known artist', async ({ request }) => {
    const res = await request.get(`${BASE}/.netlify/functions/enrich-artist?name=Radiohead`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
  });

  test('search-artists returns results', async ({ request }) => {
    const res = await request.get(`${BASE}/.netlify/functions/search-artists?artistName=Radiohead`);
    expect(res.status()).toBe(200);
  });
});
