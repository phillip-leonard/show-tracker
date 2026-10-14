'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import LoginForm from './LoginForm';
import SignupForm from './SignupForm';
import ForgotPasswordForm from './ForgotPasswordForm';
import TermsAgreement from './TermsAgreement';
import { getPendingAcceptance, setPendingAcceptance, TERMS_VERSION } from '@/lib/terms';
import useKeyboardInset from '@/hooks/useKeyboardInset';

export default function AuthModal({ mode, onClose, onSwitchMode, onSuccess }) {
  const keyboardInset = useKeyboardInset();

  // ── The Guideline 1.2 agreement gate ──────────────────────────────────
  //
  // Held here rather than in LoginForm/SignupForm so that switching
  // between "Sign in" and "Sign up" does not silently reset a tick the
  // user has already given — and so one flag covers all three providers.
  //
  // Seeded from localStorage because the agreement is taken BEFORE an
  // account exists: someone who ticked the box, started Sign in with
  // Apple and backed out of the native sheet should not have to tick it
  // again. AppContext flushes the parked value to their profile once
  // sign-in completes. Read in an effect rather than during render — this
  // is a static export, so a localStorage read at render time disagrees
  // with the prerendered HTML and trips a hydration mismatch in the
  // app's webview.
  const [agreed, setAgreed] = useState(false);
  useEffect(() => {
    if (getPendingAcceptance() >= TERMS_VERSION) setAgreed(true);
  }, []);

  const handleAgreeChange = (next) => {
    setAgreed(next);
    if (next) setPendingAcceptance();
  };

  // Password reset is not registering and not logging in, so it is not
  // behind the gate — someone locked out of their account must be able to
  // recover it. Agreement is still required before the sign-in that
  // follows, because LoginForm renders with the same flag.
  const gated = mode === 'login' || mode === 'signup';
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const renderForm = () => {
    switch (mode) {
      case 'login':
        return (
          <LoginForm
            onSuccess={onSuccess}
            onSwitchToSignup={() => onSwitchMode('signup')}
            onForgotPassword={() => onSwitchMode('forgot-password')}
            agreed={agreed}
          />
        );
      case 'signup':
        return (
          <SignupForm
            onSuccess={onSuccess}
            onSwitchToLogin={() => onSwitchMode('login')}
            agreed={agreed}
          />
        );
      case 'forgot-password':
        return (
          <ForgotPasswordForm
            onBackToLogin={() => onSwitchMode('login')}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={keyboardInset ? { paddingBottom: keyboardInset } : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-sidebar/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal
          The scroll container is the INNER div, not this one. The close
          button is absolutely positioned, and an absolutely positioned
          child of a scrolling box scrolls away with the content — so
          putting overflow on the same element as the button would send
          the only visible way out off the top of a modal that is now tall
          enough to scroll. The outer box clips, the inner one scrolls,
          and the button sits between them where it stays put. */}
      <div
        className="relative bg-surface backdrop-blur-xl border border-subtle rounded-3xl w-full max-w-md mx-4 shadow-2xl flex flex-col"
        style={
          keyboardInset
            ? { maxHeight: `calc(100dvh - ${keyboardInset}px - 0.5rem)` }
            : { maxHeight: '90vh' }
        }
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-3 text-secondary hover:text-primary active:bg-hover rounded-xl transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="overflow-y-auto p-8">
          {/* Above the form, so the rules are read before the buttons are
              reachable — every sign-in control below is disabled until the
              box is ticked. */}
          {gated && (
            <TermsAgreement agreed={agreed} onChange={handleAgreeChange} />
          )}

          {renderForm()}
        </div>
      </div>
    </div>
  );
}
