/**
 * signOutFlow — signing out in an order nothing can block (5.59.14).
 *
 * Until 5.59.14 logout awaited the push cleanup before signOut, and on iOS
 * that await never settled (lib/pushAlerts.js messaging()), so tapping
 * Logout did nothing from 3.11 to 3.13.13, and account deletion stopped on
 * "Deleting…". The lesson: no cleanup step may stand between the user and
 * being signed out.
 *
 *   1. cleanup that needs the session (push token: its Firestore doc is
 *      deleted as the signed-in owner), best-effort, time-limited
 *   2. web signOut: the session the app actually runs on
 *   3. native signOut (Capacitor Firebase plugin: the Keychain session and
 *      the Google / Apple SDK state), best-effort, time-limited
 *   4. local cleanup (state, per-user storage), best-effort
 *   5. navigate to the signed-out screen
 *
 * Every step but 2 is wrapped: a throw is logged and skipped, a hang is
 * cut off after `timeoutMs`. Step 2 failing is reported in the result, and
 * steps 3–5 still run, so the screen never sits on a half-signed-out app.
 *
 * Nothing here imports Firebase or Capacitor: the caller passes the steps
 * (AppContext handleLogout, ProfileView account deletion), so the order and
 * the guarantees are unit tested (lib/__tests__/signOut.test.js).
 */

export const STEP_TIMEOUT_MS = 4000;

/** Settles within `ms` whatever `fn` does: resolves its value, or { error } / { timedOut }. */
export function bounded(fn, ms = STEP_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish({ timedOut: true }), ms);
    let result;
    try {
      result = fn ? fn() : undefined;
    } catch (error) {
      finish({ error });
      return;
    }
    Promise.resolve(result).then((value) => finish({ value }), (error) => finish({ error }));
  });
}

/**
 * performSignOut({ beforeSignOut, webSignOut, nativeSignOut, clearLocal,
 *                  navigate, log, timeoutMs }) → { signedOut, steps }
 */
export async function performSignOut({
  beforeSignOut,
  webSignOut,
  nativeSignOut,
  clearLocal,
  navigate,
  log = (...args) => console.warn(...args),
  timeoutMs = STEP_TIMEOUT_MS,
} = {}) {
  const steps = {};
  const run = async (name, fn) => {
    if (!fn) return;
    const outcome = await bounded(fn, timeoutMs);
    steps[name] = outcome.error ? 'failed' : outcome.timedOut ? 'timed out' : 'ok';
    if (outcome.error) log(`[sign-out] ${name} failed; continuing`, outcome.error?.message || outcome.error);
    if (outcome.timedOut) log(`[sign-out] ${name} took over ${timeoutMs}ms; continuing`);
  };

  await run('beforeSignOut', beforeSignOut);
  await run('webSignOut', webSignOut);
  await run('nativeSignOut', nativeSignOut);
  await run('clearLocal', clearLocal);
  await run('navigate', navigate);
  return { signedOut: steps.webSignOut === 'ok', steps };
}
