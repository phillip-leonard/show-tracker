/**
 * Helper for navigating to a show detail view.
 * Uses the query-param pattern: /shows/?show=<id>
 * This is the only correct way to navigate to a show in this app.
 */
export function showHref(id) {
  return `/shows/?show=${encodeURIComponent(id)}`;
}

/**
 * An upcoming show's detail view: /shows/?upcoming=<id>, on the same real,
 * pre-rendered /shows route as a past show (see CLAUDE.md's routing
 * section). lib/navRoutes.js declares `upcoming` as a /shows detail param,
 * so the mobile back control returns to the list.
 */
export function upcomingShowHref(id) {
  return `/shows/?upcoming=${encodeURIComponent(id)}`;
}

/**
 * A venue's page: /venues/?venue=<venueKey>. Same reason as showHref: the
 * old /venues/<key>/ was a dynamic route with only a `_` placeholder in
 * out/, so every real venue key fell through to the root page on a reload
 * or an email link. netlify.toml 301s the old shape here.
 */
export function venueHref(venueKey) {
  return `/venues/?venue=${encodeURIComponent(venueKey)}`;
}

/** A verified owner's venue dashboard: /venue-dashboard/?venue=<venueKey>. */
export function venueDashboardHref(venueKey) {
  return `/venue-dashboard/?venue=${encodeURIComponent(venueKey)}`;
}

/** A user's Year in Review: /year-in-review/?user=<uid>&year=<yyyy>. */
export function yearInReviewHref(uid, year) {
  return `/year-in-review/?user=${encodeURIComponent(uid)}&year=${encodeURIComponent(year)}`;
}

/**
 * A band screen in the app: /bands/?band=<slug>, built from the public band
 * snapshot (lib/bandScreens.js). Not /artist/<slug>/: on the web that path
 * is the public band page, a Netlify Function, and nothing for it is in
 * out/ or the iOS bundle.
 */
export function bandHref(slug) {
  return `/bands/?band=${encodeURIComponent(slug)}`;
}

/** One song of that band: /bands/?band=<slug>&song=<songSlug>. */
export function bandSongHref(slug, songSlug) {
  return `/bands/?band=${encodeURIComponent(slug)}&song=${encodeURIComponent(songSlug)}`;
}
