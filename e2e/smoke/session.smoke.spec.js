// @ts-check
/**
 * Tests that need to BE signed in but do not exercise signing in.
 *
 * These reuse the single session captured by e2e/auth.setup.js and cost no
 * Firebase sign-in of their own. They live in their own file, apart from
 * auth.smoke.spec.js, because Playwright selects projects by FILE: the
 * `smoke-auth` project depends on the setup project and this file belongs
 * to it, while auth.smoke.spec.js's signed-out tests belong to `smoke`,
 * which has no such dependency.
 *
 * That split is deliberate and was learned the hard way. When the whole
 * smoke project depended on setup, a throttled test account failed setup
 * and took all 36 tests down with it — including the two dozen that never
 * touch authentication at all (API health, email endpoints, legal pages).
 * That is strictly worse signal than the problem it was fixing. Now a
 * sign-in outage costs exactly the tests that genuinely need a session.
 *
 * The signed-in storage state comes from the project config, not a
 * `test.use()` here, so there is one place that decides it.
 */
const { test, expect } = require('@playwright/test');
const { dismissOverlays, logoutUser } = require('../utils/test-helpers');

const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

test.describe('Restored Session Smoke Tests', () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    'Skipping: TEST_EMAIL and TEST_PASSWORD env vars not set'
  );

  test('authenticated sidebar contains expected nav links', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await dismissOverlays(page);

    // Only links a signed-in user actually has. components/layout/Sidebar.jsx
    // renders My Shows, Stats, Tours, Festivals, Wishlist, Bucket List,
    // Profile and Setlist Photos for a signed-in account, plus
    // "How to Use" in the utilities block below the nav.
    //
    // This list used to hold /friends/i and /search/i. Neither is a sidebar
    // link. /friends is a real page — the nav walk in shows.smoke.spec.js
    // reaches it directly — but nothing in Sidebar.jsx links to it, and
    // "Search for a Show" is a control on the Shows page rather than a nav
    // entry. Same failure mode as the /roadmap/i assertion fixed in #286,
    // and it hid for just as long, because until the credentials were
    // replaced this test had never once run.
    const navLabels = [/my shows/i, /stats/i, /tours/i, /festivals/i, /wishlist/i];
    for (const label of navLabels) {
      await expect(
        page.getByRole('link', { name: label }).first()
      ).toBeVisible();
    }

    // Festivals sits directly under Tours, above Wishlist (5.40.0), and
    // Upcoming is gone. One list feeds both the desktop sidebar and the
    // mobile drawer, so checking it once covers both.
    const order = (await page.locator('aside nav a').allInnerTexts()).map((t) => t.trim());
    const tours = order.findIndex((t) => /^tours/i.test(t));
    expect(order[tours + 1]).toMatch(/^festivals/i);
    expect(order[tours + 2]).toMatch(/^wishlist/i);
    expect(order.some((t) => /^upcoming/i.test(t))).toBe(false);
  });

  test('sign out returns to landing page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await dismissOverlays(page);
    await logoutUser(page);
  });

  test('session persists across page reload', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await dismissOverlays(page);

    await page.reload({ waitUntil: 'load' });

    // Restoring from storage state and surviving a reload are the same
    // property this always asserted: that the session lives somewhere
    // durable rather than only in memory.
    await expect(
      page.locator('[class*="bg-sidebar"]').getByText(/shows/i).first()
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).not.toContainText('Application error');
  });
});
