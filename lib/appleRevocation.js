/**
 * appleRevocation — a fresh Apple token for account deletion (B-11, 5.59.8).
 *
 * Apple expects an app that offers Sign in with Apple to revoke the user's
 * Apple tokens when they delete their account, so the app disappears from
 * Settings → Apple ID → Sign in with Apple. Revoking needs a token Apple
 * issued to us, and we keep none: sign-in exchanges the identity token with
 * Firebase and drops the rest. So deletion asks Apple once more, here, and
 * hands the result to delete-account, which revokes it through Firebase
 * (netlify/functions/lib/appleRevoke.js) before the account is disabled.
 *
 *   iOS: the native Apple sheet (skipNativeAuth, as sign-in uses) returns a
 *        one-time authorization code, valid for five minutes → tokenType CODE.
 *   Web: reauthenticateWithPopup returns Apple's OAuth access token
 *        → tokenType ACCESS_TOKEN (what Firebase's revokeAccessToken sends).
 *
 * appleTokenForDeletion(user) resolves to:
 *   null                          not an Apple account; nothing to revoke
 *   { tokenType, token }          send it with the delete request
 *   { skipped: reason }           Apple couldn't give us one; delete anyway
 * and throws { code: 'apple/cancelled' } when the user backs out of Apple's
 * sheet, which the caller treats as "don't delete".
 *
 * Revocation never blocks deletion: a person who wants their account gone
 * gets it gone even if Apple is unreachable.
 */

import { OAuthProvider, reauthenticateWithPopup } from 'firebase/auth';

let isNative = false;
try {
  const { Capacitor } = require('@capacitor/core');
  isNative = Capacitor.isNativePlatform();
} catch {
  // web
}

export function appleProviderUid(user) {
  const entry = (user?.providerData || []).find((p) => p && p.providerId === 'apple.com');
  return entry ? entry.uid || '' : null;
}

/** The `sub` of a JWT, read without verifying it (only used to compare). */
export function jwtSubject(jwt) {
  try {
    const part = String(jwt || '').split('.')[1];
    if (!part) return '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const text = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(text).sub || '';
  } catch {
    return '';
  }
}

function isCancel(err) {
  const message = (err && err.message) || '';
  return (
    err?.code === 'auth/popup-closed-by-user' ||
    err?.code === 'auth/cancelled-popup-request' ||
    err?.code === 'ERROR_CANCELED' ||
    err?.code === '1001' ||
    /cancel|dismiss|1001/i.test(message)
  );
}

function cancelled() {
  const e = new Error('Apple confirmation cancelled');
  e.code = 'apple/cancelled';
  return e;
}

export async function appleTokenForDeletion(user, deps = {}) {
  const appleUid = appleProviderUid(user);
  if (appleUid === null) return null;

  const native = deps.isNative ?? isNative;
  try {
    if (native) {
      const plugin = deps.plugin || (await import('@capacitor-firebase/authentication')).FirebaseAuthentication;
      const result = await plugin.signInWithApple({ skipNativeAuth: true });
      const code = result?.credential?.authorizationCode;
      if (!code) return { skipped: 'no_code' };
      // The sheet signs in whichever Apple ID the device has. If that isn't
      // the one on this account, its code isn't ours to revoke.
      const sub = jwtSubject(result?.credential?.idToken);
      if (appleUid && sub && sub !== appleUid) return { skipped: 'different_apple_id' };
      return { tokenType: 'CODE', token: code };
    }

    const reauth = deps.reauthenticateWithPopup || reauthenticateWithPopup;
    const provider = new OAuthProvider('apple.com');
    const result = await reauth(user, provider);
    const accessToken = OAuthProvider.credentialFromResult(result)?.accessToken;
    if (!accessToken) return { skipped: 'no_access_token' };
    return { tokenType: 'ACCESS_TOKEN', token: accessToken };
  } catch (err) {
    if (isCancel(err)) throw cancelled();
    // auth/user-mismatch (a different Apple ID), popup blocked, Apple down…
    return { skipped: err?.code || 'error' };
  }
}
