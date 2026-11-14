'use client';
import { useState } from 'react';
import { apiUrl } from '@/lib/api';
import { ArrowLeft, Mail } from 'lucide-react';

// Since 5.60.0 the reset email is ours: send-password-reset mails a
// one-hour link to https://mysetlists.net/reset/<token> from
// noreply@mysetlists.net, and app/reset is where it lands. Firebase's own
// reset email (the firebaseapp.com sender and its long
// __/auth/action link) is no longer used anywhere.
async function requestReset(email) {
  let res;
  try {
    res = await fetch(apiUrl('/.netlify/functions/send-password-reset'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw new Error('Couldn\'t reach the server. Check your connection and try again.');
  }
  if (res.ok) return;
  let message = '';
  try { message = (await res.json()).error || ''; } catch { /* not JSON */ }
  throw new Error(message || 'Failed to send reset email. Please try again.');
}

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
      await requestReset(email.trim());
      setSuccess(true);
    } catch (err) {
      setError(err.message);
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
            this screen must never confirm who is registered.
            send-password-reset answers the same 200 either way, so the
            copy has to match. */}
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
      {/* A "Hide My Email" account is registered under its
          @privaterelay.appleid.com address, so typing a real address finds
          nothing, and the screen can't say so without revealing who has an
          account. Google and Apple accounts have no password to reset. */}
      <p className="text-muted text-sm -mt-3 mb-6">
        Signed up with Apple or Google? You don&apos;t have a password. Use the Apple or Google button to sign in.
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
