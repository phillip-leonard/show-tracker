// @ts-check
/**
 * Core smoke tests — page loads, navigation, and guest mode.
 * These run unauthenticated and should complete in < 60 seconds.
 * No test credentials required.
 */
const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'https://mysetlists.net';

// ---------------------------------------------------------------------------
// Landing Page
// ---------------------------------------------------------------------------
test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
  });

  test('loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/MySetlists/i);
  });

  test('shows sign-in and get started buttons', async ({ page }) => {
    // v2 landing page uses "Log in" and "Start tracking"
    await expect(page.getByRole('button', { name: /log in/i })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /start tracking/i }).first()
    ).toBeVisible();
  });

  test('shows guest mode button', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /try it first/i })
    ).toBeVisible();
  });

  test('renders feature grid', async ({ page }) => {
    // Feature headings updated in v2 landing page redesign
    const features = [
      'Auto-import your shows',
      'Rate & remember',
      'Stats that actually matter',
      'Follow friends & bands',
      'Wishlist the ones you missed',
    ];
    for (const feature of features) {
      await expect(page.getByRole('heading', { name: feature })).toBeVisible();
    }
  });

  test('does not advertise playlist creation while it is switched off', async ({ page }) => {
    // PLAYLIST_CREATION_ENABLED is false, so no Spotify or Apple Music copy
    // should reach the landing page. Guards the App Review commitment that
    // the app names neither service anywhere a user can see.
    await expect(page.getByText(/spotify|apple music/i)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Static HTML — what a crawler gets before (or without) running any script.
// Until 5.44.4 every exported page was the root layout's "Loading..."
// fallback, because useSearchParams() in the providers bailed the whole tree
// out of pre-rendering, and Google indexed nothing else.
// ---------------------------------------------------------------------------
test.describe('Static HTML', () => {
  test('/ ships the landing page as real HTML', async ({ request }) => {
    const html = await (await request.get('/')).text();
    expect(html).toContain('class="lp-root"');
    expect(html).toContain('Every show you');
    expect(html).not.toContain('BAILOUT_TO_CLIENT_SIDE_RENDERING');
    expect(html).not.toMatch(/>Loading\.\.\.</);
  });

  test('/terms ships its content as real HTML', async ({ request }) => {
    const html = await (await request.get('/terms/')).text();
    expect(html).toContain('Terms of Service');
    expect(html).not.toContain('BAILOUT_TO_CLIENT_SIDE_RENDERING');
  });

  test('a first-time visitor never sees "Loading..." on /', async ({ page }) => {
    // Checked before every frame until the test stops it, so a loading
    // screen that paints for a single frame still fails this.
    await page.addInitScript(() => {
      window.__loadingSeen = false;
      const check = () => {
        const loading = [...document.querySelectorAll('div')].some(
          (d) => d.textContent.trim() === 'Loading...' && d.getClientRects().length > 0
        );
        if (loading) window.__loadingSeen = true;
        if (!window.__stopLoadingCheck) requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    await page.goto('/', { waitUntil: 'load' });
    await expect(page.getByRole('button', { name: /log in/i })).toBeVisible();
    await page.waitForTimeout(1000); // past the point where auth resolves
    const seen = await page.evaluate(() => {
      window.__stopLoadingCheck = true;
      return window.__loadingSeen;
    });
    expect(seen).toBe(false);
  });

  test('loads with all site storage blocked', async ({ page }) => {
    // What Chrome's "Block all site data" does: touching localStorage,
    // sessionStorage or indexedDB throws a SecurityError. A storage read
    // in AppProvider used to take the whole app down to "Application
    // error" (fixed in 5.44.4, lib/storage.js).
    await page.addInitScript(() => {
      for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) {
        Object.defineProperty(window, name, {
          configurable: true,
          get() {
            throw new DOMException('Access is denied for this document.', 'SecurityError');
          },
        });
      }
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/', { waitUntil: 'load' });
    await expect(page.getByRole('button', { name: /log in/i })).toBeVisible();
    await page.waitForTimeout(1500); // past the point where auth resolves
    await expect(page.locator('body')).not.toContainText('Application error');
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Legal & Public Pages
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

  test('/roadmap loads without error', async ({ page }) => {
    await page.goto('/roadmap', { waitUntil: 'load' });
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page).toHaveTitle(/MySetlists/i);
  });

  test('/release-notes loads without error', async ({ page }) => {
    await page.goto('/release-notes', { waitUntil: 'load' });
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page).toHaveTitle(/MySetlists/i);
  });
});

// ---------------------------------------------------------------------------
// Auth Modal UI (unauthenticated, no credentials needed)
// ---------------------------------------------------------------------------
test.describe('Auth Modal UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
  });

  test('sign in opens login form', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.getByText('Welcome Back')).toBeVisible();
    await expect(page.getByPlaceholder('Email address')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
  });

  test('get started opens signup form', async ({ page }) => {
    // v2 landing page uses "Start tracking" as the primary CTA
    await page.getByRole('button', { name: /start tracking/i }).first().click();
    await expect(page.getByPlaceholder('Email address')).toBeVisible();
  });

  test('can switch between login and signup', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.getByText('Welcome Back')).toBeVisible();
    await page.getByText('Sign up').click();
    await expect(page.getByPlaceholder(/name/i).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Guest Mode
// ---------------------------------------------------------------------------
test.describe('Guest Mode', () => {
  test('enter guest mode and navigate pages', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.getByRole('button', { name: /try it first/i }).click();
    // Guest sidebar shows "Create Account" and "Exit Guest Mode" — not a "Guest" label
    await expect(page.getByText('Exit Guest Mode').first()).toBeVisible({
      timeout: 15000,
    });

    // Only links a GUEST actually has. components/layout/Sidebar.jsx hides
    // Tours, Festivals, Wishlist, Bucket List, Profile and Setlist Photos
    // behind `!isGuest`, leaving My Shows, Stats, "Search for a show" and
    // "How to Use". (Upcoming was removed from the nav in 5.40.0.)
    //
    // This list used to end with /roadmap/i, which is not in the sidebar at
    // all — not for a guest, not for anyone (it exists only as
    // app/roadmap/page.jsx and some cards). The test had been failing on a
    // link that never existed. "Support" is deliberately excluded: it is an
    // external <a> to buymeacoffee.com, and clicking it would navigate the
    // test off the site.
    // Feedback came back to the sidebar's bottom group in 5.43.0.
    for (const label of [/stats/i, /search for a show/i, /^feedback$/i, /how to use/i]) {
      await page.getByRole('link', { name: label }).first().click();
      await expect(page.locator('body')).not.toContainText('Application error');
    }
  });

  // Upcoming Shows was removed in 5.40.0; an old link must land on My Shows
  // rather than a blank page or the landing page. On the web netlify.toml
  // 301s it; app/upcoming/page.jsx is the client-side fallback.
  test('old /upcoming link redirects to My Shows', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.getByRole('button', { name: /try it first/i }).click();
    await expect(page.getByText('Exit Guest Mode').first()).toBeVisible({
      timeout: 15000,
    });

    await page.goto('/upcoming/', { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/shows\/?$/, { timeout: 15000 });
    await expect(page.getByRole('link', { name: /^upcoming$/i })).toHaveCount(0);
  });

  test('exit guest mode returns to landing', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.getByRole('button', { name: /try it first/i }).click();
    await expect(page.getByText('Exit Guest Mode').first()).toBeVisible({
      timeout: 15000,
    });

    await page.getByText('Exit Guest Mode').click({ force: true });
    // v2 landing page uses "Start tracking" instead of "Get started"
    await expect(
      page.getByRole('button', { name: /start tracking/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });
});

// ---------------------------------------------------------------------------
// API Health Checks (Netlify Functions)
// ---------------------------------------------------------------------------
test.describe('API Health', () => {
  test('get-entity-info returns data for Radiohead', async ({ request }) => {
    const res = await request.get(
      `${BASE}/.netlify/functions/get-entity-info?name=Radiohead&type=artist`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
  });

  test('enrich-artist returns data for Radiohead', async ({ request }) => {
    const res = await request.get(
      `${BASE}/.netlify/functions/enrich-artist?name=Radiohead`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
  });

  test('search-artists returns results', async ({ request }) => {
    const res = await request.get(
      `${BASE}/.netlify/functions/search-artists?artistName=Radiohead`
    );
    expect(res.status()).toBe(200);
  });

  test('search-setlists returns results for known artist', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/.netlify/functions/search-setlists?artistName=Radiohead`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.setlist).toBeDefined();
  });
});
