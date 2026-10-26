// e2e/smoke/heard-share.smoke.spec.js
//
// "Songs I've heard" on a ?mine=1 page (a signed-in user's poster from
// their logged shows): Copy link, Share link and the browser's own share
// (the canonical link) all give the same /r/<code>/ link, and that link
// opens the same record. Reported Oct 25, 2026: Copy link gave the ?mine=1
// address instead.
//
// Self-contained: the tool page, its show list and the share page are
// rendered here from a small fixture and served with page.route, so this
// runs against any baseURL, production included, before or after a deploy.

const { test, expect } = require('@playwright/test');
const sources = require('../../netlify/functions/lib/publicArtistSources');
const snap = require('../../netlify/functions/lib/publicArtistSnapshot');
const stats = require('../../netlify/functions/lib/artistSnapshotStats');
const heard = require('../../netlify/functions/lib/heardRecord');
const pages = require('../../netlify/functions/lib/heardPages');
const artistPages = require('../../netlify/functions/lib/publicArtistPages');

const NOW = Date.parse('2026-10-20T12:00:00Z');
const ORIGIN = 'https://mysetlists.net';
const quiet = { warn() {}, error() {}, log() {} };
const dateOf = (i) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);

// 20 Goose shows, Arcadia and Hot Tea at every one: repeated songs, so
// distinct songs (3) and performances differ.
async function goose() {
  const shows = [];
  for (let i = 1; i <= 20; i++) {
    shows.push({
      id: `s${i}`, date: dateOf(i), order: 1, venue: `Venue ${i}`, city: 'Denver', state: 'CO', country: 'USA',
      url: `https://elgoose.net/setlists/s${i}.html`, tour: 'Fall Tour',
      songs: ['Arcadia', 'Hot Tea', ...(i === 5 ? ['Rockdale'] : [])].map((name) => ({
        key: `sf:${name}`, slug: stats.slugify(name), name, original: true, originalArtist: '', sourceUrl: '', set: 'Set I',
      })),
    });
  }
  const saved = { ...sources };
  sources.fetchSongfishYear = async (_a, y) => shows.filter((s) => s.date.startsWith(String(y)));
  sources.fetchSongfishShowList = async () => ({ shows: [], excluded: new Set() });
  const data = new Map();
  const store = {
    async get(key) { return data.has(key) ? JSON.parse(data.get(key)) : null; },
    async set(key, value) { data.set(key, JSON.stringify(value)); },
    async delete(key) { data.delete(key); },
  };
  try {
    await snap.runSnapshot({ store, only: ['goose'], force: 'full', now: () => NOW, log: quiet });
  } finally { Object.assign(sources, saved); }
  return snap.loadArtistShows(store, 'goose');
}

// The app's link: ?mine=1 and the logged shows in the fragment (lib/heardLinks.js).
const mineFragment = (logged) => Buffer.from(JSON.stringify(logged)).toString('base64url');

async function serve(page, loaded) {
  const now = NOW + 3600 * 1000;
  await page.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    let res = null;
    if (url.pathname === '/heard/goose/') res = pages.renderHeardBand(loaded, now, { mine: url.searchParams.get('mine') === '1' });
    else if (url.pathname === '/api/artist-shows') res = artistPages.artistShowsJson(loaded, now);
    else {
      const m = /^\/heard\/goose\/r\/([A-Za-z0-9_-]+)\/$/.exec(url.pathname);
      if (m) res = pages.renderHeardShare(loaded, m[1], heard.decodeSelection(loaded.shows, m[1]).ids, now);
    }
    if (!res) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: res.statusCode, headers: res.headers, body: res.body });
  });
}

test.describe('Songs I\'ve heard share links on a ?mine=1 page', () => {
  test.use({
    baseURL: ORIGIN,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  test('Copy link, Share link and the canonical give the same /r/ link, and it opens the record', async ({ page, context }) => {
    const loaded = await goose();
    await serve(page, loaded);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    // The share sheet, recorded rather than opened.
    await page.addInitScript(() => {
      window.__shared = [];
      navigator.share = (payload) => { window.__shared.push(payload); return Promise.resolve(); };
    });

    const logged = [[dateOf(3), 'Venue 3'], [dateOf(4), 'Venue 4'], [dateOf(5), 'Venue 5']];
    await page.goto(`/heard/goose/?mine=1#mine=${mineFragment(logged)}`);
    await expect(page.locator('.h-mine-line')).toContainText('From your 3 Goose shows');
    // The address bar is the personal ?mine=1 one; nothing below may use it.
    expect(page.url()).toBe(`${ORIGIN}/heard/goose/?mine=1`);

    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.locator('#h-share-msg')).toHaveText('Link copied.');
    const copied = await page.evaluate(() => navigator.clipboard.readText());

    await page.getByRole('button', { name: 'Share link' }).click();
    await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
    const shared = await page.evaluate(() => window.__shared[0]);

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');

    expect(copied).toMatch(/^https:\/\/mysetlists\.net\/heard\/goose\/r\/a[A-Za-z0-9_-]+\/$/);
    expect(shared.url).toBe(copied);
    expect(canonical).toBe(copied);
    expect(shared.title).toBe('A Goose record: 3 shows, 3 songs heard');

    const code = /\/r\/([^/]+)\/$/.exec(copied)[1];
    expect(heard.decodeSelection(loaded.shows, code).ids.sort()).toEqual(['s3', 's4', 's5']);

    // Signed out, in a fresh page: the same record.
    const other = await context.newPage();
    await serve(other, loaded);
    await other.goto(copied);
    await expect(other).toHaveTitle('A Goose record: 3 shows, 3 songs heard | MySetlists');
    await expect(other.locator('h1')).toHaveText('A Goose record: 3 shows, 3 songs heard');
  });
});
