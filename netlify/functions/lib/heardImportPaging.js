// netlify/functions/lib/heardImportPaging.js
//
// "Import from setlist.fm" on /heard/<slug>/, the browser half: page
// through a user's attended list one function call per page.
//
// A Netlify function has 10 seconds, and setlist.fm allows about 2
// requests a second, so one call can read about a dozen pages (240
// attended shows). Until 5.47.15 heard-import.js read them all in one call
// and stopped there: a real account with 231 shows was cut off a page
// short. Now heard-import.js reads one page per call (?page=N), and this
// asks for page 1, learns how many pages there are, then the rest one
// after another, SPACING_MS apart.
//
// A page that fails is asked for again twice, after BACKOFF_MS and twice
// that. A 429 (setlist.fm or us, busy) waits, for Retry-After when it says,
// and is asked again up to RATE_LIMIT_WAITS times, apart from those two
// retries. A page that still fails is skipped and reported; the rest are
// still read. A 404 with an error (no such user, no such band) is final.
//
// Cancel keeps what was read before it.
//
// Like heardRecord.js's createHeard, the whole module is the body of
// createImportPaging(), which closes over nothing, so heardPages.js can
// inline it into the page and the tests can run it in Node.

function createImportPaging() {
  'use strict';

  const SPACING_MS = 500;
  const RETRIES = 2;
  const BACKOFF_MS = 1000;
  const RATE_LIMIT_WAITS = 5;
  const MAX_WAIT_MS = 10000;

  /**
   * The band's nights from every page read, in order, as heard-import.js
   * returns them ({ key, date, venue, city, id }, id null when the archive
   * has no match), merged into what the page shows. One night entered
   * twice on setlist.fm, even on two pages, is one show attended.
   * @returns { ids, unmatched: [{ date, venue, city }], attended }
   */
  function mergeNights(nights) {
    const ids = [];
    const unmatched = [];
    const seenIds = new Set();
    const seenNights = new Set();
    for (const n of nights) {
      if (!n || seenNights.has(n.key)) continue;
      seenNights.add(n.key);
      if (n.id) {
        if (!seenIds.has(n.id)) { seenIds.add(n.id); ids.push(n.id); }
      } else {
        unmatched.push({ date: n.date, venue: n.venue, city: n.city });
      }
    }
    return { ids, unmatched, attended: seenNights.size };
  }

  /**
   * @param opts.fetchPage  (page) => Promise<{ status, json }>; may throw
   *                        (a network error, or aborted by Cancel)
   * @param opts.sleep      (ms) => Promise; Cancel should end it early
   * @param opts.cancelled  () => true once Cancel is pressed
   * @param opts.onProgress ({ checked, total, found, page, pages })
   * @param opts.now        () => ms, for the spacing (tests pass a fake clock)
   * @returns { ids, unmatched, attended, checked, total, pages, skipped: [page],
   *            cancelled } or { error: 'not_found' | 'busy' | 'upstream' | … }
   *            when page 1 can't be read
   */
  async function importAttended(opts) {
    const fetchPage = opts.fetchPage;
    const sleep = opts.sleep;
    const cancelled = opts.cancelled || (() => false);
    const onProgress = opts.onProgress || (() => {});
    const now = opts.now || (() => Date.now());
    const spacing = opts.spacingMs == null ? SPACING_MS : opts.spacingMs;
    const retries = opts.retries == null ? RETRIES : opts.retries;
    const backoff = opts.backoffMs == null ? BACKOFF_MS : opts.backoffMs;

    let lastStart = -Infinity;
    async function pace() {
      const wait = lastStart + spacing - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
    }

    // One page: { json } | { error } | { cancelled: true }
    async function getPage(page) {
      let failures = 0;
      let rateWaits = 0;
      for (;;) {
        if (cancelled()) return { cancelled: true };
        await pace();
        if (cancelled()) return { cancelled: true };
        let res;
        try { res = await fetchPage(page); } catch (e) { res = { status: 0, json: null }; }
        if (cancelled()) return { cancelled: true };
        const json = res.json || {};
        if (res.status === 200 && json.ok) return { json };
        if (res.status === 404 && json.error) return { error: json.error };
        if (res.status === 429 && rateWaits < RATE_LIMIT_WAITS) {
          rateWaits++;
          const told = Number(json.retryAfter) * 1000;
          await sleep(Math.min(told > 0 ? told : backoff * 2 ** rateWaits, MAX_WAIT_MS));
          continue;
        }
        if (failures < retries) {
          failures++;
          await sleep(backoff * 2 ** (failures - 1));
          continue;
        }
        return { error: res.status === 429 ? 'busy' : (json.error || 'upstream') };
      }
    }

    const nights = [];
    const skipped = [];
    let checked = 0;
    let total = 0;
    let pages = 0;
    let stopped = false;
    const done = () => ({ ...mergeNights(nights), checked, total, pages, skipped, cancelled: stopped });
    const progress = (page) => onProgress({ checked, total, found: mergeNights(nights).attended, page, pages });
    const take = (json) => {
      checked += Number(json.count) || 0;
      if (Array.isArray(json.nights)) nights.push(...json.nights);
    };

    const first = await getPage(1);
    if (first.cancelled) { stopped = true; return done(); }
    if (first.error) return { error: first.error };
    total = Number(first.json.total) || 0;
    pages = Number(first.json.pages) || 1;
    take(first.json);
    progress(1);

    for (let page = 2; page <= pages; page++) {
      const res = await getPage(page);
      if (res.cancelled) { stopped = true; break; }
      if (res.error) skipped.push(page);
      else take(res.json);
      progress(page);
    }
    return done();
  }

  return { importAttended, mergeNights, SPACING_MS };
}

module.exports = { ...createImportPaging(), createImportPaging };
