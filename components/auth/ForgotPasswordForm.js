'use client';
import { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { ArrowLeft, Mail } from 'lucide-react';

export default function ForgotPasswordForm({ onBackToLogin }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess(true);
    } catch (err) {
      setError(getErrorMessage(err.code));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="text-center">
        <div className="w-16 h-16 bg-brand-subtle rounded-full flex items-center justify-center mx-auto mb-4">
          <Mail className="w-8 h-8 text-brand" />
        </div>
        <h2 className="text-2xl font-bold text-primary mb-2">Check Your Email</h2>
        {/* Worded the same whether or not the address has an account —
            this screen must never confirm who is registered. The project
            has Firebase email-enumeration protection on, so the request
            succeeds either way and the copy has to match. */}
        <p className="text-secondary mb-6">
          If an account exists for <span className="text-primary">{email}</span>, we&apos;ve sent it a link to reset your password. It can take a few minutes to arrive, so check your spam folder too.
        </p>
        <button
          onClick={onBackToLogin}
          className="text-brand hover:text-brand font-medium flex items-center gap-2 mx-auto"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={onBackToLogin}
        className="text-secondary hover:text-primary flex items-center gap-2 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to sign in
      </button>

      <h2 className="text-2xl font-bold text-primary mb-2">Reset Password</h2>
      <p className="text-secondary mb-6">
        Enter your email and we'll send you a link to reset your password.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-3 bg-hover border border-subtle rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/50 text-primary placeholder-muted"
          required
          disabled={loading}
          autoFocus
        />

        {error && (
          <p className="text-danger text-sm">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-3 bg-gradient-to-r from-brand to-amber hover:from-brand hover:to-amber disabled:opacity-50 text-primary rounded-xl font-medium transition-all shadow-lg shadow-brand/20"
        >
          {loading ? 'Sending...' : 'Send Reset Link'}
        </button>
      </form>
    </div>
  );
}

// No message for auth/user-not-found: with email-enumeration protection on,
// Firebase doesn't return it, and saying so would reveal who has an account.
function getErrorMessage(code) {
  const messages = {
    'auth/invalid-email': 'That doesn\'t look like a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/network-request-failed': 'Couldn\'t reach the server. Check your connection and try again.',
  };
  return messages[code] || 'Failed to send reset email. Please try again.';
}
