/**
 * API base URL helper for Capacitor native app support.
 *
 * On web, API calls use relative URLs (same origin).
 * On native (Capacitor), the origin is capacitor://localhost,
 * so we prepend the live backend URL.
 */

let isNative = false;
try {
  // Dynamic check — @capacitor/core may not be installed in web-only builds
  const { Capacitor } = require('@capacitor/core');
  isNative = Capacitor.isNativePlatform();
} catch {
  // @capacitor/core not available — we're on web
}

const API_BASE = isNative ? 'https://mysetlists.net' : '';

/**
 * Prepend the API base URL to a path for native platform compatibility.
 * @param {string} path - e.g. '/.netlify/functions/spotify-token'
 * @returns {string} Full URL on native, relative path on web
 */
export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

/**
 * fetch() an API path with the signed-in user's Firebase ID token attached
 * (`Authorization: Bearer …`). Same URL handling as apiUrl(). With nobody
 * signed in (or a guest), it sends the request without a token and lets
 * the server answer 401 — callers handle that through apiErrorMessage().
 *
 * Firebase is imported lazily so pages that only need apiUrl() don't pull
 * the auth SDK in through this module.
 */
export async function authedFetch(path, init = {}) {
  const headers = { ...(init.headers || {}) };
  try {
    const { auth } = await import('@/lib/firebase');
    const user = auth.currentUser;
    if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  } catch {
    // No token available: the request goes without one.
  }
  return fetch(apiUrl(path), { ...init, headers });
}

/**
 * The message to show for a failed API response. 400, 401, 413 and 429
 * get their own wording (`messages.badRequest`, `.unauthorized`,
 * `.tooLarge`, `.rateLimited`); for 429 and anything else the server's own
 * `error` text is used when it is a sentence, never a machine code like
 * "rate_limited" (5.59.12).
 */
const isSentence = (text) => typeof text === 'string' && /\s/.test(text.trim());

export function apiErrorMessage(response, data, fallback, messages = {}) {
  const status = response && response.status;
  const said = data && isSentence(data.error) ? data.error : null;
  if (status === 401) return messages.unauthorized || 'Please sign in to continue.';
  if (status === 429) return said || messages.rateLimited || 'You’ve reached today’s limit. Try again tomorrow.';
  if (status === 413) return messages.tooLarge || 'That’s too large to send. Try a smaller selection.';
  if (status === 400) return messages.badRequest || said || 'Something in that request wasn’t right. Please check it and try again.';
  return said || fallback;
}
