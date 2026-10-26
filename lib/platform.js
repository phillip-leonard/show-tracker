// lib/platform.js
//
// One place that answers "where is this running, and how big is the screen".
//
// Before this existed the app had exactly one mechanism for "this is a
// phone" — Tailwind's `md:` breakpoint — and no JS equivalent at all. The
// gesture layer needs a JS answer, and two sources of truth that can drift
// apart is how you end up with a header that thinks it's on mobile and a
// gesture that thinks it isn't. MOBILE_MEDIA_QUERY below is derived from
// the same 768px that `md:` uses, so CSS and JS cannot disagree.

// Tailwind's `md` breakpoint is 768px, so "mobile" is everything under it.
// Keep in lockstep with tailwind.config.js if that ever changes.
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

/**
 * Content-column width (CSS px, inside the column's padding) at which the
 * native app shows My Shows as a list beside the open show, instead of one
 * screen at a time. See hooks/useSplitView.js.
 *
 * 600 fits a 256px list pane, a 16px gap and a show pane of at least
 * ~330px, which is what ShowDetailView already renders at on a phone.
 * It is a width on the content column, not on the viewport, so the
 * sidebar and side insets are already taken off. iPhones never reach it
 * (an iPhone Pro Max in landscape leaves ~510px beside the sidebar); the
 * open inner display of iPhone Duo in portrait does.
 */
export const SPLIT_VIEW_MIN_WIDTH = 600;

// Part 3.6: edge-swipe-back inside an ordinary mobile browser tab.
//
// Off by default. iOS Safari and Chrome both own the left edge, and a
// JS gesture competing with the browser's own back gesture produces a
// fight the user always loses. Native and installed-PWA have no browser
// chrome, so there the gesture is the only back affordance and is always on.
//
// This is deliberately one constant so the behaviour is one line to flip
// if device testing says otherwise.
export const EDGE_SWIPE_BACK_IN_BROWSER_TAB = false;

/**
 * Master switch for the three swipe gestures: edge-back, sheet swipe-down,
 * and drawer swipe-close.
 *
 * ON as of 5.44.1 / iOS 3.6.2. It was off from 5.36.1 (build 3.1) to
 * then because each gesture fires a haptic through `impact`, which
 * lib/capacitor.js did not export — so all three threw a TypeError partway
 * through their commit handler, before the navigate, the dismiss, or the
 * drawer close that follows it. `impact` is now exported and never
 * rejects (lib/__tests__/haptics.test.js).
 *
 * Each gesture is an enhancement over a control that still works by tap,
 * so flipping this back to false is always a safe way out.
 */
export const TOUCH_GESTURES_ENABLED = true;

/**
 * Running inside the Capacitor native shell?
 *
 * Deliberately not re-exported from lib/native-auth — that module pulls in
 * firebase/auth, and the gesture layer has no business dragging the auth
 * SDK into its bundle. Same check, same answer, no dependency.
 */
export function isNativePlatform() {
  try {
    const { Capacitor } = require('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Running as an installed PWA (added to home screen / installed from a
 * desktop browser) rather than in a browser tab?
 *
 * There was no standalone detection anywhere in the app before this.
 * `navigator.standalone` is the iOS Safari legacy spelling and is still
 * the only one that answers correctly for a home-screen app on older iOS.
 */
export function isStandaloneDisplayMode() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true;
    return window.navigator?.standalone === true;
  } catch {
    return false;
  }
}

/**
 * True where the app owns the whole screen and the user therefore has no
 * browser back button of their own: native, or an installed PWA.
 */
export function isChromelessApp() {
  return isNativePlatform() || isStandaloneDisplayMode();
}

/**
 * Should the left-edge back gesture be live?
 *
 * @param {boolean} isMobile — from useIsMobile(); desktop/tablet never gets it.
 */
export function isEdgeSwipeBackEnabled(isMobile) {
  if (!TOUCH_GESTURES_ENABLED) return false;
  if (!isMobile) return false;
  if (isChromelessApp()) return true;
  return EDGE_SWIPE_BACK_IN_BROWSER_TAB;
}
