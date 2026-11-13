/**
 * appleRevoke — revoke a user's Sign in with Apple tokens (B-11, 5.59.8).
 *
 * Calls Identity Toolkit's accounts:revokeToken, the endpoint Firebase's own
 * SDKs use (iOS `revokeToken(withAuthorizationCode:)`, JS
 * `revokeAccessToken`). Firebase exchanges the token with Apple using the
 * Apple key configured on the project's Apple provider (Firebase console →
 * Authentication → Sign-in method → Apple → OAuth code flow configuration),
 * so no Apple key lives in Netlify.
 *
 * It needs the user's Firebase ID token, which must still be valid, so
 * delete-account calls this BEFORE it disables the account and revokes the
 * Firebase refresh tokens.
 *
 * Never throws: deletion goes ahead whatever Apple says. The result is
 * logged so a failure is visible.
 */

const TOKEN_TYPES = new Set(['CODE', 'ACCESS_TOKEN', 'REFRESH_TOKEN']);
const ENDPOINT = 'https://identitytoolkit.googleapis.com/v2/accounts:revokeToken';

// The project's public web API key, the same fallback lib/firebase.js ships
// in the browser bundle. It identifies the project; it isn't a secret.
const PUBLIC_WEB_API_KEY = 'AIzaSyC5PQErQtSFAIkG779kfK_UhaS5hYflwuY';

function firebaseApiKey() {
  return process.env.FIREBASE_WEB_API_KEY
    || process.env.REACT_APP_FIREBASE_API_KEY
    || process.env.NEXT_PUBLIC_FIREBASE_API_KEY
    || PUBLIC_WEB_API_KEY;
}

/** Validates the client's { appleToken, appleTokenType }; null when absent or malformed. */
function readAppleToken(body) {
  const token = body && body.appleToken;
  const tokenType = String((body && body.appleTokenType) || 'CODE').toUpperCase();
  if (typeof token !== 'string' || !token || token.length > 4096) return null;
  if (!TOKEN_TYPES.has(tokenType)) return null;
  return { token, tokenType };
}

/**
 * revokeAppleToken({ idToken, token, tokenType }, { fetchImpl, apiKey, timeoutMs })
 *   → { revoked: true } | { revoked: false, reason }
 */
async function revokeAppleToken({ idToken, token, tokenType = 'CODE' }, opts = {}) {
  const apiKey = opts.apiKey ?? firebaseApiKey();
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!apiKey) return { revoked: false, reason: 'no_api_key' };
  if (!idToken || !token) return { revoked: false, reason: 'missing_token' };
  if (!TOKEN_TYPES.has(tokenType)) return { revoked: false, reason: 'bad_token_type' };

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs || 8000) : null;
  try {
    const res = await fetchImpl(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'apple.com', tokenType, token, idToken }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (res.ok) return { revoked: true };
    let reason = `http_${res.status}`;
    try {
      const data = await res.json();
      const msg = data && data.error && data.error.message;
      if (msg) reason = String(msg).slice(0, 200);
    } catch { /* not JSON */ }
    return { revoked: false, reason };
  } catch (e) {
    return { revoked: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { revokeAppleToken, readAppleToken, firebaseApiKey };
