// lib/heardLinks.js
//
// The app's links into "Songs I've heard" (/heard/<slug>/, a web page
// rendered by netlify/functions/public-heard.js, not an app route). The
// tool pre-ticks a signed-in user's own shows from two places, both read by
// netlify/functions/lib/heardClient.js:
//
//   #have=YYYYMMDD.YYYYMMDD…   in the link from the Stats page. A fragment,
//                              so the dates never reach a server. On iOS
//                              the tool opens in the system browser, which
//                              shares nothing else with the app.
//   localStorage mysetlists_heard_have
//                              { <slug>: ['YYYY-MM-DD', …] }, kept current
//                              on the web (same origin as the tool) for
//                              someone who finds the tool from a search.
//                              Cleared on sign-out.
//
// Only the archive-backed bands have the tool: the same rule as
// HEARD_SOURCES in netlify/functions/lib/publicArtistSnapshot.js.

import publicArtists from '@/config/public-artists.json';
import { artistNameKeyLoose } from '@/lib/setlistSources';
import { isNativePlatform } from '@/lib/platform';

const SITE_URL = 'https://mysetlists.net';
const HAVE_KEY = 'mysetlists_heard_have';

export const HEARD_BANDS = publicArtists.artists
  .filter((a) => a.songPages && (a.source === 'songfish' || a.source === 'phishnet'))
  .map((a) => ({ slug: a.slug, name: a.name, key: artistNameKeyLoose(a.name) }));

/** The user's shows per tool band, most shows first: [{ slug, name, dates }]. */
export function heardBandsFor(shows = []) {
  const byKey = new Map(HEARD_BANDS.map((b) => [b.key, { slug: b.slug, name: b.name, dates: [] }]));
  for (const show of shows) {
    const band = show && byKey.get(artistNameKeyLoose(show.artist));
    if (band && /^\d{4}-\d{2}-\d{2}$/.test(show.date || '')) band.dates.push(show.date);
  }
  return [...byKey.values()].filter((b) => b.dates.length).sort((a, b) => b.dates.length - a.dates.length);
}

/** The tool's URL for a band; with the user's dates when given. */
export function heardHref(slug, dates = []) {
  const base = isNativePlatform() ? SITE_URL : '';
  const have = dates.length ? `#have=${[...new Set(dates)].sort().map((d) => d.replace(/-/g, '')).join('.')}` : '';
  return `${base}/heard/${slug}/${have}`;
}

/** Keeps mysetlists_heard_have in step with the signed-in user's shows; null clears it. */
export function rememberHeardShows(shows) {
  try {
    if (!shows) { localStorage.removeItem(HAVE_KEY); return; }
    const mine = {};
    for (const band of heardBandsFor(shows)) mine[band.slug] = band.dates;
    if (Object.keys(mine).length) localStorage.setItem(HAVE_KEY, JSON.stringify(mine));
    else localStorage.removeItem(HAVE_KEY);
  } catch {
    // Storage blocked: the tool just won't pre-tick.
  }
}
