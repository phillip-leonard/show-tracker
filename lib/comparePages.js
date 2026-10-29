// lib/comparePages.js
//
// The SEO comparison pages: /compare/concert-archives/,
// /compare/setlist-fm/ and /best-concert-tracker-apps-jam-bands/, and the
// switcher's guide /switch/concert-archives/.
//
// They are web pages, not app screens. Each one is a real route in the
// static export (out/compare/concert-archives/index.html and so on), so
// crawlers get the full HTML, and components/compare/ComparePage.jsx gives
// them their own header and footer. AppProviderWrapper renders them
// without the signed-in shell, signed in or not.
//
// In the iOS app they are reached only from the landing page footer, and
// open on https://mysetlists.net in the system browser rather than in the
// app's webview (comparePageClick below): they're marketing for the
// website, not part of the app.
//
// The sitemap (netlify/functions/sitemap.js) and public/_headers list the
// same paths. Add a page in all three places.

import { externalLinkClick } from '@/lib/publicProfile';

export const SITE_URL = 'https://mysetlists.net';

export const COMPARE_PAGES = [
  { path: '/compare/concert-archives/', label: 'MySetlists vs Concert Archives' },
  { path: '/compare/setlist-fm/', label: 'MySetlists vs setlist.fm' },
  { path: '/best-concert-tracker-apps-jam-bands/', label: 'Best concert trackers for jam fans' },
  { path: '/switch/concert-archives/', label: 'Switching from Concert Archives' },
];

// Where "Sign in and import" goes: the file import on Scan / Import. A
// signed-out visitor sees the landing page with this URL kept, and lands
// here after signing in (signInLeavesRoute in lib/deepLinks.js). Not
// ?tab=, which AppContext strips from every URL for the Friends deep link.
export const IMPORT_HREF = '/scan-import/?import=1';

// "Start tracking your shows". `/?signup=1` opens the sign-up form on the
// landing page (see the ?signup effect in context/AppContext.jsx); a visitor
// who is already signed in just lands on their shows.
export const SIGNUP_HREF = '/?signup=1';

// "Get the iPhone app". The button is left out if this is ever emptied.
export const APP_STORE_URL = 'https://apps.apple.com/us/app/mysetlists-concert-tracker/id6760633144';

const normalizedPath = (pathname) => (pathname || '').replace(/\/+$/, '') || '/';

export function isComparePath(pathname) {
  const path = normalizedPath(pathname);
  return COMPARE_PAGES.some((p) => normalizedPath(p.path) === path);
}

/** onClick for a link to a comparison page: the system browser on iOS. */
export function comparePageClick(e, path) {
  externalLinkClick(e, `${SITE_URL}${path}`);
}
