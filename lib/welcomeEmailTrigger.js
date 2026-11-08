/**
 * The app's half of the welcome email (5.55.0): after a save that took a
 * signed-in account from 0 shows to some, ask the server to send it.
 *
 * Called from the four places in context/AppContext.jsx that write shows
 * (addShow, addShowsFromTour, importShowsToFestival, handleMigrateData),
 * through its noteShowsAdded(), and from nowhere else. Every add path in
 * the app (manual, search, ticket scan, file and screenshot import, tag
 * accept, upcoming → past, festival lineup, tour browse, Heard, guest
 * migration) funnels into one of those four.
 *
 * Fire-and-forget: never awaited by a save, never throws, never toasts.
 * The server decides for itself whether this really is a first show
 * (netlify/functions/lib/welcomeEmail.js); this only saves it a call on
 * every save after the first.
 */

/** True when a save took the account from no shows to at least one. */
export function isFirstShowTransition(prevCount, addedCount) {
  return prevCount === 0 && addedCount > 0;
}

/**
 * requestWelcomeEmail(user, showId) — POST to send-welcome-email with the
 * user's ID token. Resolves to nothing; failures are logged and dropped.
 * `deps` is for tests.
 */
export function requestWelcomeEmail(user, showId, deps = {}) {
  const doFetch = deps.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  const url = deps.url || '/.netlify/functions/send-welcome-email';
  if (!user || typeof user.getIdToken !== 'function' || !doFetch) return Promise.resolve();
  return Promise.resolve()
    .then(() => user.getIdToken())
    .then((token) => doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(showId ? { showId: String(showId) } : {}),
      keepalive: true,
    }))
    .then(() => undefined)
    .catch((e) => { console.warn('Welcome email request failed:', e?.message || e); });
}
