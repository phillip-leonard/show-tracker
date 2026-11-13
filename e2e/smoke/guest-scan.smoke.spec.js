// @ts-check
/**
 * Guests can't scan (5.59.6). analyze-tickets and analyze-screenshot call
 * Claude and need a signed-in account, so a guest on /scan-import/ gets a
 * "Create a free account to scan tickets" prompt in the scanner's place,
 * and the file import (CSV / Excel) stays open to them without the
 * screenshot option.
 *
 * Guest mode is seeded the same way mobile-nav.smoke.spec.js does it: the
 * `guest-session-id` key AppContext reads on mount.
 */
const { test, expect } = require('@playwright/test');

async function asGuest(page, route) {
  await page.addInitScript(() => {
    localStorage.setItem('guest-session-id', 'e2e-guest-scan');
  });
  await page.goto(route, { waitUntil: 'load' });
  await expect(page.locator('body')).not.toContainText('Application error');
  await page.waitForFunction(
    () => !document.body.innerText.trim().startsWith('Loading')
      && !document.documentElement.hasAttribute('data-auth-hint'),
    null,
    { timeout: 20000 },
  );
}

test.describe('Guest ticket scanning', () => {
  test('a guest opens on the file import, without the screenshot option', async ({ page }) => {
    await asGuest(page, '/scan-import/');
    const input = page.locator('#import-file-input');
    await expect(input).toHaveCount(1, { timeout: 15000 });
    const accept = await input.getAttribute('accept');
    expect(accept).toContain('.csv');
    expect(accept).not.toContain('image/');
  });

  test('the Scan Tickets tab shows the sign-up prompt, not the scanner', async ({ page }) => {
    await asGuest(page, '/scan-import/');
    await page.getByRole('tab', { name: /scan tickets/i }).or(page.getByRole('button', { name: /scan tickets/i })).first().click();
    await expect(page.getByText('Create a free account to scan tickets')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /create free account/i })).toBeVisible();
    // The scanner's own controls are not there.
    await expect(page.getByRole('button', { name: /analyze/i })).toHaveCount(0);
  });
});
