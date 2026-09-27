// @ts-check
/**
 * Mobile navigation smoke tests — the driveable half of the mobile
 * navigation rework.
 *
 * WHAT IS AND IS NOT HERE. Playwright cannot drive a native-feeling
 * pointer gesture: the edge-swipe recognizer's thresholds, direction lock
 * and abort conditions are unit-tested as pure functions in
 * lib/__tests__/swipeGesture.test.js, and the feel of the gesture is a
 * physical-device check. What IS driveable is everything structural — does
 * a pushed route have a back control, does a cold deep link land on the
 * right parent, does anything overflow at 390px — and that is what this
 * file pins.
 *
 * Runs in GUEST MODE so it needs no credentials and creates no data, which
 * also keeps it in the unauthenticated `smoke` project.
 */
const { test, expect } = require('@playwright/test');

// iPhone 14 logical size. 390px is the width the layout has to survive.
const PHONE = { width: 390, height: 844 };

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

/**
 * Cold-launch a route with guest mode already active.
 *
 * Seeds localStorage rather than clicking "Try it first" and then
 * navigating, for two reasons. First, clicking it writes the
 * `guest-session-id` key only AFTER a successful Firestore addDoc (see
 * enterGuestMode in context/AppContext.jsx), so guest mode does not
 * survive the reload when Firestore is unreachable, and the tests would be
 * flaky for a reason unrelated to what they check. Second — and this is
 * the point — a seeded launch straight into a route IS the cold deep-link
 * case: no in-app history behind it, which is where router.back() would
 * strand the user and where the route table in lib/navRoutes.js has to
 * supply the parent instead.
 */
async function coldLaunch(page, route) {
  await page.addInitScript(() => {
    // AppContext seeds guestMode from this key on mount.
    localStorage.setItem('guest-session-id', 'e2e-mobile-nav');
  });
  await page.goto(route, { waitUntil: 'load' });
  await expect(page.locator('body')).not.toContainText('Application error');
  // The shell renders behind authLoading; wait for that to resolve.
  await page.waitForFunction(
    () => !document.body.innerText.trim().startsWith('Loading'),
    null,
    { timeout: 20000 },
  );
}

test.describe('Mobile header', () => {
  test('a tab root shows the drawer button and no back control', async ({ page }) => {
    await coldLaunch(page, '/shows/');

    const header = page.locator('header').first();
    await expect(header).toBeVisible();
    // The leading slot opens the drawer on a root — there is nothing to go
    // back to, and offering a back control there is how you walk a user out
    // of the app.
    await expect(page.getByRole('button', { name: /open menu/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /^back to /i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^go back$/i })).toHaveCount(0);
  });

  test('a pushed route shows a back control', async ({ page }) => {
    // /stats is a tab root; /stats/songs is pushed from it.
    await coldLaunch(page, '/stats/songs/');

    const back = page.getByRole('link', { name: /back to stats|go back/i }).first();
    await expect(back).toBeVisible({ timeout: 15000 });
    // And the drawer button is not also present — one leading control, not two.
    await expect(page.getByRole('button', { name: /open menu/i })).toHaveCount(0);
  });

  test('back from a cold deep link lands on the parent, not nowhere', async ({ page }) => {
    // Navigate directly, with no in-app history behind it: this is the
    // shared-link / push-notification case where router.back() would either
    // do nothing or leave the app.
    await coldLaunch(page, '/stats/top-artists/');

    const back = page.getByRole('link', { name: /back to stats|go back/i }).first();
    await expect(back).toBeVisible({ timeout: 15000 });
    await back.click();

    await expect(page).toHaveURL(/\/stats\/?$/, { timeout: 15000 });
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('the back control is at least 44pt in both directions', async ({ page }) => {
    await coldLaunch(page, '/stats/songs/');

    const back = page.getByRole('link', { name: /back to stats|go back/i }).first();
    await expect(back).toBeVisible({ timeout: 15000 });
    const box = await back.boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  });

  test('the header stays put when the page scrolls', async ({ page }) => {
    await coldLaunch(page, '/how-to-use/');

    const header = page.locator('header').first();
    const before = await header.boundingBox();
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(300);
    const after = await header.boundingBox();

    // Sticky, not scroll-away — and consistently so across screens.
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  });
});

test.describe('Mobile layout', () => {
  // The routes a guest can actually reach. Each is checked for horizontal
  // overflow, which is the single most common way a phone layout breaks.
  const GUEST_ROUTES = ['/shows/', '/stats/', '/search/', '/how-to-use/'];

  for (const route of GUEST_ROUTES) {
    test(`${route} does not overflow horizontally at 390px`, async ({ page }) => {
      await coldLaunch(page, route);
      await page.waitForTimeout(500);

      const overflow = await page.evaluate(() => ({
        docWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      // A few px of slack for sub-pixel rounding; a real overflow is tens.
      expect(overflow.docWidth).toBeLessThanOrEqual(overflow.viewportWidth + 2);
    });
  }

  test('no element is wider than the viewport', async ({ page }) => {
    await coldLaunch(page, '/shows/');
    await page.waitForTimeout(500);

    // Names the offender rather than just failing, since "something is too
    // wide" is not an actionable report.
    const offenders = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > window.innerWidth + 2 && r.height > 0) {
          const style = getComputedStyle(el);
          // A horizontal scroller is allowed to be wider than the screen —
          // that is what makes it scroll.
          if (style.overflowX === 'auto' || style.overflowX === 'scroll') return;
          out.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120));
        }
      });
      return out.slice(0, 5);
    });
    expect(offenders).toEqual([]);
  });

  test('nothing fixed to the bottom edge covers the end of the content', async ({ page }) => {
    await coldLaunch(page, '/shows/');
    await page.waitForTimeout(500);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    const trapped = await page.evaluate(() => {
      const bars = [...document.querySelectorAll('body *')].filter((el) => {
        const s = getComputedStyle(el);
        if (s.position !== 'fixed') return false;
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.width === 0) return false;
        // Pinned to the bottom edge…
        if (Math.abs(r.bottom - window.innerHeight) > 2) return false;
        // …but NOT a full-height panel. The nav drawer is fixed, top-0 and
        // h-dscreen, so its bottom also sits on the viewport edge; it is a
        // side sheet, not a bottom bar, and it is not covering content.
        return r.height < window.innerHeight * 0.5;
      });
      if (bars.length === 0) return null;
      const barTop = Math.min(...bars.map((el) => el.getBoundingClientRect().top));
      // The last piece of real content, rather than body, whose box spans
      // the whole document.
      const items = [...document.querySelectorAll('article, li, [data-show-card]')]
        .filter((el) => el.getBoundingClientRect().height > 0);
      const last = items[items.length - 1];
      return { barTop, lastBottom: last ? last.getBoundingClientRect().bottom : null };
    });

    // No fixed bottom bar is mounted today — MobileTabBar is dormant by
    // design, see components/layout/MobileTabBar.jsx — so this pins the
    // invariant for whenever one appears rather than requiring one now.
    if (trapped && trapped.lastBottom !== null) {
      expect(trapped.lastBottom).toBeLessThanOrEqual(trapped.barTop + 2);
    }
  });

  test('the sticky header does not cover the top of the content', async ({ page }) => {
    await coldLaunch(page, '/stats/songs/');
    await page.waitForTimeout(500);

    const overlap = await page.evaluate(() => {
      const header = document.querySelector('header');
      if (!header) return null;
      const h = header.getBoundingClientRect();
      // The page's own title is the first thing that must clear the header.
      const title = document.querySelector('[data-page-title]');
      if (!title) return null;
      return { headerBottom: h.bottom, titleTop: title.getBoundingClientRect().top };
    });

    expect(overlap).not.toBeNull();
    // The content column offsets by pt-header (bar height + top inset).
    // This is the regression guard for the double-counted safe-area inset
    // the body used to add on top of that.
    expect(overlap.titleTop).toBeGreaterThanOrEqual(overlap.headerBottom - 2);
  });

});

test.describe('Mobile inputs', () => {
  test('search input is at least 16px, so focusing it does not zoom the page', async ({ page }) => {
    await coldLaunch(page, '/search/');

    const input = page.locator('input[type="search"], input:not([type="checkbox"]):not([type="radio"])').first();
    await expect(input).toBeVisible({ timeout: 15000 });
    const fontSize = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    // Under 16px, Safari zooms the whole page on focus and the layout jumps.
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });

  test('a field that submits a search asks for a search key', async ({ page }) => {
    await coldLaunch(page, '/search/');

    // /search is not one type=search box; it is several text fields that
    // each submit the query on Enter (see components/SearchView.jsx), so
    // what matters is that they ask for a Search key rather than a return
    // key. enterkeyhint is the attribute that does that.
    const input = page.locator('input[enterkeyhint="search"]').first();
    await expect(input).toBeVisible({ timeout: 15000 });
    await expect(input).toHaveAttribute('autocapitalize', 'words');
  });

  test('every visible text input is at least 16px', async ({ page }) => {
    await coldLaunch(page, '/search/');
    await page.waitForTimeout(500);

    // One under-16px field is enough to zoom the whole page on focus, so
    // this checks all of them rather than the first.
    const small = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('input, textarea, select').forEach((el) => {
        if (['checkbox', 'radio', 'hidden'].includes(el.type)) return;
        if (el.getBoundingClientRect().height === 0) return;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 16) out.push(`${el.type || el.tagName}:${size}px`);
      });
      return out;
    });
    expect(small).toEqual([]);
  });
});
