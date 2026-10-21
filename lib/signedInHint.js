/**
 * The "was signed in" hint: one localStorage key that says this browser had
 * a signed-in user last time.
 *
 * WHY. The landing page is now the static HTML of `/`, painted before
 * Firebase Auth has said anything, so a crawler or a first-time visitor
 * sees it immediately. A returning user would see it too, for the half
 * second until auth resolves, and then watch it swap for the app. The hint
 * prevents that: the inline script from HINT_SCRIPT, in the root layout's
 * <head>, runs before first paint and sets HINT_ATTR on <html> when the
 * hint (or a guest session) is present. CSS in globals.css then hides the
 * landing page and shows the app skeleton instead. AppShell removes the
 * attribute once auth has resolved, and React takes over from there.
 *
 * Crawlers and new visitors never have the hint, so they always get the
 * landing page. The hint is only a guess about what to paint while waiting;
 * it grants nothing, and auth still decides what renders.
 *
 * Every access is wrapped: with site data blocked, reading localStorage
 * throws, and that must not take the app down.
 */

import { STORAGE_KEYS } from '@/lib/storage';

export const HINT_KEY = 'mysetlists_signed_in';

/** Set on <html> before first paint when the hint is present. */
export const HINT_ATTR = 'data-auth-hint';

export function setSignedInHint() {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    // Storage blocked: the landing page may flash on the next launch.
  }
}

export function clearSignedInHint() {
  try {
    localStorage.removeItem(HINT_KEY);
  } catch {
    // Storage blocked: there is no hint to clear.
  }
}

/** Stop hiding the landing page. Called once auth has resolved. */
export function clearHintAttr() {
  if (typeof document !== 'undefined') {
    document.documentElement.removeAttribute(HINT_ATTR);
  }
}

// A guest session counts too: guests also go straight to the app, and
// used to see "Loading..." rather than the landing page while auth
// resolved. Kept tiny and dependency-free because it is inlined into
// every page's <head> and runs before anything else.
export const HINT_SCRIPT =
  `try{var s=localStorage;if(s.getItem(${JSON.stringify(HINT_KEY)})||s.getItem(${JSON.stringify(STORAGE_KEYS.GUEST_SESSION)}))` +
  `document.documentElement.setAttribute(${JSON.stringify(HINT_ATTR)},'')}catch(e){}`;
