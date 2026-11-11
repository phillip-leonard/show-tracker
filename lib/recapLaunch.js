// lib/recapLaunch.js
//
// When the 2026 recap (components/yearInReview/YearRecapView.jsx) is shown,
// and when it is promoted. One place, so the page, the My Shows banner, the
// Stats card and the default year can't disagree.
//
//   launch   2026-12-02 00:00 Pacific. Before it, /year-in-review/ keeps the
//            old layout for every year, 2026 included.
//   promo    launch → 2027-01-15 (end of day, Pacific): the My Shows banner
//            and the Stats card. The App Store In-App Event runs Dec 2 –
//            Jan 1 and links to recapHref().
//
// The iOS app bundles this file, so the dates are fixed in the build that
// ships before Dec 2. To see the new layout early:
//   - RECAP_FORCE_LIVE = true here, for a test build or a local run, or
//   - ?recap=preview on /year-in-review/, honoured for admins only
//     (AppContext's isAdmin), on any build, web or iOS.
//
// Pacific midnight is 08:00 UTC in December (PST, no daylight saving).

/** The year the recap layout exists for. */
export const RECAP_YEAR = 2026;

/** Flip to true to show the recap before launch (testing only). */
export const RECAP_FORCE_LIVE = false;

export const RECAP_LAUNCH_AT = Date.UTC(RECAP_YEAR, 11, 2, 8, 0, 0); // Dec 2, 00:00 PST
export const RECAP_PROMO_ENDS_AT = Date.UTC(RECAP_YEAR + 1, 0, 16, 8, 0, 0); // end of Jan 15 PST

/** True once the recap is live. */
export function recapLive(now = Date.now()) {
  return RECAP_FORCE_LIVE || now >= RECAP_LAUNCH_AT;
}

/** True while the banner and the Stats card should show (Dec 2 – Jan 15). */
export function recapPromoActive(now = Date.now()) {
  return recapLive(now) && now < RECAP_PROMO_ENDS_AT;
}

/** The admin preview switch: /year-in-review/?recap=preview. */
export function recapPreviewRequested(searchParams) {
  return searchParams?.get?.('recap') === 'preview';
}

/**
 * Whether a review for `year` uses the recap layout. Only RECAP_YEAR, only
 * once live, or for an admin asking for the preview.
 */
export function usesRecapLayout(year, { now = Date.now(), preview = false, isAdmin = false } = {}) {
  if (Number(year) !== RECAP_YEAR) return false;
  return recapLive(now) || (preview && isAdmin);
}

/**
 * The year /year-in-review/ opens on with no ?year=: this year once its
 * recap is live (December 2026), else last year, as before. In January
 * 2027 "last year" is already 2026.
 */
export function defaultReviewYear(now = Date.now()) {
  const thisYear = new Date(now).getFullYear();
  return thisYear === RECAP_YEAR && recapLive(now) ? RECAP_YEAR : thisYear - 1;
}

/** The recap's own link: the event deep link, the banner, the emails. */
export function recapHref(year = RECAP_YEAR) {
  return `/year-in-review/?year=${year}`;
}
