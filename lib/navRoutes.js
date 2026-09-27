// lib/navRoutes.js
//
// Where every screen sits in the hierarchy, and what its parent is.
//
// WHY A TABLE RATHER THAN router.back(). On a cold launch straight into a
// detail route — a shared /shows/<id> link, a push notification, the app
// resuming on a deep link — there is no in-app history to go back to.
// `router.back()` there either does nothing or leaves the app entirely.
// So the parent is *derived from the route*, statically, and the back
// control always has somewhere to go.
//
// ROOT_ROUTES are floors: the gesture layer and the header both refuse to
// go back out of them. They are the routes the (currently dormant,
// never-mounted) MobileTabBar names, plus `/` — minus /upcoming, which was
// removed in 5.40.0 and now only redirects to My Shows (the dormant tab
// bar still lists it; see app/upcoming/page.jsx). Mounting that tab bar is an
// information-architecture decision and is deliberately not made here —
// this table only records which routes are logical roots.

/** Routes you cannot go back out of. */
export const ROOT_ROUTES = ['/', '/shows', '/search', '/stats', '/profile'];

/**
 * The static export serves every path with and without a trailing slash,
 * so every comparison in here normalizes first.
 */
export function normalizePath(pathname) {
  if (!pathname) return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function isRootRoute(pathname) {
  return ROOT_ROUTES.includes(normalizePath(pathname));
}

// Ordered: the first pattern that matches wins, so put specific paths
// (/stats/songs) above the prefixes that would also match them (/stats).
//
// `title`  — what this screen is called.
// `parent` — href of the screen the back control returns to, or a function
//            of the matched path segments for routes whose parent depends
//            on the URL (a venue dashboard belongs to its own venue).
const ROUTES = [
  // Roots
  { path: '/',          title: 'My Shows' },
  // /shows has two independent query-selected detail views: ?show= (a
  // single show) and ?venueKey= (every one of the user's shows at that
  // venue) — see app/shows/page.jsx. Order matters only if both were ever
  // present at once, which the app never does.
  { path: '/shows',     title: 'My Shows',       detailParams: [
    { param: 'show', title: 'Show' },
    { param: 'venueKey', title: 'Venue' },
  ] },
  // Pre-existing gap, unrelated to the /shows detailParams above: the app
  // itself never links to /shows/<id> (see lib/showRouting.js — every
  // in-app navigation goes through the ?show= query-param pattern instead,
  // since this app is a static export and a dynamic route with a runtime id
  // can't be served). But a raw /shows/<id> URL can still reach the client
  // router directly — a push notification or an old deep link opened
  // straight into the native shell, where there is no Netlify redirect to
  // rewrite it first (see CLAUDE.md's routing section). Without this entry
  // the table falls through to the generic "unknown route" case and the
  // back control loses its title, which is what left this row's own test
  // (navRoutes.test.js: "a deep-linked show goes back to the library")
  // failing.
  { path: '/shows/:id', title: 'Show', parent: '/shows', parentTitle: 'My Shows' },
  { path: '/search',    title: 'Search' },
  { path: '/stats',     title: 'Stats' },
  { path: '/profile',   title: 'Profile' },

  // `detailParam` marks a screen that becomes a detail view when that query
  // param is present — /songs?song=x renders SongDetailView, not the list.
  // usePathname() cannot see that, so without this the back control on a
  // song would skip its own list and jump to the library.
  { path: '/songs',           title: 'Songs',          parent: '/shows', detailParam: 'song', detailTitle: 'Song' },
  { path: '/runs',            title: 'Runs',           parent: '/shows', detailParam: 'run',  detailTitle: 'Run' },
  { path: '/tours',           title: 'Tours',          parent: '/shows', detailParam: 'tour', detailTitle: 'Tour' },
  { path: '/festivals',       title: 'Festivals',      parent: '/shows' },
  { path: '/wishlist',        title: 'Wishlist',       parent: '/shows' },
  { path: '/bucket-list',     title: 'Bucket List',    parent: '/shows' },
  { path: '/setlist-photos',  title: 'Setlist Photos', parent: '/shows' },
  { path: '/scan-import',     title: 'Scan / Import',  parent: '/shows' },
  { path: '/venues/:key',     title: 'Venue',          parent: '/shows' },
  // A venue dashboard is reached from that venue's own page, so its back
  // control returns there rather than to the library.
  {
    path: '/venue-dashboard/:key',
    title: 'Venue Dashboard',
    parent: ({ key }) => `/venues/${key}`,
    parentTitle: 'Venue',
  },

  // Pushed from /stats
  { path: '/stats/runs',        title: 'Runs',        parent: '/stats' },
  { path: '/stats/songs',       title: 'Songs',       parent: '/stats' },
  { path: '/stats/top-artists', title: 'Top Artists', parent: '/stats' },
  { path: '/stats/top-venues',  title: 'Top Venues',  parent: '/stats' },
  { path: '/year-in-review/:userId/:year', title: 'Year in Review', parent: '/' },

  // Pushed from /search
  { path: '/advanced-search', title: 'Advanced Search', parent: '/search' },

  // Pushed from /profile
  { path: '/friends',       title: 'Friends',       parent: '/profile' },
  { path: '/invite',        title: 'Invite',        parent: '/friends' },
  { path: '/activity',      title: 'Activity',      parent: '/profile' },
  { path: '/notifications', title: 'Notifications', parent: '/profile' },
  { path: '/meetups',       title: 'Meetups',       parent: '/profile', detailParam: 'id', detailTitle: 'Meetup' },
  { path: '/community',     title: 'Community',     parent: '/profile' },
  { path: '/roadmap',       title: 'Roadmap',       parent: '/profile' },
  { path: '/feedback',      title: 'Feedback',      parent: '/profile' },
  { path: '/how-to-use',    title: 'How to Use',    parent: '/profile' },
  { path: '/release-notes', title: 'Release Notes', parent: '/profile' },

  // Admin
  { path: '/admin',                     title: 'Admin',              parent: '/profile' },
  { path: '/admin/venue-verifications', title: 'Venue Verifications', parent: '/admin' },
];

function matchPattern(pattern, segments) {
  const patternSegments = normalizePath(pattern).split('/').filter(Boolean);
  if (patternSegments.length !== segments.length) return null;
  const params = {};
  for (let i = 0; i < patternSegments.length; i += 1) {
    const p = patternSegments[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(segments[i]);
    } else if (p !== segments[i]) {
      return null;
    }
  }
  return params;
}

function findRoute(pathname) {
  const segments = normalizePath(pathname).split('/').filter(Boolean);
  for (const route of ROUTES) {
    const params = matchPattern(route.path, segments);
    if (params) return { route, params };
  }
  return null;
}

function titleForHref(href) {
  const found = findRoute(href);
  return found ? found.route.title : null;
}

/**
 * Everything the mobile header needs to render its leading slot and title.
 *
 * @param {string} pathname
 * @param {URLSearchParams|null} [searchParams] — needed for the screens
 *   whose detail view is selected by a query param rather than by path.
 */
export function resolveRoute(pathname, searchParams = null) {
  const normalized = normalizePath(pathname);
  const found = findRoute(normalized);

  if (!found) {
    // An unmapped route still gets a back control — it just points at the
    // library rather than at a named parent. Better a working generic back
    // than no way out, which is what those screens have today.
    return {
      title: null,
      isRoot: false,
      parentHref: '/shows',
      parentTitle: 'My Shows',
      known: false,
    };
  }

  const { route, params } = found;

  // A list screen showing a detail view is a child of itself: back returns
  // to the list, not to the list's parent. This also makes such a screen
  // non-root even when the bare path is one. Most routes with a detail view
  // have exactly one selector param (`detailParam`); /shows has two
  // (`detailParams`), checked in declaration order.
  const detailSelectors = route.detailParams
    || (route.detailParam ? [{ param: route.detailParam, title: route.detailTitle }] : []);
  for (const selector of detailSelectors) {
    if (searchParams?.get?.(selector.param)) {
      return {
        title: selector.title || route.title,
        isRoot: false,
        parentHref: normalized,
        parentTitle: route.title,
        known: true,
      };
    }
  }

  if (!route.parent) {
    return { title: route.title, isRoot: true, parentHref: null, parentTitle: null, known: true };
  }

  const parentHref = typeof route.parent === 'function' ? route.parent(params) : route.parent;
  return {
    title: route.title,
    isRoot: false,
    parentHref,
    parentTitle: route.parentTitle || titleForHref(parentHref) || 'Back',
    known: true,
  };
}
