/**
 * Unit tests for lib/navRoutes.js — the route → parent table the mobile
 * back control and the swipe gesture both read.
 *
 * The case this table exists for is the COLD DEEP LINK: a shared
 * /shows/<id> URL, a push notification, the app resuming straight into a
 * detail route. There is no in-app history there, so router.back() either
 * does nothing or leaves the app — and the back control still has to go
 * somewhere sensible. Hence a static parent for every screen.
 *
 * The other thing pinned here is the FLOORS. A gesture that can navigate
 * out of a tab root is a gesture that can drop the user out of the app.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/navRoutes.test.js
 */

import assert from 'assert';
import {
  ROOT_ROUTES, isRootRoute, normalizePath, resolveRoute,
} from '@/lib/navRoutes';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

/** Stand-in for URLSearchParams, which is all resolveRoute asks of it. */
function params(obj) {
  return { get: (k) => (k in obj ? obj[k] : null) };
}

// ── Path normalization ────────────────────────────────────────────────

test('the static export serves paths with and without a trailing slash', () => {
  // Netlify serves both spellings, so every comparison has to fold them.
  assert.strictEqual(normalizePath('/shows/'), '/shows');
  assert.strictEqual(normalizePath('/shows'), '/shows');
  assert.strictEqual(normalizePath('/stats/songs/'), '/stats/songs');
});

test('the site root normalizes to a single slash, not the empty string', () => {
  assert.strictEqual(normalizePath('/'), '/');
  assert.strictEqual(normalizePath(''), '/');
  assert.strictEqual(normalizePath(null), '/');
  assert.strictEqual(normalizePath(undefined), '/');
});

// ── Floors ────────────────────────────────────────────────────────────

test('every tab root plus / is a floor', () => {
  ['/', '/shows', '/search', '/stats', '/profile'].forEach((p) => {
    assert.strictEqual(isRootRoute(p), true, `${p} must be a floor`);
    assert.strictEqual(resolveRoute(p).isRoot, true, `${p} must resolve as root`);
    assert.strictEqual(resolveRoute(p).parentHref, null, `${p} must have no parent`);
  });
});

test('the floors are exactly the MobileTabBar roots plus /, minus the removed /upcoming', () => {
  // If a route is added to ROOT_ROUTES it becomes un-navigable-back-from,
  // which is a deliberate act rather than a convenience. /upcoming left in
  // 5.40.0 — it only redirects to My Shows now.
  assert.deepStrictEqual(
    [...ROOT_ROUTES].sort(),
    ['/', '/profile', '/search', '/shows', '/stats'],
  );
});

test('a floor is a floor with a trailing slash too', () => {
  assert.strictEqual(isRootRoute('/shows/'), true);
  assert.strictEqual(resolveRoute('/shows/').isRoot, true);
});

test('a pushed route is not a floor', () => {
  ['/shows/abc123', '/stats/songs', '/friends', '/wishlist'].forEach((p) => {
    assert.strictEqual(isRootRoute(p), false, `${p} must not be a floor`);
  });
});

// ── Deep links ────────────────────────────────────────────────────────

test('a deep-linked show goes back to the library, not into nothing', () => {
  const r = resolveRoute('/shows/abc123');
  assert.strictEqual(r.isRoot, false);
  assert.strictEqual(r.parentHref, '/shows');
  assert.strictEqual(r.parentTitle, 'My Shows');
  assert.strictEqual(r.title, 'Show');
});

test('a stats sub-page goes back to stats', () => {
  ['/stats/songs', '/stats/runs', '/stats/top-artists', '/stats/top-venues'].forEach((p) => {
    assert.strictEqual(resolveRoute(p).parentHref, '/stats', `${p} → /stats`);
    assert.strictEqual(resolveRoute(p).parentTitle, 'Stats');
  });
});

test('a venue dashboard goes back to its own venue, not to the library', () => {
  // The parent is a function of the query here: a dashboard is reached
  // from that venue's page, so that is where back belongs.
  const r = resolveRoute('/venue-dashboard/', new URLSearchParams('venue=red rocks::morrison'));
  assert.strictEqual(r.parentHref, '/venues/?venue=red%20rocks%3A%3Amorrison');
  assert.strictEqual(r.parentTitle, 'Venue');
});

test('a venue dashboard with no venue selected goes back to the library', () => {
  assert.strictEqual(resolveRoute('/venue-dashboard/').parentHref, '/shows');
});

test('a venue page goes back to the library', () => {
  const r = resolveRoute('/venues/', new URLSearchParams('venue=x::y'));
  assert.strictEqual(r.title, 'Venue');
  assert.strictEqual(r.parentHref, '/shows');
});

test('a year in review goes back home', () => {
  const r = resolveRoute('/year-in-review/', new URLSearchParams('user=user123&year=2025'));
  assert.strictEqual(r.title, 'Year in Review');
  assert.strictEqual(r.parentHref, '/');
});

test('every parent named by the table is itself a known route', () => {
  // A parent pointing at a path the table cannot resolve would give the
  // back control a title of "Back" and hide a typo.
  const paths = [
    '/shows/x', '/songs', '/runs', '/tours', '/festivals', '/wishlist',
    '/bucket-list', '/setlist-photos', '/scan-import', '/venues',
    '/stats/runs', '/stats/songs', '/stats/top-artists', '/stats/top-venues',
    '/advanced-search', '/friends', '/invite', '/activity', '/notifications',
    '/meetups', '/community', '/roadmap', '/feedback', '/how-to-use',
    '/release-notes', '/admin', '/admin/venue-verifications', '/bands',
  ];
  paths.forEach((p) => {
    const r = resolveRoute(p);
    assert.ok(r.parentHref, `${p} must declare a parent`);
    assert.notStrictEqual(r.parentTitle, 'Back', `${p}'s parent ${r.parentHref} is unknown to the table`);
  });
});

test('admin nests one level deeper rather than jumping to the profile', () => {
  assert.strictEqual(resolveRoute('/admin/venue-verifications').parentHref, '/admin');
  assert.strictEqual(resolveRoute('/admin').parentHref, '/profile');
});

// ── Query-selected detail views ───────────────────────────────────────

test('a list screen showing a detail view is a child of itself', () => {
  // /songs?song=x renders SongDetailView, not the list. usePathname cannot
  // see that, so without the query the back control would skip the song
  // list entirely and jump to the library.
  const r = resolveRoute('/songs', params({ song: 'hot-tea' }));
  assert.strictEqual(r.isRoot, false);
  assert.strictEqual(r.parentHref, '/songs');
  assert.strictEqual(r.parentTitle, 'Songs');
  assert.strictEqual(r.title, 'Song');
});

test('the same screen with no detail param is still the list', () => {
  const r = resolveRoute('/songs', params({}));
  assert.strictEqual(r.parentHref, '/shows');
  assert.strictEqual(r.title, 'Songs');
});

test('an unrelated query param does not turn a list into a detail view', () => {
  // A filter or a sort must not make the back control point at the screen
  // the user is already on.
  const r = resolveRoute('/songs', params({ sort: 'count' }));
  assert.strictEqual(r.parentHref, '/shows');
});

test('every query-selected detail screen is covered', () => {
  const cases = [
    ['/songs', 'song', 'Songs'],
    ['/runs', 'run', 'Runs'],
    ['/tours', 'tour', 'Tours'],
    ['/meetups', 'id', 'Meetups'],
  ];
  cases.forEach(([path, key, listTitle]) => {
    const r = resolveRoute(path, params({ [key]: 'x' }));
    assert.strictEqual(r.parentHref, path, `${path}?${key}= → ${path}`);
    assert.strictEqual(r.parentTitle, listTitle);
  });
});

test('/shows has three independent detail selectors: ?show=, ?upcoming= and ?venueKey=', () => {
  const show = resolveRoute('/shows', params({ show: 'abc123' }));
  assert.strictEqual(show.parentHref, '/shows');
  assert.strictEqual(show.parentTitle, 'My Shows');
  assert.strictEqual(show.title, 'Show');

  // An upcoming show (5.43.0) is a detail view on the same real route, so
  // back returns to the list rather than out of the app.
  const upcoming = resolveRoute('/shows', params({ upcoming: 'up1' }));
  assert.strictEqual(upcoming.parentHref, '/shows');
  assert.strictEqual(upcoming.parentTitle, 'My Shows');
  assert.strictEqual(upcoming.title, 'Upcoming Show');
  assert.strictEqual(upcoming.isRoot, false);

  const venue = resolveRoute('/shows', params({ venueKey: 'red rocks::morrison' }));
  assert.strictEqual(venue.parentHref, '/shows');
  assert.strictEqual(venue.parentTitle, 'My Shows');
  assert.strictEqual(venue.title, 'Venue');

  const bare = resolveRoute('/shows', params({}));
  assert.strictEqual(bare.isRoot, true);
  assert.strictEqual(bare.title, 'My Shows');
});

test('a band screen goes back to Top Artists; one of its songs goes back to that band', () => {
  const band = resolveRoute('/bands/', params({ band: 'goose' }));
  assert.strictEqual(band.isRoot, false);
  assert.strictEqual(band.title, 'Band');
  assert.strictEqual(band.parentHref, '/stats/top-artists');
  assert.strictEqual(band.parentTitle, 'Top Artists');

  // The cold deep link the iOS app is checked on.
  const song = resolveRoute('/bands/', params({ band: 'goose', song: 'arcadia' }));
  assert.strictEqual(song.title, 'Song');
  assert.strictEqual(song.parentHref, '/bands/?band=goose');
  assert.strictEqual(song.parentTitle, 'Band');
  assert.strictEqual(resolveRoute(song.parentHref.split('?')[0], new URLSearchParams(song.parentHref.split('?')[1])).title, 'Band');
});

test('resolveRoute works with no search params at all', () => {
  // The header passes whatever useSearchParams returns, which is null
  // before hydration.
  assert.strictEqual(resolveRoute('/songs', null).title, 'Songs');
  assert.strictEqual(resolveRoute('/songs').title, 'Songs');
});

// ── Unknown routes ────────────────────────────────────────────────────

test('an unmapped route still gets a working back control', () => {
  // Better a generic back than the nothing these screens had before.
  const r = resolveRoute('/some/route/nobody/mapped');
  assert.strictEqual(r.known, false);
  assert.strictEqual(r.isRoot, false);
  assert.strictEqual(r.parentHref, '/shows');
  assert.ok(r.parentTitle);
});

test('an unmapped route is never treated as a floor', () => {
  // Resolving as root would leave it with no back control at all.
  assert.strictEqual(resolveRoute('/typo').isRoot, false);
});

test('a known route is flagged as known', () => {
  assert.strictEqual(resolveRoute('/shows').known, true);
  assert.strictEqual(resolveRoute('/shows/abc').known, true);
});

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
