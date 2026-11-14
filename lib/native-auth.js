/**
 * Native authentication helpers for Capacitor iOS app.
 *
 * Uses @capacitor-firebase/authentication for native Google/Apple Sign-In
 * because signInWithPopup() does not work in WKWebView. It does not throw
 * there — it silently does nothing, so the button looks dead. That is
 * literally what App Review reported on 2026-03-24 (Guideline 2.1(a),
 * "Sign up with Google and Sign up with Apple button were unresponsive").
 *
 * The rule that follows: on native, never fall through to the popup. Either
 * the native sheet handles it or the caller surfaces an error. A silent
 * no-op is the failure mode that got the app rejected.
 *
 * On web, these helpers return null and the caller uses the popup flow.
 */

import {
  signInWithCredential, updateProfile,
  GoogleAuthProvider, OAuthProvider,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { contentProblem } from '@/lib/contentFilter';

let isNative = false;
try {
  const { Capacitor } = require('@capacitor/core');
  isNative = Capacitor.isNativePlatform();
} catch {
  // Not available — we're on web
}

/**
 * Sign in with Google using native iOS sign-in sheet on Capacitor,
 * or return null to indicate the caller should use the web popup flow.
 *
 * @returns {Promise<import('firebase/auth').UserCredential | null>}
 *   UserCredential on native success, null if web fallback should be used.
 */
export async function nativeGoogleSignIn() {
  if (!isNative) return null;

  try {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const result = await FirebaseAuthentication.signInWithGoogle();

    // Get the ID token from the native sign-in
    const idToken = result.credential?.idToken;
    const accessToken = result.credential?.accessToken;
    if (!idToken) {
      throw new Error('No ID token received from native Google Sign-In');
    }

    // Create Firebase credential and sign in to the JS SDK
    const credential = GoogleAuthProvider.credential(idToken, accessToken);
    return await signInWithCredential(auth, credential);
  } catch (err) {
    throw normalizeAuthError(err);
  }
}

/**
 * Apple returns the user's name exactly once — on the very first
 * authorisation, and never again. If we do not copy it onto the Firebase user
 * there and then, the account is nameless forever and every comment, profile
 * and friend card in the app falls back to a blank.
 */
async function adoptAppleDisplayName(userCredential, nativeResult) {
  const user = userCredential?.user;
  if (!user || user.displayName) return;

  const given = nativeResult?.user?.displayName
    || [nativeResult?.additionalUserInfo?.profile?.givenName,
        nativeResult?.additionalUserInfo?.profile?.familyName]
         .filter(Boolean).join(' ');

  // Apple's sheet lets the user EDIT the name before authorising, so this
  // is user-supplied text like any other — not something the provider
  // vouches for — and it lands on every comment, photo and friend card.
  // A name that fails the filter is dropped rather than rejected: the
  // sign-in has already succeeded by this point, and signing someone out
  // over their name would be a worse failure than a nameless account they
  // can fix in Profile.
  if (given && !contentProblem(given)) {
    try {
      await updateProfile(user, { displayName: given });
    } catch {
      // Non-fatal: the user is signed in, they can set a name in their profile.
    }
  }
}

/**
 * Map the plugin's cancellation shapes onto the Firebase code the forms
 * already special-case, so a user backing out of the sheet is not shown an
 * error. Google and Apple report cancellation differently.
 */
function normalizeAuthError(err) {
  const message = err?.message || '';
  const cancelled =
    err?.code === 'ERROR_CANCELED' ||
    err?.code === '1001' ||                 // ASAuthorizationError.canceled
    /cancel|dismiss|1001|12501/i.test(message);

  if (cancelled) {
    const cancelErr = new Error('Sign in cancelled');
    cancelErr.code = 'auth/popup-closed-by-user';
    return cancelErr;
  }
  return err;
}

/**
 * Sign in with Apple using the native sheet.
 *
 * @returns {Promise<import('firebase/auth').UserCredential | null>}
 *   UserCredential on native success, null on web (caller falls back).
 */
export async function nativeAppleSignIn() {
  if (!isNative) return null;

  try {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const result = await FirebaseAuthentication.signInWithApple({
      scopes: ['email', 'name'],
      // REQUIRED, and its absence is what produced auth/missing-or-invalid-nonce.
      //
      // capacitor.config.ts sets skipNativeAuth: false globally, so by default
      // the plugin completes the Firebase sign-in itself on the native layer
      // and consumes the Apple credential doing it. The idToken it hands back
      // can then no longer be exchanged a second time on the web layer, and
      // Firebase rejects it as a nonce mismatch rather than saying so plainly.
      //
      // Overriding per call makes the plugin do only the Apple authorisation
      // and hand us the credential, leaving the Firebase sign-in to
      // signInWithCredential below. The plugin's own Firebase JS SDK guide is
      // explicit that this path "works on Android and iOS only with
      // skipNativeAuth=true".
      //
      // Google is deliberately left on the global setting: it signs in twice,
      // wastefully but harmlessly, because Google's credential carries no
      // nonce to invalidate. Changing it is a separate, testable change.
      skipNativeAuth: true,
    });

    const idToken = result.credential?.idToken;
    if (!idToken) {
      throw new Error('No identity token received from Sign in with Apple');
    }

    // Apple's credential must carry the raw nonce the native layer generated,
    // or Firebase rejects the exchange. The plugin returns it as `nonce`.
    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({
      idToken,
      rawNonce: result.credential?.nonce,
    });

    const userCredential = await signInWithCredential(auth, credential);
    await adoptAppleDisplayName(userCredential, result);
    return userCredential;
  } catch (err) {
    throw normalizeAuthError(err);
  }
}

/**
 * Native sign-in for whichever provider the caller asked for.
 *
 * Returns null on web, and for any provider with no native implementation,
 * which keeps the web popup path working unchanged.
 *
 * @param {'google'|'apple'} providerName
 */
export async function nativeOAuthSignIn(providerName) {
  if (!isNative) return null;
  if (providerName === 'google') return nativeGoogleSignIn();
  if (providerName === 'apple') return nativeAppleSignIn();
  return null;
}

/**
 * Check if we're running in a native Capacitor app.
 */
export function isNativePlatform() {
  return isNative;
}

/**
 * Sign the native layer out too (5.59.14): the Capacitor Firebase plugin's
 * own session in the Keychain, plus the Google and Apple SDK state, so the
 * next sign-in starts clean and can pick a different account. A no-op on
 * the web. Called by lib/signOutFlow.js, which time-limits it.
 *
 * The plugin is destructured and called, never returned from this async
 * function: a returned Capacitor plugin is treated as a thenable and the
 * await never settles (see messaging() in lib/pushAlerts.js).
 */
export async function nativeSignOut() {
  if (!isNative) return;
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  await FirebaseAuthentication.signOut();
}
