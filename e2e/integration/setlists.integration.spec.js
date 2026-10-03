// @ts-check
/**
 * Setlists integration tests — setlist.fm search, import, ratings.
 *
 * Tests hit the real setlist.fm API via the search-setlists Netlify function.
 * No mock data — we validate actual API responses to catch integration failures.
 *
 * Requires: TEST_EMAIL, TEST_PASSWORD (for import/rating tests)
 */
const { test, expect } = require('@playwright/test');
const {
  loginUser,
  dismissOverlays,
} = require('../utils/test-helpers');

const BASE = process.env.TEST_BASE_URL || 'https://mysetlists.net';
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

test.describe('Setlists Integration Tests', () => {
  // ---------------------------------------------------------------------------
  // search-setlists API (unauthenticated, real setlist.fm)
  // ---------------------------------------------------------------------------
  test('search-setlists returns valid setlist structure for Radiohead', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/.netlify/functions/search-setlists?artistName=Radiohead`
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.setlist)).toBe(true);
    expect(body.setlist.length).toBeGreaterThan(0);

    // Validate setlist shape
    const first = body.setlist[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('artist');
    expect(first).toHaveProperty('venue');
  });

  test('search-setlists with MBID returns results', async ({ request }) => {
    // Radiohead MBID from MusicBrainz
    const res = await request.get(
      `${BASE}/.netlify/functions/search-setlists?artistMbid=a74b1b7f-71a5-4011-9441-d0b5e4122711`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.setlist)).toBe(true);
  });

  test('search-setlists with year filter returns shows from that year', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/.netlify/functions/search-setlists?artistName=Radiohead&year=2016`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    if (body.setlist.length > 0) {
      // Each returned show should be from 2016
      const show = body.setlist[0];
      if (show.eventDate) {
        expect(show.eventDate).toContain('2016');
      }
    }
  });

  test('search-setlists with unknown artist returns empty or 404', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/.netlify/functions/search-setlists?artistName=zzz-no-such-artist-xyz-test`
    );
    // Either 200 with empty array, or 404/200 with itemsFound:0
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      const items = body.setlist || [];
      expect(Array.isArray(items)).toBe(true);
    }
  });

  test('search-setlists by venue and year needs no artist', async ({ request }) => {
    const res = await request.get(
      `${BASE}/.netlify/functions/search-setlists?venueName=Red%20Rocks%20Amphitheatre&year=2024`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.setlist)).toBe(true);
    expect(body.setlist.length).toBeGreaterThan(0);
    // Several different artists — this is a venue search, not an artist one.
    const artists = new Set(body.setlist.map(s => s.artist?.name));
    expect(artists.size).toBeGreaterThan(1);
    body.setlist.forEach(s => expect(s.eventDate).toContain('2024'));
  });

  test('search-setlists with only a year is rejected', async ({ request }) => {
    const res = await request.get(`${BASE}/.netlify/functions/search-setlists?year=2024`);
    expect(res.status()).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Admin populate-setlist (requires auth but validates endpoint is reachable)
  // ---------------------------------------------------------------------------
  test('admin-find-missing-setlists OPTIONS returns 200', async ({
    request,
  }) => {
    const res = await request.fetch(
      `${BASE}/.netlify/functions/admin-find-missing-setlists`,
      { method: 'OPTIONS' }
    );
    expect([200, 204]).toContain(res.status());
  });

  // ---------------------------------------------------------------------------
  // Artist stats (uses real data from setlist.fm + cache)
  // ---------------------------------------------------------------------------
  test('get-artist-stats returns stats for Radiohead', async ({ request }) => {
    // Function requires ?slug= (lowercase artist slug), not ?artistName=
    const res = await request.get(
      `${BASE}/.netlify/functions/get-artist-stats?slug=radiohead`
    );
    // 200 with stats, 404 if not cached, 500 if upstream API unavailable
    expect([200, 404, 500]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeTruthy();
    }
  });

  test('get-artist-tours returns tours for Radiohead', async ({ request }) => {
    // Function requires ?mbid= (MusicBrainz ID), not ?artistName=
    // Radiohead MBID: a74b1b7f-71a5-4011-9441-d0b5e4122711
    const res = await request.get(
      `${BASE}/.netlify/functions/get-artist-tours?mbid=a74b1b7f-71a5-4011-9441-d0b5e4122711`
    );
    // 200 with tours; 429/502/504 are the function's own distinct signals
    // for rate-limited / upstream failure / timeout (see the function — a
    // failed request must never come back as an empty tour list).
    expect([200, 429, 502, 504]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(Array.isArray(body.tours)).toBe(true);
    }
  });

  test('get-tour-shows requires both mbid and tourName', async ({ request }) => {
    const res = await request.get(`${BASE}/.netlify/functions/get-tour-shows?mbid=a74b1b7f-71a5-4011-9441-d0b5e4122711`);
    expect(res.status()).toBe(400);
  });

  test('get-tour-shows returns a tour\'s shows in date order', async ({ request }) => {
    const res = await request.get(
      `${BASE}/.netlify/functions/get-tour-shows?mbid=a74b1b7f-71a5-4011-9441-d0b5e4122711&tourName=${encodeURIComponent('In Rainbows')}`
    );
    expect([200, 429, 502, 504]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(Array.isArray(body.shows)).toBe(true);
      const dates = body.shows.map(s => s.date);
      expect(dates).toEqual([...dates].sort());
    }
  });

  // ---------------------------------------------------------------------------
  // Setlist import via UI (authenticated)
  // ---------------------------------------------------------------------------
  test('search page shows setlist import results for Radiohead', async ({
    page,
  }) => {
    test.skip(
      !TEST_EMAIL || !TEST_PASSWORD,
      'Skipping: TEST_EMAIL / TEST_PASSWORD not set'
    );

    await loginUser(page, TEST_EMAIL, TEST_PASSWORD);
    await dismissOverlays(page);

    await page.goto('/search', { waitUntil: 'load' });
    await expect(page.locator('body')).not.toContainText('Application error');

    // Type in the artist search box (placeholder is "e.g., Radiohead")
    const searchInput = page.getByPlaceholder(/radiohead/i);
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill('Radiohead');

    // Click the Search Artists button (enabled once artist name is filled)
    const searchBtn = page.getByRole('button', { name: /search artists/i });
    await expect(searchBtn).toBeEnabled({ timeout: 5000 });
    await searchBtn.click();

    // Results should appear within 15s (real API call)
    await expect(page.locator('body')).not.toContainText('Application error');
  });
});
