// lib/publicProfile.js
//
// Links to the public profile pages. /u/{handle} and /u/{handle}/shows/{id}
// are NOT routes in this app: they're server-rendered HTML from
// netlify/functions/public-profile.js and public-show.js, reached through
// netlify.toml rewrites. So a link to one must be absolute:
//   - On the web a relative /u/... happens to work, because Netlify serves
//     the request.
//   - In the iOS app there is no Netlify. A relative /u/... resolves against
//     the bundled files, where nothing exists at that path, so it's a dead
//     link. It has to go to https://mysetlists.net and open in the system
//     browser (the Capacitor Browser plugin), not navigate the app's webview.

import { isNativePlatform } from '@/lib/platform';

const SITE_URL = 'https://mysetlists.net';

export function publicProfileUrl(handle) {
  return `${SITE_URL}/u/${encodeURIComponent(String(handle).toLowerCase())}/`;
}

export function publicShowUrl(handle, showId) {
  return `${SITE_URL}/u/${encodeURIComponent(String(handle).toLowerCase())}/shows/${encodeURIComponent(showId)}/`;
}

// Opens an external page: Capacitor's in-app browser sheet on iOS, a new tab
// on the web.
export async function openExternalUrl(url) {
  if (isNativePlatform()) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    } catch {
      // Plugin unavailable; fall through to window.open.
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

// onClick for an <a href={absoluteUrl} target="_blank">: on iOS, route the
// tap through the Browser plugin instead of the webview. On the web, leave
// the anchor's default behavior alone.
export function externalLinkClick(e, url) {
  if (!isNativePlatform()) return;
  e.preventDefault();
  openExternalUrl(url);
}
