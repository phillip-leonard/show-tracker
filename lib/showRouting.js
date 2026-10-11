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
