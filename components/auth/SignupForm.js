'use client';
import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup
} from 'firebase/auth';
import { auth, authProviders, browserPopupRedirectResolver } from '@/lib/firebase';
import { nativeOAuthSignIn, isNativePlatform } from '@/lib/native-auth';
import OAuthButtons from './OAuthButtons';
import AuthDivider from './AuthDivider';
import PasswordInput from './PasswordInput';
import { Input, Button } from '@/components/ui';
import { contentProblem } from '@/lib/contentFilter';
// The same rules the reset page and complete-password-reset check.
import { validatePassword } from '@/lib/passwordRules';

export default function SignupForm({ onSuccess, onSwitchToLogin, agreed = true }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEmailSignup = async (e) => {
    e.preventDefault();
    // The submit button is disabled without agreement, but a form still
    // submits on Enter — so the gate is enforced here as well.
    if (!agreed) return;
    setError('');

    // Validation
    if (!displayName.trim()) {
      setError('Please enter your name');
      return;
    }

    // The display name is the single most widely published piece of text a
    // user controls — it renders on every comment, photo, friend card and
    // activity row in the app. It was filtered on the profile EDIT path
    // (ProfileView) but not here, which made signing up with a slur the
    // easiest way to publish one: no SDK, no Firestore bypass, just this
    // form. Checked before the account is created, so a rejected name
    // never reaches Firebase Auth at all.
    const nameProblem = contentProblem(displayName);
    if (nameProblem) {
      setError(nameProblem);
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      // Create account
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);

      // Update profile with display name
      await updateProfile(userCredential.user, {
        displayName: displayName.trim()
      });

      onSuccess?.();
    } catch (err) {
      setError(getErrorMessage(err.code));
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthSignup = async (providerName) => {
    if (!agreed) return;
    setError('');
    setLoading(true);

    try {
      // On native, the native sheet is the ONLY path. signInWithPopup() does
      // not throw inside WKWebView, it silently does nothing — the button
      // simply looks dead, which is what App Review reported on 2026-03-24.
      // Falling back to it here would reintroduce that exact bug.
      if (isNativePlatform()) {
        const result = await nativeOAuthSignIn(providerName);
        if (!result) {
          throw new Error(`Sign in with ${providerName} is unavailable on this device.`);
        }
      } else {
        const provider = authProviders[providerName];
        await signInWithPopup(auth, provider, browserPopupRedirectResolver);
      }

      onSuccess?.();
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(getErrorMessage(err.code));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-primary mb-6 text-center">
        Create Account
      </h2>

      {/* Same agreement flag as LoginForm — see the note there. */}
      <OAuthButtons
        onProviderClick={handleOAuthSignup}
        disabled={loading || !agreed}
        action="signup"
      />

      <AuthDivider />

      <form onSubmit={handleEmailSignup} className="space-y-4">
        <Input
          type="text"
          placeholder="Your name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          disabled={loading}
        />

        <Input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={loading}
        />

        <PasswordInput
          value={password}
          onChange={setPassword}
          placeholder="Password"
          disabled={loading}
          showStrength
        />

        <PasswordInput
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Confirm password"
          disabled={loading}
        />

        {error && (
          <p className="text-danger text-sm">{error}</p>
        )}

        <Button type="submit" variant="primary" full loading={loading} disabled={!agreed}>
          {loading ? 'Creating account...' : 'Create Account'}
        </Button>
      </form>

      <p className="text-center text-secondary mt-6">
        Already have an account?{' '}
        <button
          onClick={onSwitchToLogin}
          className="text-brand hover:text-brand font-medium"
        >
          Sign in
        </button>
      </p>
    </div>
  );
}

function getErrorMessage(code) {
  const messages = {
    'auth/email-already-in-use': 'An account with this email already exists',
    'auth/invalid-email': 'Invalid email address',
    'auth/operation-not-allowed': 'Email/password accounts are not enabled',
    'auth/weak-password': 'Password is too weak',
    'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method',
    'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow popups for this site, then try again.',
    'auth/cancelled-popup-request': 'Sign up was cancelled.',
    'auth/unauthorized-domain': 'This domain is not authorized for OAuth operations. Add it in Firebase Console.',
  };
  return messages[code] || `Sign up failed (${code || 'unknown error'}). Please try again.`;
}
