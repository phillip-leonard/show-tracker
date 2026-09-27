'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AppProvider, useApp } from '@/context/AppContext';
import Sidebar from '@/components/layout/Sidebar';
import MobileHeader from '@/components/layout/MobileHeader';
import InstallPrompt from '@/components/InstallPrompt';
import Footer from '@/components/Footer';
import ChangelogPopup from '@/components/ChangelogPopup';
import { extractFirstName } from '@/lib/utils';
import { initCapacitorPlugins } from '@/lib/capacitor';
import { initKeyboardInsetTracking } from '@/lib/keyboardInset';
import { registerServiceWorker } from '@/lib/service-worker';
import { DismissStackProvider, useDismissable } from '@/context/DismissStackContext';
import SwipeBackLayer from '@/components/layout/SwipeBackLayer';
import { Music, Check, Sparkles } from 'lucide-react';

// Code-split: each of these only renders behind a runtime condition (logged
// out, a modal opened, a venue being rated) that's never known at build time
// for a fully client-rendered static export — every signed-in page was
// shipping LandingPage's ~450 lines + 23KB of CSS, AuthModal, and
// VenueRatingModal whether or not it ever used them. `ssr: false` is safe
// here specifically because authLoading starts `true`, so the statically
// exported HTML never contained real LandingPage markup to begin with —
// there's nothing pre-rendered to lose.
const LandingPage = dynamic(() => import('@/components/LandingPage'), { ssr: false });
const AuthModal = dynamic(() => import('@/components/auth/AuthModal'), { ssr: false });
const TermsGate = dynamic(() => import('@/components/auth/TermsGate'), { ssr: false });
const SuspendedScreen = dynamic(() => import('@/components/auth/SuspendedScreen'), { ssr: false });
const VenueRatingModal = dynamic(() => import('@/components/VenueRatingModal'), { ssr: false });

// Routes that render their own content for a signed-out visitor instead of
// being replaced by the landing page.
//
// WHY THIS LIST EXISTS. The signed-out branch below returned <LandingPage>
// for EVERY path, which meant /terms, /privacy and /cookies were
// unreachable without an account — following the footer link to the Terms
// while logged out landed you back on the landing page. That is a problem
// on its own, and a blocking one for App Store Guideline 1.2, which
// requires published contact information and (for an app with
// user-generated content) community guidelines that a person can find
// WITHOUT signing up. The support address and the Community Guidelines
// live on /terms.
//
// Deliberately a small allowlist of static, self-contained legal pages:
// every other route needs the signed-in shell (sidebar, header, user
// data), and the landing page is the right answer for those.
const PUBLIC_PATHS = ['/terms', '/privacy', '/cookies'];

function isPublicPath(pathname) {
  if (!pathname) return false;
  // The static export serves these with and without a trailing slash.
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return PUBLIC_PATHS.includes(normalized);
}

export default function AppProviderWrapper({ children }) {
  return (
    <AppProvider>
      {/* Inside AppProvider (it reads nothing from it, but every overlay
          that registers with it lives further in) and outside everything
          that renders an overlay, so there is exactly one stack. */}
      <DismissStackProvider>
        <AppShell>{children}</AppShell>
      </DismissStackProvider>
    </AppProvider>
  );
}

function AppShell({ children }) {
  const {
    user, authLoading, guestMode, authModal, setAuthModal,
    isAdmin,
    sidebarOpen, setSidebarOpen,
    toast, setToast,
    venueRatingShow, setVenueRatingShow,
    showMigrationPrompt, handleMigrateData, handleSkipMigration, localShowsToMigrate,
    showGuestPrompt, setShowGuestPrompt, openAuthModal,
    showCelebration, welcomeState, setWelcomeState,
    pendingNotificationCount, unreadNotifications,
    friends, handleLogout,
    enterGuestMode, exitGuestMode, communityStats,
    handleAuthSuccess,
    termsAccepted, acceptTerms, isSuspended,
  } = useApp();

  const pathname = usePathname();

  // Initialize Capacitor native plugins and the offline service worker on mount
  useEffect(() => {
    initCapacitorPlugins();
    registerServiceWorker();
    // Keeps --keyboard-height current on web, where there is no Keyboard
    // plugin to report it. No-ops on native, which already owns the value.
    return initKeyboardInsetTracking();
  }, []);

  // The three overlays this component renders inline. Each registers with
  // the dismiss stack so the back gesture closes it rather than navigating
  // the page out from under it.
  useDismissable(showMigrationPrompt, handleSkipMigration, { id: 'migration-prompt' });
  useDismissable(showGuestPrompt, () => setShowGuestPrompt(false), { id: 'guest-prompt' });
  useDismissable(!!welcomeState, () => setWelcomeState(null), { id: 'welcome-modal' });
  // The first-show celebration is deliberately absent: it is
  // pointer-events-none and self-dismissing, so it is not a dismiss target.

  // Show loading state while auth initializes
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-base via-surface to-base flex items-center justify-center">
        <div className="text-muted text-lg">Loading...</div>
      </div>
    );
  }

  // The legal pages render themselves for a signed-out visitor. They carry
  // their own header and footer (see components/TermsOfService.jsx), so
  // they need none of the shell below.
  if (!user && !guestMode && isPublicPath(pathname)) {
    return <>{children}</>;
  }

  // ── Ejected accounts (Guideline 1.2) ──────────────────────────────────
  //
  // Ahead of the terms gate, because an ejected account has nothing to
  // agree to — asking someone to accept the Community Guidelines and then
  // telling them they have been removed for breaking them is a worse
  // experience than the suspension notice on its own.
  //
  // `=== true` rather than truthy: `null` means the profile read has not
  // come back, and flashing a suspension notice at an ordinary user is
  // about the worst false positive this app could produce.
  if (user && !guestMode && isSuspended === true) {
    return <SuspendedScreen onSignOut={handleLogout} />;
  }

  // ── Terms agreement gate (Guideline 1.2) ──────────────────────────────
  //
  // A signed-in user whose stored acceptance is missing or behind
  // TERMS_VERSION sees this instead of the app, at every launch, until
  // they agree. That covers every account created before build 32 —
  // "agree before logging in" is not a requirement you can satisfy for
  // new registrations only.
  //
  // Placed here, ahead of the signed-in shell, so the app never renders
  // behind it: an early `return` cannot be swiped, scrolled or
  // back-gestured past, which is a stronger guarantee than an overlay
  // stacked on top of a live screen. `termsAccepted === false` and not
  // `!termsAccepted`, because `null` means the profile read has not come
  // back yet and must not flash the gate.
  //
  // Guest mode is deliberately not gated: a guest sees no content from
  // any other user (every UGC surface — comments, media, meetups, the
  // activity feed — short-circuits on `guestMode`), so there is nothing
  // for the terms to govern, and a guest who signs in meets the gate in
  // AuthModal on the way through.
  if (user && !guestMode && termsAccepted === false) {
    return (
      <TermsGate
        onAgree={acceptTerms}
        onSignOut={handleLogout}
      />
    );
  }

  // Show landing page with optional auth modal overlay when logged out
  if (!user && !guestMode) {
    return (
      <>
        <LandingPage
          onSignUp={() => setAuthModal('signup')}
          onSignIn={() => setAuthModal('login')}
          onGuest={enterGuestMode}
          communityStats={communityStats}
        />
        {authModal && (
          <AuthModal
            mode={authModal}
            onClose={() => setAuthModal(null)}
            onSwitchMode={setAuthModal}
            onSuccess={handleAuthSuccess}
          />
        )}
      </>
    );
  }

  return (
    <SwipeBackLayer>
    <div className="min-h-screen bg-base text-primary">
      {/* Migration Prompt Modal */}
      {showMigrationPrompt && (
        <div className="fixed inset-0 md:left-64 bg-sidebar/50 backdrop-blur-xl flex items-center justify-center p-3 md:p-4 z-[60]">
          <div className="bg-elevated border border-subtle rounded-2xl md:rounded-3xl max-w-[95vw] sm:max-w-md w-full p-4 md:p-6 shadow-2xl">
            <h2 className="text-lg md:text-xl font-bold mb-4 text-primary">Import Existing Shows?</h2>
            <p className="text-secondary mb-4">
              We found {localShowsToMigrate.length} show{localShowsToMigrate.length !== 1 ? 's' : ''} saved locally on this device.
              Would you like to import them to your account?
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleMigrateData}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-brand to-amber hover:from-brand hover:to-amber text-primary rounded-xl font-medium transition-all shadow-lg shadow-brand/20"
              >
                Import Shows
              </button>
              <button
                onClick={handleSkipMigration}
                className="px-4 py-2.5 bg-hover hover:bg-hover text-secondary rounded-xl font-medium transition-colors"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* First Show Celebration */}
      {showCelebration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="text-center animate-bounce">
            <div className="text-8xl mb-4">🤙</div>
            <div className="text-2xl font-bold text-primary bg-black/50 backdrop-blur-sm px-6 py-3 rounded-2xl">
              First show added!
            </div>
          </div>
        </div>
      )}

      {/* Guest Mode Account Prompt */}
      {showGuestPrompt && (
        <div className="fixed inset-0 md:left-64 bg-sidebar/50 backdrop-blur-xl flex items-center justify-center p-4 z-[60]">
          <div className="bg-elevated border border-subtle rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-brand to-brand rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-bold text-primary mb-2">Great Start!</h2>
              <p className="text-secondary">
                Your show is saved locally on this device. Create a free account to:
              </p>
            </div>
            <ul className="space-y-3 mb-6">
              <li className="flex items-center gap-3 text-secondary">
                <Check className="w-5 h-5 text-brand flex-shrink-0" />
                <span>Save your shows permanently in the cloud</span>
              </li>
              <li className="flex items-center gap-3 text-secondary">
                <Check className="w-5 h-5 text-brand flex-shrink-0" />
                <span>Access your collection from any device</span>
              </li>
              <li className="flex items-center gap-3 text-secondary">
                <Check className="w-5 h-5 text-brand flex-shrink-0" />
                <span>Join the community leaderboards</span>
              </li>
            </ul>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setShowGuestPrompt(false); openAuthModal('signup'); }}
                className="w-full px-4 py-3 bg-gradient-to-r from-brand to-amber hover:from-brand hover:to-amber text-primary rounded-xl font-medium transition-all shadow-lg shadow-brand/20"
              >
                Create Free Account
              </button>
              <button
                onClick={() => setShowGuestPrompt(false)}
                className="w-full px-4 py-3 bg-hover hover:bg-hover text-secondary rounded-xl font-medium transition-colors"
              >
                Maybe Later
              </button>
            </div>
            <p className="text-center text-muted text-xs mt-4">
              Your locally saved shows will be imported to your account
            </p>
          </div>
        </div>
      )}

      {/* Mobile Header */}
      <MobileHeader onMenuClick={() => setSidebarOpen(true)} />

      {/* Changelog popup — shown once per user after login, skipped while the invite welcome modal is up */}
      {user && !guestMode && !welcomeState && <ChangelogPopup user={user} />}

      {/* Welcome modal — shown once when a new user joins via an invite */}
      {welcomeState && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
          <div className="bg-elevated border border-brand/30 rounded-2xl w-full max-w-md p-8 shadow-2xl shadow-brand/10 text-center">
            <div className="w-16 h-16 bg-brand-subtle rounded-2xl flex items-center justify-center mx-auto mb-5">
              <Music className="w-8 h-8 text-brand" />
            </div>
            <h2 className="text-2xl font-bold text-primary mb-3">Welcome to mysetlists.net! 🎉</h2>
            <p className="text-secondary leading-relaxed mb-6">
              You joined via <span className="text-brand font-semibold">{welcomeState.inviterName}</span>&apos;s invite —
              you&apos;re already friends on the app. Start adding shows and compare your concert history!
            </p>
            <button
              onClick={() => setWelcomeState(null)}
              className="w-full px-6 py-3 bg-gradient-to-r from-brand to-amber hover:from-brand hover:to-amber text-primary rounded-xl font-semibold transition-all shadow-lg shadow-brand/20"
            >
              Let&apos;s go →
            </button>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {authModal && (
        <AuthModal
          mode={authModal}
          onClose={() => setAuthModal(null)}
          onSwitchMode={setAuthModal}
        />
      )}

      {/* Sidebar */}
      <Sidebar
        isAdmin={isAdmin}
        onLogout={guestMode ? exitGuestMode : handleLogout}
        userName={guestMode ? 'Guest' : extractFirstName(user?.displayName)}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isGuest={guestMode}
        onCreateAccount={() => openAuthModal('signup')}
        pendingNotificationCount={pendingNotificationCount}
        unreadNotificationCount={unreadNotifications?.length || null}
      />

      {/* Main Content Area.
          pt-header is the mobile header's bar plus the status-bar inset,
          from the safe-* tokens in globals.css — the body no longer pads
          the top inset as well, which used to count it twice. */}
      <div className="md:pl-64 min-h-screen pt-header md:pt-0">
        <div className="w-full max-w-[1200px] mx-auto px-4 md:px-8 py-6 md:py-10">
          {children}
        </div>
      </div>

      <Footer />

      {/* PWA Install Prompt */}
      <InstallPrompt />

      {/* Venue Rating Modal */}
      {venueRatingShow && user && (
        <VenueRatingModal
          show={venueRatingShow}
          currentUser={user}
          onClose={() => setVenueRatingShow(null)}
          onSaved={() => {
            setToast(`Rating saved for ${venueRatingShow.venue}!`);
            setVenueRatingShow(null);
          }}
        />
      )}

      {/* Global toast notification.
          setToast() is called with either a plain string or an
          { message, type } object (every error path in AppContext uses the
          object form) — rendering the object directly threw "Objects are not
          valid as a React child" and took the whole app down with it, which
          is why a failed festival write looked like a blank screen rather
          than an error toast. */}
      {toast && (
        <div
          className={[
            'fixed bottom-[calc(1.5rem+var(--safe-bottom))] left-1/2 -translate-x-1/2 z-[90] px-5 py-3 rounded-2xl',
            'shadow-lg font-medium text-sm animate-fade-in',
            toast?.type === 'error'
              ? 'bg-danger text-white shadow-danger/40'
              : 'bg-brand text-[#2a2a4e] shadow-brand/40',
          ].join(' ')}
          role="status"
        >
          {typeof toast === 'string' ? toast : toast?.message || ''}
        </div>
      )}
    </div>
    </SwipeBackLayer>
  );
}
