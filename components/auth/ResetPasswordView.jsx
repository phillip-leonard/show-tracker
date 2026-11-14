'use client';

// components/auth/ResetPasswordView.jsx
//
// Where the link in the reset email lands (5.60.0). The email links to
// https://mysetlists.net/reset/<token>; netlify.toml 301s that to
// /reset/?token=<token>, the real pre-rendered route (the static export has
// no dynamic routes; see CLAUDE.md). The token goes to
// complete-password-reset with the new password, which sets it with the
// Admin SDK.
//
// Rendered outside the app shell (app/AppProviderWrapper.jsx), the same for
// a signed-in or signed-out visitor, and never waits on auth.

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, KeyRound, Link2Off } from 'lucide-react';
import { apiUrl } from '@/lib/api';
import { validatePassword } from '@/lib/passwordRules';
import PasswordInput from './PasswordInput';
import ForgotPasswordForm from './ForgotPasswordForm';
import { Button } from '@/components/ui';

// The server's own wording (netlify/functions/lib/passwordReset.js).
const INVALID_LINK = 'This reset link is invalid or has expired.';
const SIGN_IN_HREF = '/?login=1';

function ResetCard({ children }) {
  return (
    <div className="min-h-dscreen bg-gradient-to-br from-base via-surface to-base flex flex-col">
      <header className="pt-safe-top">
        <div className="max-w-md w-full mx-auto px-4 py-5">
          <Link href="/" className="text-2xl font-extrabold tracking-tight hover:opacity-80 transition-opacity">
            <span className="font-light text-muted">my</span><span className="text-amber">setlists</span>
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-start justify-center px-4 pb-16 pt-4 md:pt-12">
        <div className="w-full max-w-md bg-surface border border-subtle rounded-2xl p-6 md:p-8 shadow-xl">
          {children}
        </div>
      </main>
    </div>
  );
}

function IconBadge({ icon: Icon, tone = 'brand' }) {
  const cls = tone === 'danger' ? 'bg-hover text-danger' : 'bg-brand-subtle text-brand';
  return (
    <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${cls}`}>
      <Icon className="w-7 h-7" />
    </div>
  );
}

function InvalidLink({ onSendNew }) {
  return (
    <div className="text-center">
      <IconBadge icon={Link2Off} tone="danger" />
      <h1 className="text-2xl font-bold text-primary mb-2">Link expired</h1>
      <p className="text-secondary mb-6">{INVALID_LINK} Reset links work once, for an hour.</p>
      <Button variant="primary" full onClick={onSendNew}>Send a new link</Button>
      <Link href={SIGN_IN_HREF} className="inline-block mt-4 text-sm text-secondary hover:text-primary">Back to sign in</Link>
    </div>
  );
}

export default function ResetPasswordView() {
  const searchParams = useSearchParams();
  const token = (searchParams?.get('token') || '').trim();
  const wellFormed = /^[0-9A-Za-z]{16}$/.test(token);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 'form' | 'done' | 'invalid' | 'resend'
  const [stage, setStage] = useState(wellFormed ? 'form' : 'invalid');
  const shown = !wellFormed && stage === 'form' ? 'invalid' : stage;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const problem = validatePassword(password);
    if (problem) { setError(problem); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }

    setLoading(true);
    try {
      const res = await fetch(apiUrl('/.netlify/functions/complete-password-reset'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      let data = {};
      try { data = await res.json(); } catch { /* not JSON */ }
      if (res.ok) {
        setStage('done');
      } else if (data.code === 'invalid_link') {
        setStage('invalid');
      } else {
        setError(data.error || 'Couldn’t update your password. Please try again.');
      }
    } catch {
      setError('Couldn’t reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (shown === 'resend') {
    return (
      <ResetCard>
        <ForgotPasswordForm onBackToLogin={() => window.location.assign(SIGN_IN_HREF)} />
      </ResetCard>
    );
  }

  if (shown === 'invalid') {
    return (
      <ResetCard>
        <InvalidLink onSendNew={() => setStage('resend')} />
      </ResetCard>
    );
  }

  if (shown === 'done') {
    return (
      <ResetCard>
        <div className="text-center">
          <IconBadge icon={CheckCircle2} />
          <h1 className="text-2xl font-bold text-primary mb-2">Password updated</h1>
          <p className="text-secondary mb-6">
            Sign in here or in the MySetlists app with your new password. Anywhere else you were signed in, you&apos;ll need to sign in again.
          </p>
          <Button variant="primary" full onClick={() => window.location.assign(SIGN_IN_HREF)}>
            Sign in
          </Button>
        </div>
      </ResetCard>
    );
  }

  return (
    <ResetCard>
      <IconBadge icon={KeyRound} />
      <h1 className="text-2xl font-bold text-primary mb-2 text-center">Choose a new password</h1>
      <p className="text-secondary mb-6 text-center text-sm">
        At least 8 characters, with an uppercase letter, a lowercase letter and a number.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <PasswordInput
          value={password}
          onChange={setPassword}
          placeholder="New password"
          disabled={loading}
          showStrength
          autoFocus
        />
        <PasswordInput
          value={confirm}
          onChange={setConfirm}
          placeholder="Confirm new password"
          disabled={loading}
          autoComplete="new-password"
        />
        {error && <p className="text-danger text-sm" role="alert">{error}</p>}
        <Button type="submit" variant="primary" full loading={loading}>
          {loading ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </ResetCard>
  );
}
