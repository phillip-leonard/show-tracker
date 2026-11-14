/**
 * appVersion — is this iOS build too old? (5.59.10)
 *
 * config/app in Firestore holds two marketing versions, set by the admin in
 * Admin → App versions:
 *   latestIosVersion        below this: a dismissible "Update available" banner
 *   minSupportedIosVersion  below this: a screen that can't be dismissed,
 *                           with an App Store link
 * compared with the build's own CFBundleShortVersionString (App.getInfo()).
 *
 * This is how old builds are retired on a schedule (REQUIRE_AUTH_AI, the
 * legacy send-email path, odubleserId). It only reaches builds that contain
 * it: 3.13.10 and later. Earlier builds never read config/app.
 *
 * Account deletion stays reachable from the blocking screen, always
 * (App Store Guideline 5.1.1(v)).
 */

export const APP_CONFIG_DOC = ['config', 'app'];
export const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;

/** "3.13.10" → [3, 13, 10]; null when it isn't a version. */
export function parseVersion(v) {
  const s = String(v == null ? '' : v).trim();
  if (!VERSION_PATTERN.test(s)) return null;
  return s.split('.').map(Number);
}

/** -1, 0 or 1, comparing part by part; missing parts are 0 (3.13 == 3.13.0). Null when either is invalid. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * versionStatus({ current, min, latest }) → 'blocked' | 'update' | 'ok'.
 * Anything missing or unreadable is 'ok': a bad config must never lock
 * people out.
 */
export function versionStatus({ current, min, latest } = {}) {
  if (!parseVersion(current)) return 'ok';
  if (compareVersions(current, min) === -1) return 'blocked';
  if (compareVersions(current, latest) === -1) return 'update';
  return 'ok';
}

/**
 * Checks an admin edit before it is saved. Returns an error string or null.
 * The minimum can't be above the latest.
 */
export function validateVersionConfig({ min, latest }) {
  if (!parseVersion(min)) return 'The minimum version must look like 3.13.10.';
  if (!parseVersion(latest)) return 'The latest version must look like 3.13.10.';
  if (compareVersions(min, latest) === 1) return 'The minimum can’t be higher than the latest version.';
  return null;
}

/** Whether saving this raises the minimum (the admin is asked to confirm). */
export function raisesMinimum(previousMin, nextMin) {
  if (!parseVersion(previousMin)) return !!parseVersion(nextMin);
  return compareVersions(nextMin, previousMin) === 1;
}

/** Routes the blocking screen never covers: account deletion lives on Profile. */
export function alwaysReachable(pathname) {
  return /^\/profile(\/|$)/.test(pathname || '');
}
