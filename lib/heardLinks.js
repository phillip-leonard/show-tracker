// lib/heardLinks.js
//
// The app's links into "Songs I've heard" (/heard/<slug>/, a web page
// rendered by netlify/functions/public-heard.js, not an app route). A
// signed-in user's poster is made from every show they've logged for the
// band; the tool learns which shows from two places, both read by
// netlify/functions/lib/heardClient.js:
//
//   #mine=<base64url JSON [[date, venue], …]>
//                              in every link from the app ("Make my
//                              poster"). A fragment, so the shows never
//                              reach a server. On iOS the tool opens in the
//                              system browser, which shares nothing else
//                              with the app.
//   localStorage mysetlists_heard_have
//                              { <slug>: [[date, venue], …] }, kept current
//                              on the web (same origin as the tool) for
//                              someone who finds the tool from a search or
//                              a band page. Cleared on sign-out.
//
// The tool matches them to the archive's shows by date and venue
// (heardRecord.js matchLoggedShows). Links carry ?mine=1, which opens
// straight on the poster.
//
// Only the archive-backed bands have the tool: the same rule as
// HEARD_SOURCES in netlify/functions/lib/publicArtistSnapshot.js.

import { HEARD_BANDS, heardBandFor, heardBandsFor } from '@/lib/publicBands';
import { isNativePlatform } from '@/lib/platform';

const SITE_URL = 'https://mysetlists.net';
const HAVE_KEY = 'mysetlists_heard_have';

// The tool's bands and the lookups by name live in lib/publicBands.js
// (CommonJS, shared with the functions); re-exported here.
export { HEARD_BANDS, heardBandFor, heardBandsFor };

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The tool's URL for a band, opening on the poster made from `shows`. */
export function heardHref(slug, shows = []) {
  const base = isNativePlatform() ? SITE_URL : '';
  const mine = shows.length ? `#mine=${toBase64Url(JSON.stringify(shows.map((s) => [s.date, s.venue || ''])))}` : '';
  return `${base}/heard/${slug}/?mine=1${mine}`;
}

/** Keeps mysetlists_heard_have in step with the signed-in user's shows; null clears it. */
export function rememberHeardShows(shows) {
  try {
    if (!shows) { localStorage.removeItem(HAVE_KEY); return; }
    const mine = {};
    for (const band of heardBandsFor(shows)) mine[band.slug] = band.shows.map((s) => [s.date, s.venue]);
    if (Object.keys(mine).length) localStorage.setItem(HAVE_KEY, JSON.stringify(mine));
    else localStorage.removeItem(HAVE_KEY);
  } catch {
    // Storage blocked: the tool just won't find the user's shows.
  }
}
