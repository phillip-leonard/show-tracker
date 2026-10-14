// components/auth/SuspendedScreen.jsx
//
// What an ejected account sees.
//
// Guideline 1.2 asks the developer to eject users who post objectionable
// content, and moderate-report.js now does that properly: the Auth
// account is disabled, its refresh tokens are revoked, and everything it
// published is quarantined. But disabling an account does not log
// anybody out on the spot — the ID token in hand stays valid until it
// expires, and until then the app runs signed in against a profile whose
// every write is refused by the rules.
//
// Without this screen that hour looks like a broken app: comments fail to
// post with a permission error, the feed is empty because the content is
// gone, and nothing says why. This is the honest version, and it is also
// what stops a confused ejected user filing a support ticket about a bug.
//
// Deliberately plain: no navigation, no retry, and the only action is to
// sign out (which is also what makes the state resolve, since signing
// back in is refused by Firebase with auth/user-disabled).

'use client';

import React from 'react';
import { ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui';

export default function SuspendedScreen({ onSignOut }) {
  return (
    <div
      className="fixed inset-0 z-[100] bg-base overflow-y-auto"
      data-testid="suspended-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="suspended-title"
    >
      <div
        className="min-h-full flex items-center justify-center px-4 py-10"
        style={{
          paddingTop: 'max(2.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="w-full max-w-md bg-surface border border-subtle rounded-3xl p-7 shadow-2xl text-center">
          <ShieldOff size={30} className="text-danger mx-auto mb-3" />
          <h1 id="suspended-title" className="text-xl font-bold text-primary mb-2">
            Your account has been suspended
          </h1>
          <p className="text-sm text-secondary mb-5">
            This account was suspended for breaking the{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-brand underline">
              Community Guidelines
            </a>
            . Its posts have been removed and it can no longer be used.
          </p>
          <p className="text-sm text-secondary mb-6">
            If you think this was a mistake, email{' '}
            <a href="mailto:support@mysetlists.net" className="text-brand underline">
              support@mysetlists.net
            </a>{' '}
            and we&rsquo;ll look at it again.
          </p>
          <Button variant="secondary" full onClick={onSignOut} data-testid="suspended-signout">
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
