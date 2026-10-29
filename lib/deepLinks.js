// lib/deepLinks.js
//
// Which in-app route a link opened on iOS should land on. Two kinds of
// link reach the native shell:
//
//   https://mysetlists.net/<path>?<query>   a universal link, for the paths
//                                          public/.well-known/apple-app-site-association
//                                          lists (app screens only; the
//                                          public web pages stay in Safari)
//   mysetlists://<path>?<query>            the custom scheme (Info.plist
//                                          CFBundleURLSchemes)
//
// Capacitor hands either to the app as an `appUrlOpen` event, or as the
// launch URL on a cold start; components/layout/DeepLinkListener.jsx pushes
// the route this returns. Before 5.47.18 nothing did, so every link opened
// the app on whatever screen it last showed.
//
// The old path shapes netlify.toml 301s on the web (/shows/<id>,
// /venues/<key>, …) are rewritten the same way here: there is no Netlify
// between a link and the bundle (see CLAUDE.md's routing section). A path
// lib/navRoutes.js doesn't know is not followed.

import { normalizePath, resolveRoute } from '@/lib/navRoutes';

const WEB_HOSTS = ['mysetlists.net', 'www.mysetlists.net'];
const SCHEME = 'mysetlists:';

// The custom-scheme links the app handles elsewhere. Spotify's sign-in
// returns to mysetlists://spotify-callback (components/PlaylistCreatorModal.jsx).
const HANDLED_ELSEWHERE = ['/spotify-callback'];

// netlify.toml's 301s, in the same order. Each match gives the route and
// the query it adds.
const LEGACY_SHAPES = [
  [/^\/shows\/([^/]+)$/, (m) => ['/shows', { show: m[1] }]],
  [/^\/venues\/([^/]+)$/, (m) => ['/venues', { venue: m[1] }]],
  [/^\/venue-dashboard\/([^/]+)$/, (m) => ['/venue-dashboard', { venue: m[1] }]],
  [/^\/year-in-review\/([^/]+)\/([^/]+)$/, (m) => ['/year-in-review', { user: m[1], year: m[2] }]],
  [/^\/festivals\/([^/]+)$/, (m) => ['/festivals', { festival: m[1] }]],
  [/^\/upcoming$/, () => ['/shows', {}]],
];

/** The path a link names, or null for a link that isn't one of ours. */
function linkPath(url) {
  if (url.protocol === 'https:' && WEB_HOSTS.includes(url.hostname)) return url.pathname;
  if (url.protocol !== SCHEME) return null;
  // mysetlists://shows/?show=1 parses with "shows" as the host;
  // mysetlists://localhost/shows/ is the WebView's own origin.
  if (!url.hostname || url.hostname === 'localhost') return url.pathname || '/';
  return `/${url.hostname}${url.pathname}`;
}

/**
 * The in-app href for a link opened on iOS ('/shows/?show=abc'), or null
 * when the app should not navigate for it.
 */
export function deepLinkTarget(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    return null;
  }
  const raw = linkPath(url);
  if (raw == null) return null;

  let path = normalizePath(safeDecode(raw));
  if (HANDLED_ELSEWHERE.some((p) => path === p || path.startsWith(`${p}/`))) return null;

  const params = new URLSearchParams(url.search);
  for (const [pattern, rewrite] of LEGACY_SHAPES) {
    const m = path.match(pattern);
    if (!m) continue;
    const [to, add] = rewrite(m);
    path = to;
    Object.entries(add).forEach(([k, v]) => params.set(k, v));
    break;
  }

  if (!resolveRoute(path, params).known) return null;
  const query = params.toString();
  // The static export's own shape: every route ends in a slash.
  const href = path === '/' ? '/' : `${path}/`;
  return query ? `${href}?${query}` : href;
}

/**
 * Whether a sign-in should send the app back to My Shows, given the last
 * account signed in on this page (undefined before any) and the new one.
 *
 * Only when it is a different account: the URL may still name the last
 * one's show. Signing out already goes to `/` (AppContext's
 * handleLogout), so a signed-out visitor still on a detail URL got there
 * from a link — an email's /venues/?venue=… or /year-in-review/?…, a
 * /my-poster/ "Make your own" — and signing in should land on it. Until
 * 5.49.3 every sign-in from signed out went to My Shows instead.
 *
 * A guest signing in still goes to My Shows: the URL may name one of the
 * guest's local shows, which the migration prompt is about to move.
 */
export function signInLeavesRoute(lastSignedInUid, uid, wasGuest = false) {
  if (!uid) return false;
  return wasGuest || Boolean(lastSignedInUid && lastSignedInUid !== uid);
}

function safeDecode(path) {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}
