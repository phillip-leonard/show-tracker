// components/auth/TermsGate.jsx
//
// The full-screen agreement gate for someone who is ALREADY signed in but
// whose stored acceptance is missing or behind TERMS_VERSION.
//
// Every account that existed before build 32 is in that state, which is
// the point: Guideline 1.2 asks for terms agreed before logging in, and
// an app that only gates new registrations leaves its entire existing
// user base ungated. This is what makes it retroactive — the gate is the
// first thing an existing user sees at next launch, and nothing else in
// the app is reachable until they agree.
//
// ── WHY THERE IS A SIGN-OUT BUTTON ──────────────────────────────────────
//
// Agreement is only agreement if declining is possible. Someone who will
// not accept the rules must be able to leave rather than be held in a
// screen with no exit, and signing out puts them back at the landing page
// where the app's own /terms and /privacy links still work. Their account
// and data are untouched; they can come back and agree at any time.

'use client';

import React, { useState } from 'react';
import { ShieldCheck, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui';
import { TERMS_SUMMARY } from '@/lib/terms';

export default function TermsGate({ onAgree, onSignOut }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleAgree = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onAgree();
    } catch (err) {
      console.error('[terms] Could not record agreement:', err);
      setError('Couldn’t save that. Check your connection and try again.');
      setSaving(false);
    }
    // Deliberately no setSaving(false) on success: the gate unmounts.
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-base overflow-y-auto"
      data-testid="terms-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
    >
      <div
        className="min-h-full flex items-center justify-center px-4 py-10"
        style={{
          paddingTop: 'max(2.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="w-full max-w-md bg-surface border border-subtle rounded-3xl p-7 shadow-2xl">
          <div className="flex items-center gap-2.5 mb-2">
            <ShieldCheck size={22} className="text-brand flex-shrink-0" />
            <h1 id="terms-gate-title" className="text-xl font-bold text-primary">
              Before you continue
            </h1>
          </div>

          <p className="text-sm text-secondary mb-5">
            We&rsquo;ve updated our Terms of Use and community rules. Please read and
            agree to carry on using MySetlists.
          </p>

          <ul className="list-none p-0 m-0 space-y-3 mb-5">
            {TERMS_SUMMARY.map((item) => (
              <li key={item.title} className="text-sm leading-snug">
                <span className="block font-semibold text-primary">{item.title}</span>
                <span className="block text-secondary">{item.body}</span>
              </li>
            ))}
          </ul>

          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-brand underline mb-6"
          >
            Read the full Terms of Use <ExternalLink size={13} />
          </a>

          {error && <p className="text-sm text-danger mb-3">{error}</p>}

          <Button
            variant="primary"
            full
            loading={saving}
            onClick={handleAgree}
            data-testid="terms-gate-agree"
          >
            I Agree
          </Button>

          <button
            type="button"
            onClick={onSignOut}
            disabled={saving}
            className="w-full mt-3 py-3 text-sm text-muted hover:text-primary transition-colors disabled:opacity-50"
            data-testid="terms-gate-signout"
          >
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}
